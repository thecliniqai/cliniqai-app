"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/permissions/guards";
import { recordAudit } from "@/lib/audit/audit";
import { Database } from "@/lib/db/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  saveConsultationDraftSchema,
  SaveConsultationDraftInput,
  Vitals,
  ChiefComplaintItem,
} from "./schema";
import { generateAndArchivePrescriptionPdf } from "../prescriptions/pdf/generator";
import { PrescriptionPdfPayload } from "../prescriptions/pdf/prescription-document";

export type SaveConsultationDraftResult =
  | { success: true; visitId: string }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

/**
 * Saves or auto-saves an in-progress consultation draft.
 * Updates the SOAP clinical sections, specialty data, and creates or updates follow-ups.
 */
export async function saveConsultationDraft(
  input: SaveConsultationDraftInput,
  clientOverride?: SupabaseClient<Database>,
  sessionOverride?: { userId: string; tenantId: string }
): Promise<SaveConsultationDraftResult> {
  const parseResult = saveConsultationDraftSchema.safeParse(input);
  if (!parseResult.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parseResult.error.issues) {
      const field = issue.path[0]?.toString() || "form";
      fieldErrors[field] = fieldErrors[field] || [];
      fieldErrors[field].push(issue.message);
    }
    return {
      success: false,
      error: "Validation failed. Please correct the highlighted errors.",
      fieldErrors,
    };
  }

  const supabase = clientOverride || (await createClient());

  try {
    const session = sessionOverride || (await requirePermission("consultations:edit"));
    const data = parseResult.data;

    // 1. Verify visit exists and belongs to this tenant
    const { data: visit, error: visitFetchErr } = await (
      supabase.from("visits") as unknown as {
        select: (cols: string) => {
          eq: (col: string, val: string) => {
            eq: (col: string, val: string) => {
              single: () => Promise<{
                data: { id: string; patient_id: string; status: string } | null;
                error: { message: string } | null;
              }>;
            };
          };
        };
      }
    )
      .select("id, patient_id, status")
      .eq("id", data.visit_id)
      .eq("tenant_id", session.tenantId)
      .single();

    if (visitFetchErr || !visit) {
      return {
        success: false,
        error: "Visit record not found or access denied.",
      };
    }

    // 2. Determine new status: if waiting, transition to in_consultation
    const updatedStatus = visit.status === "waiting" ? "in_consultation" : undefined;

    // 3. Update the visit row with draft SOAP clinical data
    const updatePayload: Record<string, unknown> = {
      vitals: data.vitals ?? {},
      chief_complaints: data.chief_complaints ?? [],
      clinical_notes: data.clinical_notes ?? null,
      specialty: data.specialty,
      specialty_data: data.specialty_data ?? {},
      investigations_advised: data.investigations_advised ?? [],
      advice: data.advice ?? [],
      updated_at: new Date().toISOString(),
    };

    if (updatedStatus) {
      updatePayload.status = updatedStatus;
    }

    const { error: updateErr } = await (
      supabase.from("visits") as unknown as {
        update: (vals: Record<string, unknown>) => {
          eq: (col: string, val: string) => {
            eq: (col: string, val: string) => Promise<{ error: { message: string } | null }>;
          };
        };
      }
    )
      .update(updatePayload)
      .eq("id", data.visit_id)
      .eq("tenant_id", session.tenantId);

    if (updateErr) {
      return { success: false, error: `Failed to save draft: ${updateErr.message}` };
    }

    // 4. Handle follow-up record if provided
    if (data.follow_up?.follow_up_date) {
      await recordFollowUp(
        {
          visitId: data.visit_id,
          patientId: visit.patient_id,
          followUpDate: data.follow_up.follow_up_date,
          notes: data.follow_up.notes ?? undefined,
        },
        supabase as any,
        session
      );
    }

    // 5. Record audit log
    await recordAudit(
      {
        action: "consultation.draft_save",
        entityType: "visit",
        entityId: data.visit_id,
        metadata: {
          specialty: data.specialty,
          fields_changed: [
            "vitals",
            "chief_complaints",
            "clinical_notes",
            "specialty_data",
            "advice",
          ],
        },
      },
      clientOverride,
      session
    );

    try {
      revalidatePath(`/consultation/${data.visit_id}`);
      revalidatePath("/queue");
    } catch {
      // Testing environment safely ignores revalidation
    }

    return { success: true, visitId: data.visit_id };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "An unexpected error occurred saving draft.",
    };
  }
}

