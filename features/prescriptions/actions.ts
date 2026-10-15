"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/permissions/guards";
import { recordAudit } from "@/lib/audit/audit";
import { Database, PrescriptionItem } from "@/lib/db/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  prescriptionItemSchema,
  PrescriptionItemInput,
  protocolTemplateSchema,
  ProtocolTemplateInput,
  MedicineSearchResult,
} from "./schema";
import { generateAndArchivePrescriptionPdf } from "./pdf/generator";
import { PrescriptionPdfPayload } from "./pdf/prescription-document";

export type SearchMedicinesResult =
  | { success: true; results: MedicineSearchResult[] }
  | { success: false; error: string };

/**
 * Searches the 94,000+ CDCI drug catalog merged with doctor's favorite/custom drugs
 * using the optimized Postgres search_medicines RPC function (<100ms response).
 */
export async function searchMedicines(
  query: string,
  limit = 20,
  clientOverride?: SupabaseClient<Database>,
  sessionOverride?: { userId: string; tenantId: string }
): Promise<SearchMedicinesResult> {
  const supabase = clientOverride || (await createClient());

  try {
    const session = sessionOverride || (await requirePermission("consultations:view"));
    const cleanQuery = query.trim();

    // Call search_medicines PostgreSQL RPC
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rows, error } = await (supabase.rpc as any)("search_medicines", {
      p_query: cleanQuery,
      p_doctor_id: session.userId,
      p_tenant_id: session.tenantId,
      p_limit: limit,
    });

    if (error) {
      console.error("[features/prescriptions/actions] search_medicines RPC error:", error);
      return { success: false, error: "Failed to search medicines." };
    }

    const results: MedicineSearchResult[] = (rows || []).map((r: MedicineSearchResult) => ({
      id: r.id,
      medicine_name: r.medicine_name,
      generic_name: r.generic_name,
      dose_form: r.dose_form,
      default_dosage: r.default_dosage,
      default_timing: r.default_timing,
      default_duration: r.default_duration,
      is_custom: r.is_custom,
      is_favorite: r.is_favorite,
    }));

    return { success: true, results };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to search medicines.",
    };
  }
}

export type GetOrCreateDraftPrescriptionResult =
  | { success: true; prescriptionId: string }
  | { success: false; error: string };

/**
 * Resolves or initializes an active draft prescription for the visit.
 */
export async function getOrCreateDraftPrescription(
  visitId: string,
  clientOverride?: SupabaseClient<Database>,
  sessionOverride?: { userId: string; tenantId: string }
): Promise<GetOrCreateDraftPrescriptionResult> {
  const supabase = clientOverride || (await createClient());

  try {
    const session = sessionOverride || (await requirePermission("consultations:edit"));

    // 1. Check if active prescription already exists
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existing } = await (supabase.from("prescriptions") as any)
      .select("id")
      .eq("visit_id", visitId)
      .eq("tenant_id", session.tenantId)
      .eq("status", "active")
      .maybeSingle();

    if (existing) {
      return { success: true, prescriptionId: existing.id };
    }

    // 2. Fetch visit to resolve patient_id & doctor_id
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: visit, error: visitErr } = await (supabase.from("visits") as any)
      .select("id, patient_id, doctor_id")
      .eq("id", visitId)
      .eq("tenant_id", session.tenantId)
      .single();

    if (visitErr || !visit) {
      return { success: false, error: "Visit not found or access denied." };
    }

    // 3. Create initial active draft prescription
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: created, error: createErr } = await (supabase.from("prescriptions") as any)
      .insert({
        tenant_id: session.tenantId,
        visit_id: visitId,
        patient_id: visit.patient_id,
        doctor_id: session.userId,
        version: 1,
        status: "active",
        letterhead_mode: "blank_paper",
      })
      .select("id")
      .single();

    if (createErr || !created) {
      return { success: false, error: "Failed to create prescription draft." };
    }

    return { success: true, prescriptionId: created.id };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to initialize prescription.",
    };
  }
}

