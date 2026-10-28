"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/permissions/guards";
import { recordAudit } from "@/lib/audit/audit";
import { patientSchema, PatientInput, PatientVisitHistoryItem } from "./schema";
import { Database, Patient } from "@/lib/db/types";
import type { SupabaseClient } from "@supabase/supabase-js";

export type CreatePatientResult =
  | { success: true; patientId: string }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

export async function createPatient(input: PatientInput): Promise<CreatePatientResult> {
  const parseResult = patientSchema.safeParse(input);
  if (!parseResult.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parseResult.error.issues) {
      const field = issue.path[0]?.toString() || "form";
      fieldErrors[field] = fieldErrors[field] || [];
      fieldErrors[field].push(issue.message);
    }
    return {
      success: false,
      error: "Please correct the highlighted errors.",
      fieldErrors,
    };
  }

  const supabase = await createClient();

  try {
    const session = await requirePermission("patients:edit");
    const data = parseResult.data;

    // 1. Insert patient under RLS
    const { data: newPatient, error: insertError } = await (supabase.from("patients") as any)
      .insert({
        tenant_id: session.tenantId,
        full_name: data.full_name,
        phone: data.phone,
        date_of_birth: data.date_of_birth,
        age: data.age ?? null,
        sex: data.sex || null,
        address: data.address || null,
        allergies: data.allergies || [],
        chronic_conditions: data.chronic_conditions || [],
        emergency_contact: data.emergency_contact || null,
        abha_id: data.abha_id,
        created_by: session.userId,
      })
      .select("id")
      .single();

    if (insertError || !newPatient) {
      console.error("[features/patients/actions] Failed to insert patient:", insertError);
      return { success: false, error: "Failed to register patient in clinic database." };
    }

    // 2. Audit record creation
    await recordAudit({
      action: "patient.create",
      entityType: "patient",
      entityId: newPatient.id,
      metadata: {
        fields_changed: ["created"],
      },
    });

    revalidatePath("/patients");
    return { success: true, patientId: newPatient.id };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to register patient.",
    };
  }
}

export type UpdatePatientResult =
  | { success: true; patient: Patient }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

