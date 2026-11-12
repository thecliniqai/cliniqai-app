/**
 * Synthetic data and database read-backs for the M0 characterisation flows and journeys (V2-02 plan 02-03b).
 *
 * Runs in the Playwright runner process against the LOCAL stack only (the config's `assertLocalTestEnv` guard), with
 * the service-role admin client from tests/helpers. Every row lives in the run's tenants, which the global teardown
 * deletes. Names carry the run tag and a per-call suffix, and phones are random numbers in +91 90000 0xxxx, so no two
 * tests (or device projects) share a row. India has no reserved fictional mobile range: these numbers are only
 * valid-looking and may be real subscribers' numbers. They never reach anyone because the e2e lane pins
 * MESSAGING_PROVIDER=dev and the app server cannot leave 127.0.0.1 (tests/setup/test-env.ts, server-net-guard.cjs).
 *
 * The flows assert OUTCOMES here (rows, statuses, numbers), not v1 selectors, so they survive the v2 redesign.
 */
import { randomInt, randomUUID } from "node:crypto";
import { getAdminClient } from "../../helpers/supabase-admin";
import { readRunData, type RunData } from "./run-data";

export const IST = "Asia/Kolkata";

/** The run's data plus a short unique suffix for names created by one test. */
export function testTag(): string {
  return randomUUID().slice(0, 6);
}

export function run(): RunData {
  return readRunData();
}

/** Ten random subscriber digits (90000 0xxxx): valid-looking, not reserved (see the file comment); offline lane only. */
export function syntheticPhoneDigits(): string {
  return `90000${String(randomInt(0, 100_000)).padStart(5, "0")}`;
}

/**
 * The app's "today" for the queue, cabin and tokens: the clinic date in the tenant's zone (V2-03 03-05; synthetic
 * tenants keep the default Asia/Kolkata), no longer the UTC calendar date.
 */
export function appToday(): string {
  return istDate();
}

