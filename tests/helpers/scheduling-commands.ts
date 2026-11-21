/**
 * Shared seeds and calls for the V2-08 08-04a staff scheduling command specs (reschedule_visit, cancel_visit, mark_no_show,
 * confirm_appointment, add_to_waitlist, promote_waitlist_entry). Synthetic data only; rows are seeded and read with the
 * service-role client, commands are called with the caller's own client.
 */
import { randomUUID } from "node:crypto";
import { insertReturningId, type TestDb } from "./db";
import { getAdminClient } from "./supabase-admin";
import type { SeededTenant } from "./tenants";
import type { Database } from "@/types/database";

type Fns = Database["public"]["Functions"];
export type RescheduleArgs = Fns["reschedule_visit"]["Args"];
export type CancelArgs = Fns["cancel_visit"]["Args"];
export type MarkNoShowArgs = Fns["mark_no_show"]["Args"];
export type ConfirmArgs = Fns["confirm_appointment"]["Args"];
export type AddToWaitlistArgs = Fns["add_to_waitlist"]["Args"];
export type PromoteArgs = Fns["promote_waitlist_entry"]["Args"];

type Tenant = Pick<SeededTenant, "tenantId" | "userId">;

/** The instant of IST wall-clock `h:mm` on Monday 3 Mar 2031 + `week` weeks + `dow` days (inside the default hours on Mon-Sat). */
export function ist(week: number, dow: number, h: number, mm = 0): string {
  return new Date(Date.UTC(2031, 2, 3 + week * 7 + dow, h, mm) - 330 * 60_000).toISOString();
}

export function rescheduleArgs(t: Tenant, visitId: string, at: string, over: Partial<RescheduleArgs> = {}): RescheduleArgs {
  return { p_tenant_id: t.tenantId, p_visit_id: visitId, p_new_scheduled_at: at, p_client_request_id: randomUUID(), ...over };
}

export function cancelArgs(t: Tenant, visitId: string, over: Partial<CancelArgs> = {}): CancelArgs {
  return { p_tenant_id: t.tenantId, p_visit_id: visitId, p_reason_code: "patient_request", p_client_request_id: randomUUID(), ...over };
}

export function markNoShowArgs(t: Tenant, visitId: string, over: Partial<MarkNoShowArgs> = {}): MarkNoShowArgs {
  return { p_tenant_id: t.tenantId, p_visit_id: visitId, p_client_request_id: randomUUID(), ...over };
}

export function confirmArgs(t: Tenant, visitId: string, over: Partial<ConfirmArgs> = {}): ConfirmArgs {
  return { p_tenant_id: t.tenantId, p_visit_id: visitId, p_client_request_id: randomUUID(), ...over };
}

export function addToWaitlistArgs(t: Tenant, patientId: string, date: string, over: Partial<AddToWaitlistArgs> = {}): AddToWaitlistArgs {
  return { p_tenant_id: t.tenantId, p_patient_id: patientId, p_target_date: date, p_client_request_id: randomUUID(), ...over };
}

export function promoteArgs(t: Tenant, entryId: string, at: string, over: Partial<PromoteArgs> = {}): PromoteArgs {
  return { p_tenant_id: t.tenantId, p_entry_id: entryId, p_scheduled_at: at, p_client_request_id: randomUUID(), ...over };
}

export const callReschedule = (db: TestDb, args: RescheduleArgs) => db.rpc("reschedule_visit", args);
export const callCancel = (db: TestDb, args: CancelArgs) => db.rpc("cancel_visit", args);
export const callMarkNoShow = (db: TestDb, args: MarkNoShowArgs) => db.rpc("mark_no_show", args);
export const callConfirm = (db: TestDb, args: ConfirmArgs) => db.rpc("confirm_appointment", args);
export const callAddToWaitlist = (db: TestDb, args: AddToWaitlistArgs) => db.rpc("add_to_waitlist", args);
export const callPromote = (db: TestDb, args: PromoteArgs) => db.rpc("promote_waitlist_entry", args);

/** The columns of a visit the scheduling commands change, read with the service-role client. */
export async function schedRow(visitId: string) {
  const { data, error } = await getAdminClient()
    .from("visits")
    .select("status, scheduled_at, doctor_id, estimated_duration_minutes, is_overbooked, metadata, patient_id")
    .eq("id", visitId)
    .single();
  if (error) throw new Error(error.message);
  return data;
}

/** A waitlist entry seeded straight into the table (status `waiting` unless given). */
export async function seedWaitlistEntry(
  t: Tenant,
  patientId: string,
  targetDate: string,
  over: Record<string, unknown> = {}
): Promise<string> {
  return insertReturningId(getAdminClient(), "waitlist_entries", {
    tenant_id: t.tenantId,
    patient_id: patientId,
    doctor_id: t.userId,
    target_date: targetDate,
    created_by: t.userId,
    ...over,
  });
}

export async function waitlistRow(entryId: string) {
  const { data, error } = await getAdminClient()
    .from("waitlist_entries")
    .select("status, promoted_visit_id, doctor_id, patient_id, notes, priority, time_window, target_date")
    .eq("id", entryId)
    .single();
  if (error) throw new Error(error.message);
  return data;
}

/** An active subscription of `t`'s clinic to the appointment events. */
export async function subscribeAppointmentEvents(t: Tenant): Promise<string> {
  return insertReturningId(getAdminClient(), "webhook_subscriptions", {
    tenant_id: t.tenantId,
    endpoint_url: `https://hooks.example.test/${randomUUID()}`,
    event_types: ["appointment.rescheduled", "appointment.cancelled"],
    signing_secret: randomUUID(),
    is_active: true,
    created_by: t.userId,
  });
}