export async function updatePatient(
  patientId: string,
  input: PatientInput
): Promise<UpdatePatientResult> {
  const parseResult = patientSchema.safeParse(input);
  if (!parseResult.success) {
    return {
      success: false,
      error: "Please correct the highlighted errors.",
    };
  }

  const supabase = await createClient();

  try {
    const session = await requirePermission("patients:edit");
    const data = parseResult.data;

    // 1. Read existing row to track changed fields
    const { data: existing, error: readError } = await (supabase.from("patients") as any)
      .select("*")
      .eq("id", patientId)
      .eq("tenant_id", session.tenantId)
      .single();

    if (readError || !existing) {
      return { success: false, error: "Patient record not found." };
    }

    const changedFields: string[] = [];
    if (existing.full_name !== data.full_name) changedFields.push("full_name");
    if (existing.phone !== data.phone) changedFields.push("phone");
    if (existing.date_of_birth !== data.date_of_birth) changedFields.push("date_of_birth");
    if (existing.age !== data.age) changedFields.push("age");
    if (existing.sex !== data.sex) changedFields.push("sex");
    if (existing.abha_id !== data.abha_id) changedFields.push("abha_id");

    // 2. Update under RLS
    const { data: updated, error: updateError } = await (supabase.from("patients") as any)
      .update({
        full_name: data.full_name,
        phone: data.phone,
        date_of_birth: data.date_of_birth,
        age: data.age ?? null,
        sex: data.sex || null,
        address: data.address || null,
        allergies: data.allergies || [],
        chronic_conditions: data.chronic_conditions || [],
        emergency_contact: data.emergency_contact || null,
        abha_id: data.abha_id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", patientId)
      .eq("tenant_id", session.tenantId)
      .select("*")
      .single();

    if (updateError || !updated) {
      return { success: false, error: "Failed to update patient record." };
    }

    // 3. Record audit with only changed field names (no PII/clinical values)
    await recordAudit({
      action: "patient.update",
      entityType: "patient",
      entityId: patientId,
      metadata: {
        fields_changed: changedFields.length > 0 ? changedFields : ["no_changes"],
      },
    });

    revalidatePath(`/patients/${patientId}`);
    revalidatePath("/patients");
    return { success: true, patient: updated as Patient };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to update patient.",
    };
  }
}

export async function getPatient(patientId: string): Promise<Patient | null> {
  const supabase = await createClient();
  const session = await requirePermission("patients:view");

  const { data, error } = await (supabase.from("patients") as any)
    .select("*")
    .eq("id", patientId)
    .eq("tenant_id", session.tenantId)
    .single();

  if (error || !data) {
    return null;
  }

  // Record view access in audit log
  await recordAudit({
    action: "patient.view",
    entityType: "patient",
    entityId: patientId,
  });

  return data as Patient;
}

/**
 * Builds the PostgREST OR filter clause for searching patients across
 * full_name, phone, and abha_id.
 * Normalizes numeric inputs so that searches for bare digits (e.g. "9876543210")
 * or partial numbers (>= 3 digits e.g. "98765") match both bare digits and
 * international +91 prefixed E.164 phone numbers.
 */
export async function buildPatientSearchFilter(query: string): Promise<string> {
  const clean = query.trim();
  if (!clean) return "";

  // Sanitize query to avoid PostgREST filter syntax breaks
  const sanitized = clean.replace(/[,()]/g, " ").trim();
  if (!sanitized) return "";

  // Search across full_name, phone, or abha_id
  const digitsOnly = sanitized.replace(/\D/g, "");
  let filterString = `full_name.ilike.%${sanitized}%,phone.ilike.%${sanitized}%,abha_id.ilike.%${sanitized}%`;

  if (digitsOnly.length >= 3) {
    if (!filterString.includes(`phone.ilike.%${digitsOnly}%`)) {
      filterString += `,phone.ilike.%${digitsOnly}%`;
    }
    if (!filterString.includes(`phone.ilike.%+91${digitsOnly}%`)) {
      filterString += `,phone.ilike.%+91${digitsOnly}%`;
    }

    if (digitsOnly.startsWith("91") && digitsOnly.length >= 5) {
      const subscriber = digitsOnly.slice(2);
      if (!filterString.includes(`phone.ilike.%${subscriber}%`)) {
        filterString += `,phone.ilike.%${subscriber}%`;
      }
      if (!filterString.includes(`phone.ilike.%+91${subscriber}%`)) {
        filterString += `,phone.ilike.%+91${subscriber}%`;
      }
    }
  }

  return filterString;
}

export async function searchPatients(
  query: string,
  clientOverride?: SupabaseClient<Database>,
  sessionOverride?: { userId: string; tenantId: string }
): Promise<Patient[]> {
  const filterString = await buildPatientSearchFilter(query);
  if (!filterString) return [];

  const supabase = clientOverride || (await createClient());
  const session = sessionOverride || (await requirePermission("patients:view"));

  const { data, error } = await (supabase.from("patients") as any)
    .select("*")
    .eq("tenant_id", session.tenantId)
    .or(filterString)
    .order("created_at", { ascending: false })
    .limit(25);

  if (error || !data) {
    console.error("[searchPatients] Query error:", error);
    return [];
  }

  return data as Patient[];
}

/**
 * Loads full chronological clinical visit history for a patient in the current tenant.
 * Includes doctor credentials, diagnoses, prescriptions, items, vitals, and billing/invoice state.
 */
export async function getPatientVisitHistory(
  patientId: string,
  clientOverride?: SupabaseClient<Database>,
  sessionOverride?: { userId: string; tenantId: string }
): Promise<PatientVisitHistoryItem[]> {
  const supabase = clientOverride || (await createClient());

  try {
    const session = sessionOverride || (await requirePermission("patients:view"));

    // 1. Fetch all visits for this patient within the active tenant, reverse chronologically
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: visits, error: visitsErr } = await (supabase.from("visits") as any)
      .select(
        "id, tenant_id, patient_id, doctor_id, origin_type, status, scheduled_at, reason_for_visit, vitals, chief_complaints, clinical_notes, specialty, investigations_advised, advice, created_at, updated_at"
      )
      .eq("tenant_id", session.tenantId)
      .eq("patient_id", patientId)
      .order("created_at", { ascending: false });

    if (visitsErr) {
      console.error("[getPatientVisitHistory] Failed to fetch visits:", visitsErr);
      return [];
    }

    if (!visits || visits.length === 0) {
      return [];
    }

    const visitIds = visits.map((v: { id: string }) => v.id);
    const doctorUserIds = Array.from(
      new Set(visits.map((v: { doctor_id: string }) => v.doctor_id).filter(Boolean))
    );

    // 2. Fetch doctors (memberships), queue tokens, diagnoses, prescriptions, and invoices in parallel
    const [doctorsRes, tokensRes, diagRes, rxRes, invRes] = await Promise.all([
      doctorUserIds.length > 0
        ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (supabase.from("memberships") as any)
            .select("user_id, full_name, qualifications, medical_council_reg_no, default_specialty, role")
            .eq("tenant_id", session.tenantId)
            .in("user_id", doctorUserIds)
        : Promise.resolve({ data: [] }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from("queue_tokens") as any)
        .select("visit_id, token_number")
        .eq("tenant_id", session.tenantId)
        .in("visit_id", visitIds),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from("consultation_diagnoses") as any)
        .select("id, visit_id, diagnosis_name, icd11_code, snomed_concept_id, is_chronic, notes")
        .eq("tenant_id", session.tenantId)
        .in("visit_id", visitIds),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from("prescriptions") as any)
        .select("id, visit_id, version, status, signed_at, created_at")
        .eq("tenant_id", session.tenantId)
        .in("visit_id", visitIds)
        .order("version", { ascending: false }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from("invoices") as any)
        .select("id, visit_id, invoice_number, total_amount, status")
        .eq("tenant_id", session.tenantId)
        .in("visit_id", visitIds),
    ]);

    // Map doctors by user_id
    const doctorMap = new Map<
      string,
      {
        full_name: string;
        qualifications?: string | null;
        medical_council_reg_no?: string | null;
        specialty?: string | null;
      }
    >();
    for (const d of doctorsRes.data || []) {
      doctorMap.set(d.user_id, {
        full_name: d.full_name || (d.role === "doctor" ? "Doctor" : "Staff"),
        qualifications: d.qualifications || null,
        medical_council_reg_no: d.medical_council_reg_no || null,
        specialty: d.default_specialty || null,
      });
    }

    // Map queue tokens by visit_id
    const tokenMap = new Map<string, number>();
    for (const t of tokensRes.data || []) {
      if (t.visit_id) tokenMap.set(t.visit_id, t.token_number);
    }

    // Map diagnoses by visit_id
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const diagMap = new Map<string, any[]>();
    for (const d of diagRes.data || []) {
      const list = diagMap.get(d.visit_id) || [];
      list.push(d);
      diagMap.set(d.visit_id, list);
    }

    // Process prescriptions: get latest active (or latest version) per visit
    const rxList = rxRes.data || [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const latestRxPerVisit = new Map<string, any>();
    for (const rx of rxList) {
      if (!latestRxPerVisit.has(rx.visit_id)) {
        latestRxPerVisit.set(rx.visit_id, rx);
      } else if (rx.status === "active" && latestRxPerVisit.get(rx.visit_id).status !== "active") {
        latestRxPerVisit.set(rx.visit_id, rx);
      }
    }

    const rxIds = Array.from(latestRxPerVisit.values()).map((rx: { id: string }) => rx.id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const itemsByRx: Record<string, any[]> = {};
    if (rxIds.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: itemRows } = await (supabase.from("prescription_items") as any)
        .select(
          "id, prescription_id, medicine_name, generic_name, dose_form, dosage, timing, duration, special_instructions, sort_order"
        )
        .in("prescription_id", rxIds)
        .order("sort_order", { ascending: true });
      for (const item of itemRows || []) {
        itemsByRx[item.prescription_id] = itemsByRx[item.prescription_id] || [];
        itemsByRx[item.prescription_id].push(item);
      }
    }

    // Process invoices & fetch payments
    const invoiceList = invRes.data || [];
    const invoiceIds = invoiceList.map((inv: { id: string }) => inv.id);
    const paymentsByInvoice: Record<string, number> = {};
    if (invoiceIds.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: paymentRows } = await (supabase.from("payments") as any)
        .select("invoice_id, amount")
        .eq("tenant_id", session.tenantId)
        .in("invoice_id", invoiceIds);
      for (const p of paymentRows || []) {
        paymentsByInvoice[p.invoice_id] =
          (paymentsByInvoice[p.invoice_id] || 0) + Number(p.amount);
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const invoiceByVisit = new Map<string, any>();
    for (const inv of invoiceList) {
      const totalPaid = paymentsByInvoice[inv.id] || 0;
      const totalAmount = Number(inv.total_amount) || 0;
      invoiceByVisit.set(inv.visit_id, {
        id: inv.id,
        invoice_number: inv.invoice_number,
        total_amount: totalAmount,
        status: inv.status,
        total_paid: totalPaid,
        balance_due: Math.max(0, totalAmount - totalPaid),
      });
    }

    // 3. Assemble and return history items
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return visits.map((v: any) => {
      const doc = doctorMap.get(v.doctor_id) || {
        full_name: "Doctor",
        qualifications: null,
        medical_council_reg_no: null,
        specialty: null,
      };

      const rx = latestRxPerVisit.get(v.id);
      const rxItems = rx ? itemsByRx[rx.id] || [] : [];

      return {
        id: v.id,
        patient_id: v.patient_id,
        scheduled_at: v.scheduled_at,
        created_at: v.created_at,
        status: v.status,
        origin_type: v.origin_type,
        specialty: v.specialty,
        reason_for_visit: v.reason_for_visit,
        clinical_notes: v.clinical_notes,
        investigations_advised: v.investigations_advised || [],
        advice: v.advice || [],
        vitals: v.vitals,
        chief_complaints: v.chief_complaints,
        doctor: {
          id: v.doctor_id,
          full_name: doc.full_name,
          qualifications: doc.qualifications,
          medical_council_reg_no: doc.medical_council_reg_no,
          specialty: doc.specialty,
        },
        token_number: tokenMap.get(v.id) || null,
        diagnoses: diagMap.get(v.id) || [],
        prescription: rx
          ? {
              id: rx.id,
              version: rx.version,
              status: rx.status,
              signed_at: rx.signed_at,
              items: rxItems,
            }
          : null,
        invoice: invoiceByVisit.get(v.id) || null,
      };
    });
  } catch (err: unknown) {
    console.error("[getPatientVisitHistory] Unexpected error:", err);
    return [];
  }
}