export interface RecordFollowUpInput {
  visitId: string;
  patientId: string;
  doctorId?: string;
  followUpDate: string;
  notes?: string;
}

export type RecordFollowUpResult =
  | { success: true; followUpId: string }
  | { success: false; error: string };

/**
 * Persists a follow-up appointment date for the patient.
 */
export async function recordFollowUp(
  input: RecordFollowUpInput,
  clientOverride?: SupabaseClient<Database>,
  sessionOverride?: { userId: string; tenantId: string }
): Promise<RecordFollowUpResult> {
  const supabase = clientOverride || (await createClient());

  try {
    const session = sessionOverride || (await requirePermission("consultations:edit"));

    // Check if an existing follow-up is already tied to this visit
    const { data: existing } = await (
      supabase.from("follow_ups") as unknown as {
        select: (cols: string) => {
          eq: (col: string, val: string) => {
            eq: (col: string, val: string) => {
              maybeSingle: () => Promise<{ data: { id: string } | null }>;
            };
          };
        };
      }
    )
      .select("id")
      .eq("tenant_id", session.tenantId)
      .eq("visit_id", input.visitId)
      .maybeSingle();

    let followUpId: string;

    if (existing?.id) {
      // Update existing follow-up
      followUpId = existing.id;
      const { error: updateErr } = await (
        supabase.from("follow_ups") as unknown as {
          update: (vals: Record<string, unknown>) => {
            eq: (col: string, val: string) => Promise<{ error: { message: string } | null }>;
          };
        }
      )
        .update({
          follow_up_date: input.followUpDate,
          notes: input.notes ?? null,
        })
        .eq("id", followUpId);

      if (updateErr) throw new Error(updateErr.message);
    } else {
      // Insert new follow-up
      const { data: inserted, error: insertErr } = await (
        supabase.from("follow_ups") as unknown as {
          insert: (row: Record<string, unknown>) => {
            select: (cols: string) => {
              single: () => Promise<{
                data: { id: string } | null;
                error: { message: string } | null;
              }>;
            };
          };
        }
      )
        .insert({
          tenant_id: session.tenantId,
          patient_id: input.patientId,
          visit_id: input.visitId,
          doctor_id: input.doctorId || session.userId,
          follow_up_date: input.followUpDate,
          notes: input.notes ?? null,
          status: "scheduled",
        })
        .select("id")
        .single();

      if (insertErr || !inserted) throw new Error(insertErr?.message || "Failed to create follow-up");
      followUpId = inserted.id;
    }

    await recordAudit(
      {
        action: "follow_up.record",
        entityType: "follow_up",
        entityId: followUpId,
        metadata: {
          follow_up_date: input.followUpDate,
        },
      },
      clientOverride,
      session
    );

    return { success: true, followUpId };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to record follow-up.",
    };
  }
}

export interface PastVisitEncounter {
  visitId: string;
  date: string;
  status: string;
  specialty: string;
  vitals?: Vitals | null;
  chiefComplaints: ChiefComplaintItem[];
  clinicalNotes?: string | null;
  advice: string[];
  diagnoses: {
    id: string;
    diagnosis_name: string;
    icd11_code?: string | null;
    snomed_concept_id?: string | null;
    is_chronic: boolean;
  }[];
  prescriptions: {
    id: string;
    version: number;
    items: {
      id: string;
      medicine_name: string;
      generic_name?: string | null;
      dose_form?: string | null;
      dosage: string;
      timing?: string | null;
      duration: string;
      special_instructions?: string | null;
    }[];
  }[];
}

/**
 * Loads longitudinal patient consultation history for the history slide-over drawer.
 */
