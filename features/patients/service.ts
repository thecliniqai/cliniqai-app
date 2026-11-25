import "server-only";

import { assertPerm, hasPerm } from "@/lib/permissions";
import type { ServiceContext } from "@/lib/auth/context";
import { recordAudit } from "@/lib/audit/audit";
import { requestMemo } from "@/lib/auth/request-memo";
import { VERSIONS_VIA_TENANT_EMBED, versionsOfTenantEmbed, type Versions } from "@/lib/live/domains";
import { patientSchema, PatientInput, PatientVisitHistoryItem } from "./schema";
import { Patient } from "@/lib/db/types";
import { errorTag, log } from "@/lib/log";
import { getRequestId } from "@/lib/log/request-id";
import { clientErrorMessage } from "@/lib/errors/client-message";
import { unaffectedRowsError } from "@/lib/db/errors";
import { clinicalNotesEmbed, withClinicalNotes } from "@/lib/db/clinical-notes";
import { getTenantTimeZone } from "@/lib/datetime/server";
import { isYmd, ymdOf } from "@/lib/datetime";
import { formatAgeToday } from "@/lib/ui/age";
import { recordPatientAllergies } from "./allergies";
import { randomUUID } from "node:crypto";
import { DUPLICATE_REASONS, DUPLICATE_STRENGTHS, PATIENT_SEARCH_LIMIT, type DuplicateReason, type DuplicateStrength, type PatientHit, type PatientSex } from "./search";

/* eslint-disable @typescript-eslint/no-explicit-any */

// V2-08 08-06a (S-8): `createPatient` is gone with the INSERT grant on `patients`: a patient is registered only by the
// `register_patient` command (and the walk-in and booking commands), which normalise the phone, close the key set and audit.

/** Fixed text when a caller without consultations:view changes allergies or chronic conditions (R-8, 05-02b). */
export const PATIENT_CLINICAL_FIELDS_FORBIDDEN_MESSAGE =
  "Allergies and chronic conditions can only be changed by clinical staff.";

/** Same list, same order (the stored arrays are compared as given; the edit form preserves their order). */
function sameList(a: unknown, b: string[]): boolean {
  const left = Array.isArray(a) ? (a as unknown[]) : [];
  return left.length === b.length && left.every((v, i) => v === b[i]);
}

/**
 * V2-09c 09C-02 (R-8): allergies are compared with "not recorded" (NULL) and "none" ([]) kept apart. A form that sent no `allergies` leaves them alone; a
 * list that equals the stored one is not written (a demographics edit by a doctor used to write [] over NULL, which showed "No known allergies" for
 * patients nobody had asked).
 */
function allergiesChanged(existing: unknown, sent: string[] | undefined): boolean {
  if (sent === undefined) return false;
  if (existing == null) return true;
  return !sameList(existing, sent);
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
    const allergies = data.allergies;
    const chronicConditions = data.chronic_conditions || [];
    const allergiesAreChanged = allergiesChanged(existing.allergies, allergies);
    const clinicalFieldsChanged = allergiesAreChanged || !sameList(existing.chronic_conditions, chronicConditions);
    const mayEditClinicalFields = hasPerm(ctx.role, "consultations:view");
    if (clinicalFieldsChanged && !mayEditClinicalFields) {
      return { success: false, error: PATIENT_CLINICAL_FIELDS_FORBIDDEN_MESSAGE };
    }
    // 09C-06a (S-2): the audit row names the clinical fields that changed too (names only, never the values).
    if (allergiesAreChanged) changedFields.push("allergies");
    if (!sameList(existing.chronic_conditions, chronicConditions)) changedFields.push("chronic_conditions");

    // 09C-06a (ruling R-AL, A-8): an allergy change is the allergy command, never a column write here: the list is validated, the write is audited by
    // the command, and a list that changed since the form was opened (`allergies_expected`, else the row just read) is refused (ALLERGIES_CHANGED).
    // It runs first, so a refused allergy change leaves the demographics untouched as well.
    if (mayEditClinicalFields && allergiesAreChanged) {
      const recorded = await recordPatientAllergies(ctx, {
        patient_id: patientId,
        allergies: allergies ?? [],
        expected_allergies: data.allergies_expected !== undefined ? data.allergies_expected : ((existing.allergies as string[] | null) ?? null),
        client_request_id: randomUUID(),
      });
      if (!recorded.ok) return { success: false, error: recorded.error.message };
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
        ...(mayEditClinicalFields ? { chronic_conditions: chronicConditions } : {}),
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
  return (await readPatient(ctx, patientId, includeErased, false))?.patient ?? null;
}

/**
 * The record page's read (V2-09e 09E-06, R-9, R-18): the patient AND the clinic versions of the same statement (an embed on the patient's clinic: no call of
 * its own), the basis of the "Changed on another device" notice. The row handed back is the patient only.
 */
export async function getPatientWithVersions(ctx: ServiceContext, patientId: string): Promise<{ patient: Patient; versions: Versions | null } | null> {
  return readPatient(ctx, patientId, false, true);
}

export type PatientRecordRead =
  | { status: "ok"; patient: Patient; versions: Versions | null }
  | { status: "missing" }
  | { status: "error" };

/**
 * One read of a patient's record with the clinic versions of the same statement (V2-09e 09E-06, R-9, R-18), shared inside a request: the record's layout
 * (which decides 404 before the page streams) and the page both ask for it and the database is asked once (the in-flight read is the one answer). It writes no
 * audit row: the view is written (awaited, fail-closed) by `getPatientWithVersions`, once, by the page. `error` is a read that failed (not "no such record").
 */
export async function readPatientRecord(ctx: ServiceContext, patientId: string): Promise<PatientRecordRead> {
  assertPerm(ctx.role, "patients:view");
  return requestMemo(`patient-record:${ctx.tenantId.toLowerCase()}:${patientId.toLowerCase()}`, async (): Promise<PatientRecordRead> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (ctx.db.from("patients") as any)
      .select(`*, ${VERSIONS_VIA_TENANT_EMBED}`)
      .eq("id", patientId)
      .eq("tenant_id", ctx.tenantId)
      .eq("is_deleted", false)
      .maybeSingle();
    if (error) return { status: "error" };
    if (!data) return { status: "missing" };
    const { tenants: embedded, ...patient } = data as Record<string, unknown>;
    return { status: "ok", patient: patient as unknown as Patient, versions: versionsOfTenantEmbed({ tenants: embedded }) };
  }, { keep: (r) => r.status !== "error" });
}