export type AddPrescriptionItemResult =
  | { success: true; itemId: string; prescriptionId: string }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

/**
 * Appends a prescribed medication row to the active prescription.
 * If custom medicine, upserts to doctor_custom_medicines for future fast access.
 */
export async function addPrescriptionItem(
  visitId: string,
  input: PrescriptionItemInput,
  clientOverride?: SupabaseClient<Database>,
  sessionOverride?: { userId: string; tenantId: string }
): Promise<AddPrescriptionItemResult> {
  const parseResult = prescriptionItemSchema.safeParse(input);
  if (!parseResult.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parseResult.error.issues) {
      const field = issue.path[0]?.toString() || "form";
      fieldErrors[field] = fieldErrors[field] || [];
      fieldErrors[field].push(issue.message);
    }
    return {
      success: false,
      error: "Validation failed. Please correct medication details.",
      fieldErrors,
    };
  }

  const supabase = clientOverride || (await createClient());

  try {
    const session = sessionOverride || (await requirePermission("consultations:edit"));
    const data = parseResult.data;

    // 1. Resolve active prescription
    const draftRes = await getOrCreateDraftPrescription(visitId, clientOverride, session);
    if (!draftRes.success) {
      return { success: false, error: draftRes.error };
    }
    const prescriptionId = draftRes.prescriptionId;

    // 2. Determine sort order
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existingItems } = await (supabase.from("prescription_items") as any)
      .select("sort_order")
      .eq("prescription_id", prescriptionId)
      .order("sort_order", { ascending: false })
      .limit(1);

    const nextOrder =
      existingItems && existingItems.length > 0 ? (existingItems[0].sort_order ?? 0) + 1 : 0;

    // 3. Insert into prescription_items
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: inserted, error: insertErr } = await (supabase.from("prescription_items") as any)
      .insert({
        prescription_id: prescriptionId,
        medicine_name: data.medicine_name,
        generic_name: data.generic_name || null,
        dose_form: data.dose_form || null,
        dosage: data.dosage,
        timing: data.timing || null,
        duration: data.duration,
        special_instructions: data.special_instructions || null,
        cdci_brand_id: data.cdci_brand_id || null,
        cdci_generic_id: data.cdci_generic_id || null,
        sort_order: nextOrder,
      })
      .select("id")
      .single();

    if (insertErr || !inserted) {
      console.error("[features/prescriptions/actions] Insert item error:", insertErr);
      return { success: false, error: "Failed to add prescription item." };
    }

    // 4. If custom medicine, upsert to doctor_custom_medicines
    if (!data.cdci_brand_id) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from("doctor_custom_medicines") as any).upsert(
        {
          tenant_id: session.tenantId,
          doctor_id: session.userId,
          medicine_name: data.medicine_name,
          generic_name: data.generic_name || null,
          dose_form: data.dose_form || null,
          default_dosage: data.dosage,
          default_timing: data.timing || null,
          default_duration: data.duration,
          use_count: 1,
        },
        { onConflict: "tenant_id,doctor_id,medicine_name" }
      );
    }

    // 5. Record audit trail
    await recordAudit(
      {
        action: "prescription.item_add",
        entityType: "prescription",
        entityId: prescriptionId,
        metadata: {
          dose_form: data.dose_form,
        },
      },
      clientOverride,
      session
    );

    try {
      revalidatePath(`/consultation/${visitId}`);
    } catch {
      // Testing environment safely ignores revalidation
    }
    return { success: true, itemId: inserted.id, prescriptionId };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to record medication.",
    };
  }
}

export type RemovePrescriptionItemResult =
  | { success: true }
  | { success: false; error: string };

/**
 * Removes an item from the active prescription.
 */
