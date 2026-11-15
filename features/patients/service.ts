import "server-only";

import { assertPerm, hasPerm } from "@/lib/permissions";
import type { ServiceContext } from "@/lib/auth/context";
import { recordAudit } from "@/lib/audit/audit";
import { patientSchema, PatientInput, PatientVisitHistoryItem } from "./schema";
import { Patient } from "@/lib/db/types";
import { errorTag, log } from "@/lib/log";
import { getRequestId } from "@/lib/log/request-id";
import { clientErrorMessage } from "@/lib/errors/client-message";
import { unaffectedRowsError } from "@/lib/db/errors";
import { clinicalNotesEmbed, withClinicalNotes } from "@/lib/db/clinical-notes";
import { getTenantTimeZone } from "@/lib/datetime/server";
import { formatAgeToday } from "@/lib/ui/age";

/* eslint-disable @typescript-eslint/no-explicit-any */

export type CreatePatientResult =
  { success: true; patientId: string } | { success: false; error: string; fieldErrors?: Record<string, string[]> };

export async function createPatient(ctx: ServiceContext, input: PatientInput): Promise<CreatePatientResult> {
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

  const supabase = ctx.db;

  try {
    assertPerm(ctx.role, "patients:edit");
    const session = ctx;
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
      log.error({ event: "patients.create_insert.failed", code: errorTag(insertError), requestId: await getRequestId(), tenantId: ctx.tenantId });
      return { success: false, error: "Failed to register patient in clinic database." };
    }

    // 2. Audit record creation
    await recordAudit(ctx, {
      action: "patient.create",
      entityType: "patient",
      entityId: newPatient.id,
      metadata: {
        fields_changed: ["created"],
      },
    });

    return { success: true, patientId: newPatient.id };
  } catch (err: unknown) {
    return {
      success: false,
      error: clientErrorMessage(err, "Failed to register patient.", "patients.create_patient.failed"),
    };
  }
}

/** Fixed text when a caller without consultations:view changes allergies or chronic conditions (R-8, 05-02b). */
export const PATIENT_CLINICAL_FIELDS_FORBIDDEN_MESSAGE =
  "Allergies and chronic conditions can only be changed by clinical staff.";

/** Same list, same order (the stored arrays are compared as given; the edit form preserves their order). */
function sameList(a: unknown, b: string[]): boolean {
  const left = Array.isArray(a) ? (a as unknown[]) : [];
  return left.length === b.length && left.every((v, i) => v === b[i]);
}

export type UpdatePatientResult =
  { success: true; patient: Patient } | { success: false; error: string; fieldErrors?: Record<string, string[]> };