async function readPatient(
  ctx: ServiceContext,
  patientId: string,
  includeErased: boolean,
  withVersions: boolean
): Promise<{ patient: Patient; versions: Versions | null } | null> {
  assertPerm(ctx.role, "patients:view");
  let found: { patient: Patient; versions: Versions | null };
  if (withVersions && !includeErased) {
    const read = await readPatientRecord(ctx, patientId);
    if (read.status !== "ok") return null;
    found = { patient: read.patient, versions: read.versions };
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (ctx.db.from("patients") as any).select("*").eq("id", patientId).eq("tenant_id", ctx.tenantId);
    if (!includeErased) query = query.eq("is_deleted", false);
    const { data, error } = await query.maybeSingle();
    if (error || !data) return null;
    found = { patient: data as Patient, versions: null };
  }

  // Record view access in the audit log, once per opening. Fail-closed (09E-14a, B): the write is awaited before the record is returned and a failure throws (`recordAudit`
  // never swallows one), so a record is never shown without its view row. It costs no extra depth on the record page: by now the record is read (the layout's
  // shared read) and the page runs this beside its consents, role and history reads.
  await recordAudit(ctx, { action: "patient.view", entityType: "patient", entityId: patientId });

  return found;
}

/**
 * Builds the PostgREST OR filter clause for searching patients across
 * full_name, phone, and abha_id.
 * Normalizes numeric inputs so that searches for bare digits (e.g. "9876543210")
 * or partial numbers (>= 3 digits e.g. "98765") match both bare digits and
 * international +91 prefixed E.164 phone numbers.
 *
 * Only the public `/api/v1/patients` list still uses this PostgREST filter (V2-12 replaces it); the app's own search is the
 * database function `search_patients` (V2-08 08-02).
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

const PATIENT_SEARCH_MAX_QUERY = 100;
const SEX_LETTER: Record<string, PatientSex> = { male: "M", female: "F", other: "O" };

type HitRow = {
  id: string;
  full_name: string;
  sex: string | null;
  age: number | null;
  date_of_birth: string | null;
  phone_last4: string | null;
  last_visit_at: string | null;
};

/** One database row as the minimal projection every picker and the palette show (`PatientHit`); never more than this. */
function toHit(row: HitRow, tz: string | null): PatientHit {
  const age =
    row.date_of_birth && tz ? formatAgeToday(row.date_of_birth, tz) : typeof row.age === "number" ? `${row.age} y` : null;
  const sex = (row.sex && SEX_LETTER[row.sex]) || null;
  return {
    id: row.id,
    name: row.full_name,
    ageSex: age || sex ? { age, sex } : null,
    phoneLast4: row.phone_last4 && /^\d{4}$/.test(row.phone_last4) ? row.phone_last4 : null,
    lastVisit: row.last_visit_at && tz ? ymdOf(row.last_visit_at, tz) : null,
  };
}

async function clinicZoneFor(ctx: ServiceContext, rows: HitRow[]): Promise<string | null> {
  return rows.some((r) => r.date_of_birth || r.last_visit_at) ? await getTenantTimeZone(ctx.db, ctx.tenantId) : null;
}

export type PatientSearchResult = { ok: true; patients: PatientHit[] } | { ok: false };