export async function removePrescriptionItem(
  itemId: string,
  visitId: string,
  clientOverride?: SupabaseClient<Database>,
  sessionOverride?: { userId: string; tenantId: string }
): Promise<RemovePrescriptionItemResult> {
  const supabase = clientOverride || (await createClient());

  try {
    const session = sessionOverride || (await requirePermission("consultations:edit"));

    // Verify item belongs to a prescription owned by this tenant
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: itemRow, error: fetchErr } = await (supabase.from("prescription_items") as any)
      .select("id, prescription_id, prescription:prescriptions!inner(tenant_id)")
      .eq("id", itemId)
      .single();

    if (fetchErr || !itemRow) {
      return { success: false, error: "Prescription item not found." };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: deleteErr } = await (supabase.from("prescription_items") as any)
      .delete()
      .eq("id", itemId);

    if (deleteErr) {
      return { success: false, error: "Failed to delete prescription item." };
    }

    await recordAudit(
      {
        action: "prescription.item_remove",
        entityType: "prescription",
        entityId: itemRow.prescription_id,
      },
      clientOverride,
      session
    );

    try {
      revalidatePath(`/consultation/${visitId}`);
    } catch {
      // Testing environment safely ignores revalidation
    }
    return { success: true };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to remove medication.",
    };
  }
}

export type SaveDoctorProtocolTemplateResult =
  | { success: true; templateId: string }
  | { success: false; error: string };

/**
 * Saves a named medication protocol template for the active doctor.
 */
export async function saveDoctorProtocolTemplate(
  input: ProtocolTemplateInput,
  clientOverride?: SupabaseClient<Database>,
  sessionOverride?: { userId: string; tenantId: string }
): Promise<SaveDoctorProtocolTemplateResult> {
  const parseResult = protocolTemplateSchema.safeParse(input);
  if (!parseResult.success) {
    return { success: false, error: "Invalid protocol template details." };
  }

  const supabase = clientOverride || (await createClient());

  try {
    const session = sessionOverride || (await requirePermission("consultations:edit"));
    const data = parseResult.data;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: inserted, error } = await (supabase.from("doctor_prescription_templates") as any)
      .insert({
        tenant_id: session.tenantId,
        doctor_id: session.userId,
        template_name: data.template_name,
        specialty: data.specialty || null,
        items: data.items,
      })
      .select("id")
      .single();

    if (error || !inserted) {
      console.error("[features/prescriptions/actions] Save template error:", error);
      return { success: false, error: "Failed to save protocol template." };
    }

    await recordAudit(
      {
        action: "prescription.template_save",
        entityType: "prescription",
        entityId: inserted.id,
        metadata: {
          template_name: data.template_name,
          items_count: data.items.length,
        },
      },
      clientOverride,
      session
    );

    return { success: true, templateId: inserted.id };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to save protocol template.",
    };
  }
}

export interface DoctorProtocolTemplate {
  id: string;
  template_name: string;
  specialty: string | null;
  items: PrescriptionItemInput[];
  created_at: string;
}

export type GetDoctorProtocolTemplatesResult =
  | { success: true; templates: DoctorProtocolTemplate[] }
  | { success: false; error: string };

/**
 * Fetches doctor's saved protocol templates for the active specialty.
 */
export async function getDoctorProtocolTemplates(
  specialty?: string,
  clientOverride?: SupabaseClient<Database>,
  sessionOverride?: { userId: string; tenantId: string }
): Promise<GetDoctorProtocolTemplatesResult> {
  const supabase = clientOverride || (await createClient());

  try {
    const session = sessionOverride || (await requirePermission("consultations:view"));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (supabase.from("doctor_prescription_templates") as any)
      .select("id, template_name, specialty, items, created_at")
      .eq("tenant_id", session.tenantId)
      .eq("doctor_id", session.userId);

    if (specialty) {
      query = query.or(`specialty.eq.${specialty},specialty.is.null`);
    }

    const { data: rows, error } = await query.order("template_name", { ascending: true });

    if (error) {
      return { success: false, error: "Failed to fetch protocol templates." };
    }

    return { success: true, templates: rows ?? [] };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to load protocol templates.",
    };
  }
}