export async function updatePatient(
  ctx: ServiceContext,
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

  const supabase = ctx.db;

  try {
    assertPerm(ctx.role, "patients:edit");
    const session = ctx;
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

    // R-8 (V2-05 05-02b): front desk and admins update demographics only. A caller without consultations:view who
    // changes allergies or chronic conditions is refused before the write; unchanged values are not sent, so the
    // patients_clinical_fields_guard trigger (000055, the control) never sees them.
    const allergies = data.allergies || [];
    const chronicConditions = data.chronic_conditions || [];
    const clinicalFieldsChanged =
      !sameList(existing.allergies, allergies) || !sameList(existing.chronic_conditions, chronicConditions);
    const mayEditClinicalFields = hasPerm(ctx.role, "consultations:view");
    if (clinicalFieldsChanged && !mayEditClinicalFields) {
      return { success: false, error: PATIENT_CLINICAL_FIELDS_FORBIDDEN_MESSAGE };
    }

    // 2. Update under RLS
    const { data: updated, error: updateError } = await (supabase.from("patients") as any)
      .update({
        full_name: data.full_name,
        phone: data.phone,
        date_of_birth: data.date_of_birth,
        age: data.age ?? null,
        sex: data.sex || null,
        address: data.address || null,
        ...(mayEditClinicalFields ? { allergies, chronic_conditions: chronicConditions } : {}),
        emergency_contact: data.emergency_contact || null,
        abha_id: data.abha_id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", patientId)
      .eq("tenant_id", session.tenantId)
      .select("*");

    if (updateError?.code === "42501") {
      return { success: false, error: PATIENT_CLINICAL_FIELDS_FORBIDDEN_MESSAGE };
    }
    if (updateError) {
      return { success: false, error: "Failed to update patient record." };
    }
    // RLS may filter the update to 0 rows (V2-05 05-02b: patients:edit in the active clinic): never report success.
    const refused = unaffectedRowsError(updated);
    if (refused) {
      return { success: false, error: refused.message };
    }

    // 3. Record audit with only changed field names (no PII/clinical values)
    await recordAudit(ctx, {
      action: "patient.update",
      entityType: "patient",
      entityId: patientId,
      metadata: {
        fields_changed: changedFields.length > 0 ? changedFields : ["no_changes"],
      },
    });

    return { success: true, patient: (updated as Patient[])[0] };
  } catch (err: unknown) {
    return {
      success: false,
      error: clientErrorMessage(err, "Failed to update patient.", "patients.update_patient.failed"),
    };
  }
}

export async function getPatient(
  ctx: ServiceContext,
  patientId: string,
  includeErased = false
): Promise<Patient | null> {
  const supabase = ctx.db;
  assertPerm(ctx.role, "patients:view");
  const session = ctx;

  let query = (supabase.from("patients") as any).select("*").eq("id", patientId).eq("tenant_id", session.tenantId);

  if (!includeErased) {
    query = query.eq("is_deleted", false);
  }

  const { data, error } = await query.maybeSingle();

  if (error || !data) {
    return null;
  }

  // Record view access in audit log
  await recordAudit(ctx, {
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
export function buildPatientSearchFilter(query: string): string {
  const clean = query.trim();
  if (!clean) return "";

  // Sanitize query to avoid PostgREST filter syntax breaks. 06-09c (IND L-4, adversarial B L-1): the LIKE wildcards
  // `%` and `_`, PostgREST's `*` alias for `%`, and the escape character `\` are removed as well, so they match
  // nothing special: "%%" or "__" is not a query, and `_` is no per-digit phone oracle.
  const sanitized = clean.replace(/[,()%_*\\]/g, " ").replace(/\s+/g, " ").trim();
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

export async function searchPatients(ctx: ServiceContext, query: string): Promise<Patient[]> {
  const filterString = buildPatientSearchFilter(query);
  if (!filterString) return [];

  const supabase = ctx.db;
  assertPerm(ctx.role, "patients:view");
  const session = ctx;

  const { data, error } = await (supabase.from("patients") as any)
    .select("*")
    .eq("tenant_id", session.tenantId)
    .eq("is_deleted", false)
    .or(filterString)
    .order("created_at", { ascending: false })
    .limit(25);

  if (error || !data) {
    log.error({ event: "patients.search.failed", code: errorTag(error), requestId: await getRequestId(), tenantId: ctx.tenantId });
    return [];
  }

  return data as Patient[];
}

/**
 * The command palette's patient row (V2-06 06-04b; IA §3.7, DESIGN_SYSTEM §7.9, T-06-17): exactly four fields, so the
 * palette never holds more of a patient than its row shows. `ageSex` is the display age in the clinic's zone (`42 y`)
 * and the sex letter; `phoneLast4` is the last four digits of the mobile number only (the row masks the rest).
 */
export interface PalettePatient {
  id: string;
  name: string;
  ageSex: { age: string | null; sex: "M" | "F" | "O" | null } | null;
  phoneLast4: string | null;
}

/** The keys of {@link PalettePatient}, in order (the projection spec compares against this). */
export const PALETTE_PATIENT_KEYS = ["id", "name", "ageSex", "phoneLast4"] as const;
/** At most this many patients per palette query. */
export const PALETTE_PATIENT_LIMIT = 8;
/** Shortest query the palette sends (one character matches too much of a directory). */
export const PALETTE_MIN_QUERY = 2;
const PALETTE_MAX_QUERY = 100;

const SEX_LETTER: Record<string, "M" | "F" | "O"> = { male: "M", female: "F", other: "O" };

/**
 * Patients matching `query` (name, mobile number or ABHA, the same matching as {@link searchPatients}) in the caller's
 * clinic, projected to {@link PalettePatient}. The tenant comes from the session context; nothing is stored.
 */
export async function searchPatientsForPalette(ctx: ServiceContext, query: string): Promise<PalettePatient[]> {
  assertPerm(ctx.role, "patients:view");
  const q = typeof query === "string" ? query.trim().slice(0, PALETTE_MAX_QUERY) : "";
  // 06-09c (IND L-4): only letters and digits count toward the minimum ("%%", "__", "**" return nothing).
  if (q.replace(/[^\p{L}\p{N}]/gu, "").length < PALETTE_MIN_QUERY) return [];
  const filterString = buildPatientSearchFilter(q);
  if (!filterString) return [];

  const { data, error } = await (ctx.db.from("patients") as any)
    .select("id, full_name, phone, date_of_birth, age, sex")
    .eq("tenant_id", ctx.tenantId)
    .eq("is_deleted", false)
    .or(filterString)
    .order("created_at", { ascending: false })
    .limit(PALETTE_PATIENT_LIMIT);

  if (error || !data) {
    log.error({ event: "patients.palette_search.failed", code: errorTag(error), requestId: await getRequestId(), tenantId: ctx.tenantId });
    return [];
  }

  type Row = { id: string; full_name: string; phone: string | null; date_of_birth: string | null; age: number | null; sex: string | null };
  const rows = data as Row[];
  const tz = rows.some((r) => r.date_of_birth) ? await getTenantTimeZone(ctx.db, ctx.tenantId) : null;
  return rows.map((r) => {
    const age = r.date_of_birth && tz ? formatAgeToday(r.date_of_birth, tz) : typeof r.age === "number" ? `${r.age} y` : null;
    const sex = (r.sex && SEX_LETTER[r.sex]) || null;
    const digits = (r.phone ?? "").replace(/\D/g, "");
    return {
      id: r.id,
      name: r.full_name,
      ageSex: age || sex ? { age, sex } : null,
      phoneLast4: digits.length >= 4 ? digits.slice(-4) : null,
    };
  });
}

export async function getPatients(ctx: ServiceContext): Promise<Patient[]> {
  const supabase = ctx.db;
  assertPerm(ctx.role, "patients:view");
  const session = ctx;

  const { data, error } = await (supabase.from("patients") as any)
    .select("*")
    .eq("tenant_id", session.tenantId)
    .eq("is_deleted", false)
    .order("created_at", { ascending: false });

  if (error || !data) {
    log.error({ event: "patients.list.failed", code: errorTag(error), requestId: await getRequestId(), tenantId: ctx.tenantId });
    return [];
  }

  return data as Patient[];
}

/**
 * Loads full chronological clinical visit history for a patient in the current tenant.
 * Includes doctor credentials, diagnoses, prescriptions, items, vitals, and billing/invoice state.
 */
export async function getPatientVisitHistory(
  ctx: ServiceContext,
  patientId: string
): Promise<PatientVisitHistoryItem[]> {
  const supabase = ctx.db;

  try {
    assertPerm(ctx.role, "patients:view");
    const session = ctx;

    // 1. Fetch all visits for this patient within the active tenant, reverse chronologically
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: visitRows, error: visitsErr } = await (supabase.from("visits") as any)
      .select(
        `id, tenant_id, patient_id, doctor_id, origin_type, status, scheduled_at, reason_for_visit, specialty, created_at, updated_at, ${clinicalNotesEmbed()}`
      )
      .eq("tenant_id", session.tenantId)
      .eq("patient_id", patientId)
      .order("created_at", { ascending: false });

    if (visitsErr) {
      log.error({ event: "patients.visit_history_query.failed", code: errorTag(visitsErr), requestId: await getRequestId(), tenantId: ctx.tenantId });
      return [];
    }
    // Clinical content from clinical_notes (V2-05 05-02a): absent (null) for a role without consultations:view.
    const visits: any[] | null = visitRows ? visitRows.map(withClinicalNotes) : null;

    if (!visits || visits.length === 0) {
      return [];
    }

    const visitIds = visits.map((v: { id: string }) => v.id);
    const doctorUserIds = Array.from(new Set(visits.map((v: { doctor_id: string }) => v.doctor_id).filter(Boolean)));

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
        paymentsByInvoice[p.invoice_id] = (paymentsByInvoice[p.invoice_id] || 0) + Number(p.amount);
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
    log.error({ event: "patients.visit_history.failed", code: errorTag(err), requestId: await getRequestId(), tenantId: ctx.tenantId });
    return [];
  }
}