export async function getPatientConsultationHistory(
  patientId: string,
  currentVisitId?: string,
  clientOverride?: SupabaseClient<Database>,
  sessionOverride?: { userId: string; tenantId: string }
): Promise<{ success: true; encounters: PastVisitEncounter[] } | { success: false; error: string }> {
  const supabase = clientOverride || (await createClient());

  try {
    const session = sessionOverride || (await requirePermission("consultations:view"));

    // 1. Fetch visits for this patient in this tenant
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let visitQuery = (supabase as any)
      .from("visits")
      .select("id, scheduled_at, created_at, status, specialty, vitals, chief_complaints, clinical_notes, advice")
      .eq("tenant_id", session.tenantId)
      .eq("patient_id", patientId)
      .in("status", ["completed", "in_consultation"])
      .order("created_at", { ascending: false });

    if (currentVisitId) {
      visitQuery = visitQuery.neq("id", currentVisitId);
    }

    const { data: visits, error: visitsErr } = await visitQuery;
    if (visitsErr) throw new Error(visitsErr.message);

    if (!visits || visits.length === 0) {
      return { success: true, encounters: [] };
    }

    const visitIds = visits.map((v: { id: string }) => v.id);

    // 2. Fetch diagnoses for these visits
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: diagnoses, error: diagErr } = await (supabase as any)
      .from("consultation_diagnoses")
      .select("id, visit_id, diagnosis_name, icd11_code, snomed_concept_id, is_chronic")
      .in("visit_id", visitIds);

    if (diagErr) throw new Error(diagErr.message);

    // 3. Fetch prescriptions for these visits
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rxList, error: rxErr } = await (supabase as any)
      .from("prescriptions")
      .select("id, visit_id, version, status")
      .in("visit_id", visitIds)
      .eq("status", "active");

    if (rxErr) throw new Error(rxErr.message);

    const rxIds = (rxList || []).map((rx: { id: string }) => rx.id);
    let itemsByRx: Record<string, unknown[]> = {};

    if (rxIds.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: items, error: itemsErr } = await (supabase as any)
        .from("prescription_items")
        .select("id, prescription_id, medicine_name, generic_name, dose_form, dosage, timing, duration, special_instructions, sort_order")
        .in("prescription_id", rxIds)
        .order("sort_order", { ascending: true });

      if (itemsErr) throw new Error(itemsErr.message);

      itemsByRx = (items || []).reduce((acc: Record<string, unknown[]>, item: { prescription_id: string }) => {
        acc[item.prescription_id] = acc[item.prescription_id] || [];
        acc[item.prescription_id].push(item);
        return acc;
      }, {});
    }

    // 4. Group data per visit encounter
    const encounters: PastVisitEncounter[] = visits.map((v: {
      id: string;
      created_at: string;
      scheduled_at?: string;
      status: string;
      specialty: string;
      vitals?: Vitals;
      chief_complaints?: ChiefComplaintItem[];
      clinical_notes?: string;
      advice?: string[];
    }) => {
      const vDiag = (diagnoses || []).filter((d: { visit_id: string }) => d.visit_id === v.id);
      const vRx = (rxList || [])
        .filter((r: { visit_id: string }) => r.visit_id === v.id)
        .map((r: { id: string; version: number }) => ({
          id: r.id,
          version: r.version,
          items: (itemsByRx[r.id] || []) as PastVisitEncounter["prescriptions"][0]["items"],
        }));

      return {
        visitId: v.id,
        date: v.scheduled_at || v.created_at,
        status: v.status,
        specialty: v.specialty,
        vitals: v.vitals || null,
        chiefComplaints: v.chief_complaints || [],
        clinicalNotes: v.clinical_notes || null,
        advice: v.advice || [],
        diagnoses: vDiag.map((d: { id: string; diagnosis_name: string; icd11_code?: string; snomed_concept_id?: string; is_chronic: boolean }) => ({
          id: d.id,
          diagnosis_name: d.diagnosis_name,
          icd11_code: d.icd11_code || null,
          snomed_concept_id: d.snomed_concept_id || null,
          is_chronic: d.is_chronic,
        })),
        prescriptions: vRx,
      };
    });

    return { success: true, encounters };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to load patient consultation history.",
    };
  }
}

/**
 * Internal helper to construct a complete PrescriptionPdfPayload for a visit.
 */