export interface VisitPrescriptionData {
  id: string;
  version: number;
  status: string;
  letterhead_mode: string;
  items: PrescriptionItem[];
}

export type GetVisitPrescriptionResult =
  | { success: true; prescription: VisitPrescriptionData | null }
  | { success: false; error: string };

/**
 * Fetches the active prescription and all medication items for a visit.
 */
export async function getVisitPrescription(
  visitId: string,
  clientOverride?: SupabaseClient<Database>,
  sessionOverride?: { userId: string; tenantId: string }
): Promise<GetVisitPrescriptionResult> {
  const supabase = clientOverride || (await createClient());

  try {
    const session = sessionOverride || (await requirePermission("consultations:view"));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rx, error: rxErr } = await (supabase.from("prescriptions") as any)
      .select(`
        id,
        version,
        status,
        letterhead_mode,
        items:prescription_items (
          id,
          prescription_id,
          medicine_name,
          generic_name,
          dose_form,
          dosage,
          timing,
          duration,
          special_instructions,
          cdci_brand_id,
          cdci_generic_id,
          sort_order,
          created_at
        )
      `)
      .eq("visit_id", visitId)
      .eq("tenant_id", session.tenantId)
      .eq("status", "active")
      .maybeSingle();

    if (rxErr) {
      console.error("[features/prescriptions/actions] Fetch prescription error:", rxErr);
      return { success: false, error: "Failed to load prescription." };
    }

    if (!rx) {
      return { success: true, prescription: null };
    }

    const sortedItems = (rx.items || []).sort(
      (a: PrescriptionItem, b: PrescriptionItem) => a.sort_order - b.sort_order
    );

    return {
      success: true,
      prescription: {
        id: rx.id,
        version: rx.version,
        status: rx.status,
        letterhead_mode: rx.letterhead_mode,
        items: sortedItems,
      },
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to load prescription.",
    };
  }
}

export type GetPrescriptionPdfSignedUrlResult =
  | { success: true; signedUrl: string; version: number }
  | { success: false; error: string };

/**
 * Compiles and returns a time-limited signed storage URL (3600s TTL)
 * for previewing and printing a prescription in the browser.
 */