/** YYYY-MM-DD in India for now + `offsetDays`. */
export function istDate(offsetDays = 0): string {
  const at = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: IST, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/** The instant of `HH:MM` on `date` in India, as an ISO string. */
export function istInstant(date: string, time: string): string {
  return new Date(`${date}T${time}:00+05:30`).toISOString();
}

function isSundayInIndia(date: string): boolean {
  return new Date(`${date}T12:00:00+05:30`).getUTCDay() === 0;
}

function must<T>(result: { data: T | null; error: { message: string } | null }, what: string): T {
  if (result.error || result.data === null) throw new Error(`m0 seed: ${what} failed: ${result.error?.message}`);
  return result.data;
}

export async function seedPatient(tenantId: string, createdBy: string, fullName: string): Promise<{ id: string; phone: string }> {
  const phone = `+91${syntheticPhoneDigits()}`;
  const row = must(
    await getAdminClient()
      .from("patients")
      .insert({ tenant_id: tenantId, full_name: fullName, phone, sex: "other", age: 40, created_by: createdBy })
      .select("id")
      .single(),
    "patient insert",
  ) as { id: string };
  return { id: row.id, phone };
}

export interface SeedVisitInput {
  tenantId: string;
  patientId: string;
  doctorId: string;
  createdBy: string;
  status: "booked" | "waiting" | "in_consultation" | "completed";
  originType?: "walk_in" | "scheduled";
  scheduledAt?: string | null;
  signedAt?: string | null;
}

export async function seedVisit(input: SeedVisitInput): Promise<string> {
  const row = must(
    await getAdminClient()
      .from("visits")
      .insert({
        tenant_id: input.tenantId,
        patient_id: input.patientId,
        doctor_id: input.doctorId,
        origin_type: input.originType ?? "walk_in",
        status: input.status,
        scheduled_at: input.scheduledAt ?? null,
        estimated_duration_minutes: 15,
        reason_for_visit: "E2E synthetic visit",
        created_by: input.createdBy,
        ...(input.signedAt ? { signed_at: input.signedAt, signed_by: input.doctorId } : {}),
      })
      .select("id")
      .single(),
    "visit insert",
  ) as { id: string };
  return row.id;
}

/** A signed (sealed) version-1 prescription with one item for a completed visit. */
export async function seedSignedPrescription(input: {
  tenantId: string;
  visitId: string;
  patientId: string;
  doctorId: string;
  signedAt: string;
  medicineName: string;
}): Promise<string> {
  const admin = getAdminClient();
  const rx = must(
    await admin
      .from("prescriptions")
      .insert({
        tenant_id: input.tenantId,
        visit_id: input.visitId,
        patient_id: input.patientId,
        doctor_id: input.doctorId,
        version: 1,
        status: "active",
        signed_at: input.signedAt,
      })
      .select("id")
      .single(),
    "prescription insert",
  ) as { id: string };
  must(
    await admin
      .from("prescription_items")
      .insert({ prescription_id: rx.id, medicine_name: input.medicineName, dosage: "1-0-1", duration: "5 days", sort_order: 0 })
      .select("id")
      .single(),
    "prescription item insert",
  );
  return rx.id;
}

/** Highest token number issued today (app date) in the tenant, 0 if none. */
export async function maxTokenToday(tenantId: string): Promise<number> {
  const { data, error } = await getAdminClient()
    .from("queue_tokens")
    .select("token_number")
    .eq("tenant_id", tenantId)
    .eq("date", appToday())
    .order("token_number", { ascending: false })
    .limit(1);
  if (error) throw new Error(`m0 read: queue tokens: ${error.message}`);
  return (data?.[0]?.token_number as number | undefined) ?? 0;
}

/** Issues the next token for `visitId` today, as check-in would (seeding a queue the flow then works on). */
export async function seedQueueToken(tenantId: string, visitId: string): Promise<number> {
  const tokenNumber = (await maxTokenToday(tenantId)) + 1;
  must(
    await getAdminClient()
      .from("queue_tokens")
      .insert({ tenant_id: tenantId, visit_id: visitId, date: appToday(), token_number: tokenNumber })
      .select("id")
      .single(),
    "queue token insert",
  );
  return tokenNumber;
}

/**
 * A future date in India on which `doctorId` has no non-cancelled visit and the default availability schedule
 * (Mon–Sat 10:00–13:00 and 17:00–21:00, migration 000012) has the doctor on duty — not a Sunday.
 */
export async function freeBookingDate(tenantId: string, doctorId: string): Promise<string> {
  for (let offset = 2; offset < 120; offset++) {
    const date = istDate(offset);
    if (isSundayInIndia(date)) continue;
    const { count, error } = await getAdminClient()
      .from("visits")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("doctor_id", doctorId)
      .neq("status", "cancelled")
      .gte("scheduled_at", istInstant(date, "00:00"))
      .lt("scheduled_at", istInstant(istDateAfter(date), "00:00"));
    if (error) throw new Error(`m0 read: visits on ${date}: ${error.message}`);
    if (!count) return date;
  }
  throw new Error("m0 seed: no free booking date in the next 120 days");
}

function istDateAfter(date: string): string {
  const next = new Date(`${date}T12:00:00+05:30`);
  next.setUTCDate(next.getUTCDate() + 1);
  return new Intl.DateTimeFormat("en-CA", { timeZone: IST, year: "numeric", month: "2-digit", day: "2-digit" }).format(next);
}

export interface VisitRow {
  id: string;
  status: string;
  scheduled_at: string | null;
  is_overbooked: boolean;
  origin_type: string;
  doctor_id: string;
  patient_id: string;
  clinical_notes: string | null;
  signed_at: string | null;
}

export async function visitsOf(tenantId: string, patientId: string): Promise<VisitRow[]> {
  const { data, error } = await getAdminClient()
    .from("visits")
    .select("id, status, scheduled_at, is_overbooked, origin_type, doctor_id, patient_id, clinical_notes, signed_at")
    .eq("tenant_id", tenantId)
    .eq("patient_id", patientId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`m0 read: visits: ${error.message}`);
  return (data ?? []) as VisitRow[];
}

export async function visitById(visitId: string): Promise<VisitRow | null> {
  const { data, error } = await getAdminClient()
    .from("visits")
    .select("id, status, scheduled_at, is_overbooked, origin_type, doctor_id, patient_id, clinical_notes, signed_at")
    .eq("id", visitId)
    .maybeSingle();
  if (error) throw new Error(`m0 read: visit: ${error.message}`);
  return (data as VisitRow | null) ?? null;
}

export async function patientsByPhone(tenantId: string, phoneE164: string): Promise<Array<{ id: string; full_name: string }>> {
  const { data, error } = await getAdminClient()
    .from("patients")
    .select("id, full_name")
    .eq("tenant_id", tenantId)
    .eq("phone", phoneE164);
  if (error) throw new Error(`m0 read: patients: ${error.message}`);
  return (data ?? []) as Array<{ id: string; full_name: string }>;
}

export async function patientsByName(tenantId: string, fullName: string): Promise<Array<{ id: string; phone: string }>> {
  const { data, error } = await getAdminClient()
    .from("patients")
    .select("id, phone")
    .eq("tenant_id", tenantId)
    .eq("full_name", fullName);
  if (error) throw new Error(`m0 read: patients: ${error.message}`);
  return (data ?? []) as Array<{ id: string; phone: string }>;
}

export async function tokenOf(visitId: string): Promise<{ token_number: number; date: string } | null> {
  const { data, error } = await getAdminClient()
    .from("queue_tokens")
    .select("token_number, date")
    .eq("visit_id", visitId)
    .maybeSingle();
  if (error) throw new Error(`m0 read: queue token: ${error.message}`);
  return (data as { token_number: number; date: string } | null) ?? null;
}

export async function prescriptionsOf(visitId: string): Promise<
  Array<{ id: string; version: number; status: string; signed_at: string | null; items: number }>
> {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from("prescriptions")
    .select("id, version, status, signed_at")
    .eq("visit_id", visitId)
    .order("version", { ascending: true });
  if (error) throw new Error(`m0 read: prescriptions: ${error.message}`);
  const out = [];
  for (const rx of (data ?? []) as Array<{ id: string; version: number; status: string; signed_at: string | null }>) {
    const { count, error: itemsErr } = await admin
      .from("prescription_items")
      .select("id", { count: "exact", head: true })
      .eq("prescription_id", rx.id);
    if (itemsErr) throw new Error(`m0 read: prescription items: ${itemsErr.message}`);
    out.push({ ...rx, items: count ?? 0 });
  }
  return out;
}

export async function prescriptionItemNames(visitId: string): Promise<string[]> {
  const admin = getAdminClient();
  const { data: rx, error } = await admin.from("prescriptions").select("id").eq("visit_id", visitId);
  if (error) throw new Error(`m0 read: prescriptions: ${error.message}`);
  const ids = ((rx ?? []) as Array<{ id: string }>).map((r) => r.id);
  if (ids.length === 0) return [];
  const { data, error: itemsErr } = await admin
    .from("prescription_items")
    .select("medicine_name")
    .in("prescription_id", ids)
    .order("sort_order", { ascending: true });
  if (itemsErr) throw new Error(`m0 read: prescription items: ${itemsErr.message}`);
  return ((data ?? []) as Array<{ medicine_name: string }>).map((r) => r.medicine_name);
}

export async function diagnosesOf(visitId: string): Promise<string[]> {
  const { data, error } = await getAdminClient()
    .from("consultation_diagnoses")
    .select("diagnosis_name")
    .eq("visit_id", visitId);
  if (error) throw new Error(`m0 read: diagnoses: ${error.message}`);
  return ((data ?? []) as Array<{ diagnosis_name: string }>).map((r) => r.diagnosis_name);
}

export interface InvoiceWithPayments {
  id: string;
  status: string;
  total_amount: number;
  payments: Array<{ amount: number; payment_method: string; reference_number: string | null }>;
}

export async function invoicesOf(visitId: string): Promise<InvoiceWithPayments[]> {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from("invoices")
    .select("id, status, total_amount")
    .eq("visit_id", visitId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`m0 read: invoices: ${error.message}`);
  const out: InvoiceWithPayments[] = [];
  for (const inv of (data ?? []) as Array<{ id: string; status: string; total_amount: number | string }>) {
    const { data: pays, error: payErr } = await admin
      .from("payments")
      .select("amount, payment_method, reference_number")
      .eq("invoice_id", inv.id)
      .order("recorded_at", { ascending: true });
    if (payErr) throw new Error(`m0 read: payments: ${payErr.message}`);
    out.push({
      id: inv.id,
      status: inv.status,
      total_amount: Number(inv.total_amount),
      payments: ((pays ?? []) as Array<{ amount: number | string; payment_method: string; reference_number: string | null }>).map(
        (p) => ({ amount: Number(p.amount), payment_method: p.payment_method, reference_number: p.reference_number }),
      ),
    });
  }
  return out;
}

export async function tenantName(tenantId: string): Promise<string> {
  const row = must(
    await getAdminClient().from("tenants").select("name").eq("id", tenantId).single(),
    "tenant read",
  ) as { name: string };
  return row.name;
}

/** Escapes a literal for use inside a RegExp. */
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