async function buildVisitPdfPayload(
  visitId: string,
  tenantId: string,
  userId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  overrideVersion?: number,
  overrideReason?: string | null
): Promise<PrescriptionPdfPayload | null> {
  const { data: visit } = await supabase
    .from("visits")
    .select("*")
    .eq("id", visitId)
    .eq("tenant_id", tenantId)
    .single();

  if (!visit) return null;

  const { data: tenant } = await supabase
    .from("tenants")
    .select("name, address, phone, registration_number, logo_url")
    .eq("id", tenantId)
    .single();

  const { data: patient } = await supabase
    .from("patients")
    .select("full_name, age, sex, phone, address, abha_id")
    .eq("id", visit.patient_id)
    .eq("tenant_id", tenantId)
    .single();

  const { data: doctorMember } = await supabase
    .from("memberships")
    .select("qualifications, medical_council_reg_no")
    .eq("tenant_id", tenantId)
    .eq("user_id", visit.doctor_id)
    .maybeSingle();

  const { data: diagnoses } = await supabase
    .from("consultation_diagnoses")
    .select("diagnosis_name, icd11_code, snomed_concept_id")
    .eq("visit_id", visitId)
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: true });

  const { data: rx } = await supabase
    .from("prescriptions")
    .select("id, version, letterhead_mode, amendment_reason, signed_at")
    .eq("visit_id", visitId)
    .eq("tenant_id", tenantId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let items: any[] = [];
  if (rx?.id) {
    const { data: rxItems } = await supabase
      .from("prescription_items")
      .select("medicine_name, generic_name, dose_form, dosage, timing, duration, special_instructions, sort_order")
      .eq("prescription_id", rx.id)
      .order("sort_order", { ascending: true });
    items = rxItems || [];
  }

  const { data: followUp } = await supabase
    .from("follow_ups")
    .select("follow_up_date")
    .eq("visit_id", visitId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  const version = overrideVersion ?? (rx?.version || 1);
  const amendmentReason = overrideReason !== undefined ? overrideReason : (rx?.amendment_reason || null);

  return {
    tenant_id: tenantId,
    visit_id: visit.id,
    prescription_id: rx?.id || "",
    version,
    letterhead_mode: rx?.letterhead_mode || "blank_paper",
    amendment_reason: amendmentReason,
    signed_at: visit.signed_at || new Date().toISOString(),
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
      uhid: visit.patient_id.slice(0, 8).toUpperCase(),
    },
    visit: {
      visit_date: (visit.scheduled_at || visit.created_at || new Date().toISOString()).split("T")[0],
      vitals: visit.vitals || null,
      chief_complaints: visit.chief_complaints || [],
      clinical_notes: visit.clinical_notes || null,
      specialty: visit.specialty || "general_physician",
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    diagnoses: (diagnoses || []).map((d: any) => ({
      diagnosis_name: d.diagnosis_name,
      icd11_code: d.icd11_code || null,
      snomed_concept_id: d.snomed_concept_id || null,
    })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    medications: items.map((item: any) => ({
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
}

export type CompleteAndSignConsultationResult =
  | { success: true; visitId: string }
  | { success: false; error: string };

/**
 * Completes the consultation and finalizes clinical documentation.
 * Enforces that at least one diagnosis or clinical note exists,
 * stamps the prescription as signed, transitions visit to 'completed',
 * generates initial archival PDF v1, and records an immutable audit log.
 */
export async function completeAndSignConsultation(
  visitId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  clientOverride?: SupabaseClient<Database, any, any>,
  sessionOverride?: { userId: string; tenantId: string }
): Promise<CompleteAndSignConsultationResult> {
  const supabase = clientOverride || (await createClient());

  try {
    const session = sessionOverride || (await requirePermission("consultations:edit"));
    const nowIso = new Date().toISOString();

    // 1. Fetch visit and verify access
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: visit, error: visitErr } = await (supabase.from("visits") as any)
      .select("id, status, clinical_notes")
      .eq("id", visitId)
      .eq("tenant_id", session.tenantId)
      .single();

    if (visitErr || !visit) {
      return { success: false, error: "Visit not found or access denied." };
    }

    // 2. Clinical safety check: Ensure at least one diagnosis or clinical note exists
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: diagnoses } = await (supabase.from("consultation_diagnoses") as any)
      .select("id")
      .eq("visit_id", visitId)
      .eq("tenant_id", session.tenantId)
      .limit(1);

    const hasDiagnosis = diagnoses && diagnoses.length > 0;
    const hasNotes = Boolean(visit.clinical_notes && visit.clinical_notes.trim().length > 0);

    if (!hasDiagnosis && !hasNotes) {
      return {
        success: false,
        error: "Cannot sign off consultation without recording at least one diagnosis or clinical note.",
      };
    }

    // 3. Mark active prescription as signed/issued
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from("prescriptions") as any)
      .update({
        signed_at: nowIso,
        updated_at: nowIso,
      })
      .eq("visit_id", visitId)
      .eq("tenant_id", session.tenantId)
      .eq("status", "active");

    // 4. Update visit to completed
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from("visits") as any)
      .update({
        status: "completed",
        signed_at: nowIso,
        signed_by: session.userId,
        updated_at: nowIso,
      })
      .eq("id", visitId)
      .eq("tenant_id", session.tenantId);

    // 5. Update queue token called_at/status if present
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from("queue_tokens") as any)
      .update({ updated_at: nowIso })
      .eq("visit_id", visitId)
      .eq("tenant_id", session.tenantId);

    // 6. Generate initial archival PDF v1
    try {
      const payload = await buildVisitPdfPayload(visitId, session.tenantId, session.userId, supabase, 1);
      if (payload) {
        await generateAndArchivePrescriptionPdf(payload, clientOverride, session);
      }
    } catch (pdfErr) {
      console.warn("[completeAndSignConsultation] Archival PDF warning:", pdfErr);
    }

    // 7. Compliance audit log
    await recordAudit(
      {
        action: "visit.complete_and_sign",
        entityType: "visit",
        entityId: visitId,
        metadata: {
          version: 1,
        },
      },
      clientOverride as any,
      session
    );

    try {
      revalidatePath(`/consultation/${visitId}`);
      revalidatePath("/queue");
    } catch {
      // Testing environment safely ignores revalidation
    }

    return { success: true, visitId };
  } catch (err: unknown) {
    console.error("[completeAndSignConsultation] Error:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to complete and sign consultation.",
    };
  }
}

export type ReopenVisitForAmendmentResult =
  | { success: true; visitId: string; revisionNumber: number }
  | { success: false; error: string };

/**
 * Reopens a completed consultation for post-sign-off clinical amendments.
 * Captures an immutable JSON snapshot in `visit_revisions` before transitioning
 * the visit status back to 'in_consultation'.
 */
export async function reopenVisitForAmendment(
  visitId: string,
  reason: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  clientOverride?: SupabaseClient<Database, any, any>,
  sessionOverride?: { userId: string; tenantId: string }
): Promise<ReopenVisitForAmendmentResult> {
  const cleanReason = (reason || "").trim();
  if (cleanReason.length < 10) {
    return {
      success: false,
      error: "A valid reason for amendment of at least 10 characters is required for medical audit compliance.",
    };
  }

  const supabase = clientOverride || (await createClient());

  try {
    const session = sessionOverride || (await requirePermission("consultations:edit"));

    // 1. Fetch visit - must be completed
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: visit, error: visitErr } = await (supabase.from("visits") as any)
      .select("*")
      .eq("id", visitId)
      .eq("tenant_id", session.tenantId)
      .single();

    if (visitErr || !visit) {
      return { success: false, error: "Visit record not found or access denied." };
    }

    if (visit.status !== "completed") {
      return {
        success: false,
        error: "Only completed consultations can be reopened for amendment.",
      };
    }

    // 2. Fetch diagnoses
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: diagnoses } = await (supabase.from("consultation_diagnoses") as any)
      .select("*")
      .eq("visit_id", visitId)
      .eq("tenant_id", session.tenantId);

    // 3. Fetch prescription and items
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rx } = await (supabase.from("prescriptions") as any)
      .select("*")
      .eq("visit_id", visitId)
      .eq("tenant_id", session.tenantId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let rxItems: any[] = [];
    if (rx?.id) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: items } = await (supabase.from("prescription_items") as any)
        .select("*")
        .eq("prescription_id", rx.id)
        .order("sort_order", { ascending: true });
      rxItems = items || [];
    }

    // 4. Calculate next revision number
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: prevRevisions } = await (supabase.from("visit_revisions") as any)
      .select("revision_number")
      .eq("visit_id", visitId)
      .eq("tenant_id", session.tenantId)
      .order("revision_number", { ascending: false })
      .limit(1);

    const nextRevNum =
      prevRevisions && prevRevisions.length > 0 ? prevRevisions[0].revision_number + 1 : 1;

    // 5. Freeze complete JSON state snapshot
    const snapshot = {
      visit: {
        status: visit.status,
        vitals: visit.vitals,
        chief_complaints: visit.chief_complaints,
        clinical_notes: visit.clinical_notes,
        specialty: visit.specialty,
        specialty_data: visit.specialty_data,
        advice: visit.advice,
        investigations_advised: visit.investigations_advised,
        signed_at: visit.signed_at,
      },
      diagnoses: diagnoses || [],
      prescription: rx ? { ...rx, items: rxItems } : null,
    };

    // 6. Insert immutable snapshot into visit_revisions
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: revErr } = await (supabase.from("visit_revisions") as any)
      .insert({
        tenant_id: session.tenantId,
        visit_id: visitId,
        revision_number: nextRevNum,
        amended_by: session.userId,
        amended_at: new Date().toISOString(),
        amendment_reason: cleanReason,
        snapshot,
      });

    if (revErr) {
      console.error("[reopenVisitForAmendment] Revision insert error:", revErr);
      return { success: false, error: "Failed to create audit revision record: " + revErr.message };
    }

    // 7. Transition visit back to 'in_consultation'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from("visits") as any)
      .update({
        status: "in_consultation",
        updated_at: new Date().toISOString(),
      })
      .eq("id", visitId)
      .eq("tenant_id", session.tenantId);

    // 8. Record audit trail
    await recordAudit(
      {
        action: "visit.reopen_for_amendment",
        entityType: "visit",
        entityId: visitId,
        metadata: {
          revision_number: nextRevNum,
          amendment_reason: cleanReason,
        },
      },
      clientOverride as any,
      session
    );

    try {
      revalidatePath(`/consultation/${visitId}`);
      revalidatePath("/queue");
    } catch {
      // Testing environment safely ignores revalidation
    }

    return { success: true, visitId, revisionNumber: nextRevNum };
  } catch (err: unknown) {
    console.error("[reopenVisitForAmendment] Error:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to reopen visit for amendment.",
    };
  }
}