/**
 * Typeahead over the caller's clinic (`public.search_patients`, 000101): `patients:view`, the clinic from the session, RLS on
 * the user's own client, the minimal projection {@link PatientHit}. A query that is too short or only wildcards answers an
 * empty list (the function decides). `{ ok: false }` when the database could not answer (logged by tag only).
 */
export async function searchPatients(ctx: ServiceContext, query: string): Promise<PatientSearchResult> {
  assertPerm(ctx.role, "patients:view");
  const q = typeof query === "string" ? query.trim().slice(0, PATIENT_SEARCH_MAX_QUERY) : "";
  if (!q) return { ok: true, patients: [] };
  const { data, error } = await (ctx.db as any).rpc("search_patients", { p_query: q, p_limit: PATIENT_SEARCH_LIMIT });
  if (error || !Array.isArray(data)) {
    log.error({ event: "patients.search.failed", code: errorTag(error), requestId: await getRequestId(), tenantId: ctx.tenantId });
    return { ok: false };
  }
  const rows = data as HitRow[];
  const tz = await clinicZoneFor(ctx, rows);
  return { ok: true, patients: rows.map((r) => toHit(r, tz)) };
}

export interface DuplicateCandidate extends PatientHit {
  reasons: DuplicateReason[];
  /** `strong` when the evidence is the same mobile with a similar name or a similar name with the same date of birth. */
  strength: DuplicateStrength;
}

export interface FindDuplicatesParams {
  phone?: string | null;
  fullName?: string | null;
  age?: number | null;
  dob?: string | null;
}

/**
 * Advisory duplicate candidates for a patient being registered (`public.find_patient_duplicates`, 000101, 000105, R-11, AI-14): same
 * mobile (a shared family number lists everyone on it), or a similar name with the same date of birth or an age within two years;
 * the `strength` says which are probably the same person. Without the clinic's `assist.duplicates` entitlement the database
 * applies the 08-02 rules and every row is `possible`. Minimal projection plus the reasons; an unusable input is dropped, never an error.
 */
export async function findDuplicates(ctx: ServiceContext, params: FindDuplicatesParams): Promise<DuplicateCandidate[]> {
  assertPerm(ctx.role, "patients:view");
  const phone = typeof params.phone === "string" ? params.phone.trim().slice(0, 30) : "";
  const name = typeof params.fullName === "string" ? params.fullName.trim().slice(0, 120) : "";
  const dob = typeof params.dob === "string" && isYmd(params.dob) ? params.dob : null;
  const age = typeof params.age === "number" && Number.isInteger(params.age) && params.age >= 0 && params.age <= 130 ? params.age : null;
  if (!phone && !name) return [];
  const { data, error } = await (ctx.db as any).rpc("find_patient_duplicates", {
    p_phone: phone || null,
    p_name: name || null,
    p_dob: dob,
    p_age: age,
  });
  if (error || !Array.isArray(data)) {
    log.error({ event: "patients.find_duplicates.failed", code: errorTag(error), requestId: await getRequestId(), tenantId: ctx.tenantId });
    return [];
  }
  const rows = data as Array<HitRow & { reasons: string[] | null; strength?: string | null }>;
  const tz = await clinicZoneFor(ctx, rows);
  return rows.map((r) => ({
    ...toHit(r, tz),
    reasons: (r.reasons ?? []).filter((x): x is DuplicateReason => (DUPLICATE_REASONS as readonly string[]).includes(x)),
    strength: (DUPLICATE_STRENGTHS as readonly string[]).includes(r.strength ?? "") ? (r.strength as DuplicateStrength) : "possible",
  }));
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
        // The lines and the payments ride on the same statements (V2-09e 09E-06, R-9: the history is two round trips, the visits and then everything that hangs on them).
        .select(
          "id, visit_id, version, status, signed_at, created_at, prescription_items(id, prescription_id, medicine_name, generic_name, dose_form, dosage, timing, duration, special_instructions, sort_order)"
        )
        .eq("tenant_id", session.tenantId)
        .in("visit_id", visitIds)
        .order("version", { ascending: false })
        .order("sort_order", { ascending: true, referencedTable: "prescription_items" }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from("invoices") as any)
        .select("id, visit_id, invoice_number, total_amount, status, payments(amount)")
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

    // The lines of each prescription came with it (an embed), in their own order.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const itemsByRx: Record<string, any[]> = {};
    for (const rx of latestRxPerVisit.values()) itemsByRx[rx.id] = rx.prescription_items || [];

    // Invoices and what was paid on them (the payments came with the invoice).
    const invoiceList = invRes.data || [];
    const paymentsByInvoice: Record<string, number> = {};
    for (const inv of invoiceList as Array<{ id: string; payments?: Array<{ amount: number | string }> | null }>) {
      for (const p of inv.payments || []) paymentsByInvoice[inv.id] = (paymentsByInvoice[inv.id] || 0) + Number(p.amount);
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