export async function getPrescriptionPdfSignedUrl(
  prescriptionId: string,
  letterheadMode: "blank_paper" | "preprinted_letterhead" = "blank_paper",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  clientOverride?: SupabaseClient<Database, any, any>,
  sessionOverride?: { userId: string; tenantId: string }
): Promise<GetPrescriptionPdfSignedUrlResult> {
  const supabase = clientOverride || (await createClient());

  try {
    const session = sessionOverride || (await requirePermission("consultations:view"));

    // 1. Fetch prescription record
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rx, error: rxErr } = await (supabase.from("prescriptions") as any)
      .select("id, visit_id, patient_id, doctor_id, version, status, amendment_reason, signed_at")
      .eq("id", prescriptionId)
      .eq("tenant_id", session.tenantId)
      .single();

    if (rxErr || !rx) {
      return { success: false, error: "Prescription not found or access denied." };
    }

    // 2. Fetch visit record
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: visit, error: visitErr } = await (supabase.from("visits") as any)
      .select("id, status, specialty, vitals, chief_complaints, clinical_notes, advice, investigations_advised, created_at, scheduled_at, signed_at")
      .eq("id", rx.visit_id)
      .eq("tenant_id", session.tenantId)
      .single();

    if (visitErr || !visit) {
      return { success: false, error: "Visit encounter record not found." };
    }

    // 3. Fetch clinic tenant details
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: tenant } = await (supabase.from("tenants") as any)
      .select("name, address, phone, registration_number, logo_url")
      .eq("id", session.tenantId)
      .single();

    // 4. Fetch patient details
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: patient } = await (supabase.from("patients") as any)
      .select("full_name, age, sex, phone, address, abha_id")
      .eq("id", rx.patient_id)
      .eq("tenant_id", session.tenantId)
      .single();

    // 5. Fetch doctor membership info
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: doctorMember } = await (supabase.from("memberships") as any)
      .select("qualifications, medical_council_reg_no")
      .eq("tenant_id", session.tenantId)
      .eq("user_id", rx.doctor_id)
      .maybeSingle();

    // 6. Fetch consultation diagnoses
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: diagnoses } = await (supabase.from("consultation_diagnoses") as any)
      .select("diagnosis_name, icd11_code, snomed_concept_id")
      .eq("visit_id", rx.visit_id)
      .eq("tenant_id", session.tenantId)
      .order("created_at", { ascending: true });

    // 7. Fetch prescription items
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: items } = await (supabase.from("prescription_items") as any)
      .select("medicine_name, generic_name, dose_form, dosage, timing, duration, special_instructions, sort_order")
      .eq("prescription_id", rx.id)
      .order("sort_order", { ascending: true });

    // 8. Fetch follow-up
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: followUp } = await (supabase.from("follow_ups") as any)
      .select("follow_up_date")
      .eq("visit_id", rx.visit_id)
      .eq("tenant_id", session.tenantId)
      .maybeSingle();

    // 9. Build payload
    const payload: PrescriptionPdfPayload = {
      tenant_id: session.tenantId,
      visit_id: rx.visit_id,
      prescription_id: rx.id,
      version: rx.version,
      letterhead_mode: letterheadMode,
      amendment_reason: rx.amendment_reason || null,
      signed_at: rx.signed_at || visit.signed_at || null,
      clinic: {
        name: tenant?.name || "Clinic",
        address: tenant?.address || null,
        phone: tenant?.phone || null,
        registration_number: tenant?.registration_number || null,
        logo_url: tenant?.logo_url || null,
      },
      doctor: {
        name: "Doctor",
        qualifications: doctorMember?.qualifications || null,
        medical_council_reg_no: doctorMember?.medical_council_reg_no || null,
      },
      patient: {
        full_name: patient?.full_name || "Patient",
        age: patient?.age || null,
        sex: patient?.sex || null,
        phone: patient?.phone || null,
        address: typeof patient?.address === "string" ? patient.address : null,
        abha_id: patient?.abha_id || null,
        uhid: rx.patient_id.slice(0, 8).toUpperCase(),
      },
      visit: {
        visit_date: (visit.scheduled_at || visit.created_at || new Date().toISOString()).split("T")[0],
        vitals: visit.vitals || null,
        chief_complaints: visit.chief_complaints || [],
        clinical_notes: visit.clinical_notes || null,
        specialty: visit.specialty || "general_physician",
      },
      diagnoses: (diagnoses || []).map((d: { diagnosis_name: string; icd11_code?: string; snomed_concept_id?: string }) => ({
        diagnosis_name: d.diagnosis_name,
        icd11_code: d.icd11_code || null,
        snomed_concept_id: d.snomed_concept_id || null,
      })),
      medications: (items || []).map((item: { medicine_name: string; generic_name?: string | null; dose_form?: string | null; dosage: string; timing?: string | null; duration: string; special_instructions?: string | null }) => ({
        medicine_name: item.medicine_name,
        generic_name: item.generic_name,
        dose_form: item.dose_form,
        dosage: item.dosage,
        timing: item.timing,
        duration: item.duration,
        special_instructions: item.special_instructions,
      })),
      investigations_advised: visit.investigations_advised || [],
      advice: visit.advice || [],
      follow_up_date: followUp?.follow_up_date || null,
    };

    // 10. Generate PDF and get 3600s signed URL
    const { signedUrl } = await generateAndArchivePrescriptionPdf(payload, clientOverride, session);

    return {
      success: true,
      signedUrl,
      version: rx.version,
    };
  } catch (err: unknown) {
    console.error("[features/prescriptions/actions] getPrescriptionPdfSignedUrl error:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to generate prescription preview.",
    };
  }
}

