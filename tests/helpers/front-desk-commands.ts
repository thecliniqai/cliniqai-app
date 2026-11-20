/**
 * Shared seeds and read-backs for the V2-07 07-03 front-desk command specs (enqueue_walk_in, register_and_book,
 * complete_and_bill, available_slots). Synthetic data only; rows are seeded and read with the service-role client,
 * commands are called with the caller's own client.
 */
import { randomUUID } from "node:crypto";
import { insertReturningId, type TestDb } from "./db";
import { getAdminClient } from "./supabase-admin";
import type { SeededTenant } from "./tenants";
import { ITEMS_700 } from "./billing-commands";
import type { Database } from "@/types/database";

type Fns = Database["public"]["Functions"];
export type WalkInArgs = Fns["enqueue_walk_in"]["Args"];
export type RegisterAndBookArgs = Fns["register_and_book"]["Args"];
export type CompleteAndBillArgs = Fns["complete_and_bill"]["Args"];

/** A synthetic Indian mobile number in the form a patient form sends (ten digits). */
export function syntheticMobile(): string {
  return `98${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
}

export type NewPatientFixture = Record<string, string | number | boolean | null>;

/** A new-patient object for `p_new_patient`; `marker` makes the name findable. */
export function newPatient(marker: string, over: Record<string, unknown> = {}): NewPatientFixture {
  return { full_name: `Synthetic ${marker}`, phone: syntheticMobile(), age: 34, ...over };
}

export async function seedPatient(t: Pick<SeededTenant, "tenantId" | "userId">, over: Record<string, unknown> = {}): Promise<string> {
  return insertReturningId(getAdminClient(), "patients", {
    tenant_id: t.tenantId,
    full_name: "Synthetic Desk Patient",
    phone: `+91${syntheticMobile()}`,
    created_by: t.userId,
    ...over,
  });
}

export function walkInArgs(t: Pick<SeededTenant, "tenantId" | "userId">, over: Partial<WalkInArgs> = {}): WalkInArgs {
  return {
    p_tenant_id: t.tenantId,
    p_patient_id: null as unknown as string,
    p_new_patient: null as unknown as WalkInArgs["p_new_patient"],
    p_doctor_id: t.userId,
    p_priority: "normal",
    p_client_request_id: randomUUID(),
    ...over,
  };
}

export function registerAndBookArgs(
  t: Pick<SeededTenant, "tenantId" | "userId">,
  scheduledAt: string,
  over: Partial<RegisterAndBookArgs> = {}
): RegisterAndBookArgs {
  return {
    p_tenant_id: t.tenantId,
    p_patient_id: null as unknown as string,
    p_new_patient: null as unknown as RegisterAndBookArgs["p_new_patient"],
    p_doctor_id: t.userId,
    p_scheduled_at: scheduledAt,
    p_duration_minutes: 15,
    p_overbook: false,
    p_client_request_id: randomUUID(),
    ...over,
  };
}

/** `complete_and_bill` arguments: the two-line bill of 700 less 50 (650), the payment of the whole bill in cash by default. */
export function completeAndBillArgs(
  t: Pick<SeededTenant, "tenantId">,
  visitId: string,
  over: Partial<CompleteAndBillArgs> = {}
): CompleteAndBillArgs {
  return {
    p_tenant_id: t.tenantId,
    p_visit_id: visitId,
    p_items: ITEMS_700,
    p_discount: 50,
    p_tax: 0,
    p_payment: { method: "cash" },
    p_client_request_id: randomUUID(),
    ...over,
  };
}

export const callWalkIn = (db: TestDb, args: WalkInArgs) => db.rpc("enqueue_walk_in", args);
export const callRegisterAndBook = (db: TestDb, args: RegisterAndBookArgs) => db.rpc("register_and_book", args);
export const callCompleteAndBill = (db: TestDb, args: CompleteAndBillArgs) => db.rpc("complete_and_bill", args);

/** Patients of a clinic whose name carries `marker` (the specs name every patient they register). */
export async function patientsMarked(tenantId: string, marker: string) {
  const { data, error } = await getAdminClient()
    .from("patients")
    .select("id, full_name, phone, age, date_of_birth, created_by, tenant_id")
    .eq("tenant_id", tenantId)
    .like("full_name", `%${marker}%`);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function visitsOfPatient(patientId: string) {
  const { data, error } = await getAdminClient()
    .from("visits")
    .select(
      "id, tenant_id, status, origin_type, doctor_id, scheduled_at, estimated_duration_minutes, reason_for_visit, is_overbooked, created_by, location_id"
    )
    .eq("patient_id", patientId);
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Booking messages queued for one visit. */
export async function messagesOfVisit(visitId: string) {
  const { data, error } = await getAdminClient()
    .from("communication_queue")
    .select("id, tenant_id, patient_id, channel, message_type, template_id, template_params, recipient_phone, dedupe_key, metadata, created_by")
    .eq("appointment_id", visitId);
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** A weekly schedule with the same shifts every day (or none when `shifts` is empty). */
export function weekSchedule(shifts: Array<{ start: string; end: string }>, opts: { sunday?: boolean } = {}) {
  const day = { enabled: shifts.length > 0, shifts };
  return {
    monday: day,
    tuesday: day,
    wednesday: day,
    thursday: day,
    friday: day,
    saturday: day,
    sunday: opts.sunday === false ? { enabled: false, shifts: [] } : day,
  };
}

export async function setSchedule(tenantId: string, userId: string, schedule: unknown, slotMinutes?: number): Promise<void> {
  const { error } = await getAdminClient()
    .from("memberships")
    .update({ availability_schedule: schedule as never, ...(slotMinutes ? { default_slot_duration_minutes: slotMinutes } : {}) })
    .eq("tenant_id", tenantId)
    .eq("user_id", userId);
  if (error) throw new Error(`seed schedule failed: ${error.message}`);
}

export async function seedBlock(
  t: Pick<SeededTenant, "tenantId" | "userId">,
  startIso: string,
  endIso: string,
  doctorId: string | null
): Promise<string> {
  return insertReturningId(getAdminClient(), "schedule_blocks", {
    tenant_id: t.tenantId,
    doctor_id: doctorId,
    start_time: startIso,
    end_time: endIso,
    reason: "Synthetic block",
    created_by: t.userId,
  });
}

/** A scheduled, booked visit for `doctorId` (seeded straight into the table). */
export async function seedBookedVisit(
  t: Pick<SeededTenant, "tenantId" | "userId">,
  patientId: string,
  doctorId: string,
  scheduledAt: string,
  over: Record<string, unknown> = {}
): Promise<string> {
  return insertReturningId(getAdminClient(), "visits", {
    tenant_id: t.tenantId,
    patient_id: patientId,
    doctor_id: doctorId,
    origin_type: "scheduled",
    status: "booked",
    scheduled_at: scheduledAt,
    estimated_duration_minutes: 15,
    created_by: t.userId,
    ...over,
  });
}