export type FinalizeVisitAmendmentResult =
  | { success: true; visitId: string; version: number }
  | { success: false; error: string };

/**
 * Finalizes clinical amendments made to a reopened visit:
 * Increments the prescription version (v2, v3), stamps the amended PDF with
 * amendment watermark and doctor's rationale, and returns visit status to 'completed'.
 */
export async function finalizeVisitAmendment(
  visitId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  clientOverride?: SupabaseClient<Database, any, any>,
  sessionOverride?: { userId: string; tenantId: string }
): Promise<FinalizeVisitAmendmentResult> {
  const supabase = clientOverride || (await createClient());

  try {
    const session = sessionOverride || (await requirePermission("consultations:edit"));
    const nowIso = new Date().toISOString();

    // 1. Fetch visit
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: visit, error: visitErr } = await (supabase.from("visits") as any)
      .select("id, status")
      .eq("id", visitId)
      .eq("tenant_id", session.tenantId)
      .single();

    if (visitErr || !visit) {
      return { success: false, error: "Visit not found or access denied." };
    }

    // 2. Fetch latest revision reason from visit_revisions
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: latestRev } = await (supabase.from("visit_revisions") as any)
      .select("revision_number, amendment_reason, amended_at")
      .eq("visit_id", visitId)
      .eq("tenant_id", session.tenantId)
      .order("revision_number", { ascending: false })
      .limit(1)
      .maybeSingle();

    const amendmentReason = latestRev?.amendment_reason || "Clinical adjustment";

    // 3. Resolve active prescription and increment version counter
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: currentRx } = await (supabase.from("prescriptions") as any)
      .select("id, version")
      .eq("visit_id", visitId)
      .eq("tenant_id", session.tenantId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    const newVersion = (currentRx?.version || 1) + 1;

    if (currentRx?.id) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from("prescriptions") as any)
        .update({
          version: newVersion,
          amendment_reason: amendmentReason,
          signed_at: nowIso,
          updated_at: nowIso,
        })
        .eq("id", currentRx.id)
        .eq("tenant_id", session.tenantId);
    }

    // 4. Update visit status back to 'completed'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from("visits") as any)
      .update({
        status: "completed",
        signed_at: nowIso,
        signed_by: session.userId,
        updated_at: nowIso,
      })
      .eq("id", visitId)
      .eq("tenant_id", session.tenantId);

    // 5. Regenerate and archive stamped amended PDF (v2, v3)
    try {
      const payload = await buildVisitPdfPayload(
        visitId,
        session.tenantId,
        session.userId,
        supabase,
        newVersion,
        amendmentReason
      );
      if (payload) {
        await generateAndArchivePrescriptionPdf(payload, clientOverride, session);
      }
    } catch (pdfErr) {
      console.warn("[finalizeVisitAmendment] PDF regeneration warning:", pdfErr);
    }

    // 6. Record audit log
    await recordAudit(
      {
        action: "visit.amend_finalized",
        entityType: "visit",
        entityId: visitId,
        metadata: {
          version: newVersion,
          amendment_reason: amendmentReason,
        },
      },
      clientOverride as any,
      session
    );

    try {
      revalidatePath(`/consultation/${visitId}`);
      revalidatePath("/queue");
    } catch {
      // Testing environment safely ignores revalidation
    }

    return { success: true, visitId, version: newVersion };
  } catch (err: unknown) {
    console.error("[finalizeVisitAmendment] Error:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to finalize amendment.",
    };
  }
}

