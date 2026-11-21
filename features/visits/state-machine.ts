/**
 * The visit state machine (V2-08 08-01b, R-7), written twice: this table drives which buttons a row shows; the database
 * function `private.visit_transition_allowed` plus the BEFORE UPDATE OF status trigger `visits_status_transition_guard`
 * (migration 000100) refuse everything else for every writer. `tests/visits/state-machine.spec.ts` compares the two over the
 * full status x status x signed matrix, so a change here without the migration (or the reverse) fails a test.
 *
 * Pure and client-safe: no server-only import.
 */
import type { VisitStatus } from "@/lib/db/types";
import { todayInTz, ymdOf, DEFAULT_CLINIC_TZ } from "@/lib/datetime";
import type { Permission } from "@/lib/permissions";

export const VISIT_STATUSES = [
  "booked",
  "confirmed",
  "waiting",
  "in_consultation",
  "completed",
  "cancelled",
  "no_show",
] as const satisfies readonly VisitStatus[];

/** From -> the statuses it may move to, with the command that writes each (R-7). */
export const VISIT_TRANSITIONS: Readonly<Record<VisitStatus, readonly VisitStatus[]>> = {
  // confirm_appointment (confirmed), check_in_visit / start_consultation (waiting), reschedule_visit (booked, the new time),
  // mark_no_show (no_show), cancel_visit (cancelled)
  booked: ["confirmed", "waiting", "booked", "no_show", "cancelled"],
  confirmed: ["waiting", "booked", "no_show", "cancelled"],
  // check_in_visit (waiting: a late arrival, R-8), reschedule_visit (booked: a rebook)
  no_show: ["waiting", "booked"],
  // start_consultation (in_consultation), sign_consultation / complete_and_bill / complete_visit (completed), cancel_visit
  waiting: ["in_consultation", "completed", "cancelled"],
  // sign_consultation / complete_and_bill / complete_visit / finalize_visit_amendment (completed)
  in_consultation: ["completed"],
  // reopen_visit_for_amendment: only a signed visit (the integrity guard of 000077 still demands the database snapshot)
  completed: ["in_consultation"],
  // nothing leaves cancelled
  cancelled: [],
};

/** True when `from -> to` is a move the state machine lists; the signed reopen needs `signed`. */
export function canTransition(from: VisitStatus, to: VisitStatus, signed = false): boolean {
  if (from === "completed" && to === "in_consultation") return signed;
  return VISIT_TRANSITIONS[from]?.includes(to) ?? false;
}

export type RowAction =
  | "check_in"
  | "start"
  | "record_vitals"
  | "collect"
  | "reschedule"
  | "no_show"
  | "cancel";

export interface RowActionVisit {
  status: VisitStatus;
  /** The appointment time; null for a walk-in. */
  scheduledAt: string | null;
  /** True once the consultation is signed. */
  signed?: boolean;
}

/**
 * The actions a Today / Schedule row offers for `visit`, in the order the row shows them. `permissions` is the caller's
 * role permissions (`ROLE_PERMISSIONS[role]`); the server commands check them again. A booking is checked in or started only on
 * its own clinic-local day (R-8); "no-show" is offered once the appointment time has passed.
 */
export function rowActions(
  permissions: readonly Permission[],
  visit: RowActionVisit,
  now: Date,
  timeZone: string = DEFAULT_CLINIC_TZ
): RowAction[] {
  const can = (perm: Permission) => permissions.includes("*") || permissions.includes(perm);
  const { status } = visit;
  const out: RowAction[] = [];

  const queueable = status === "booked" || status === "confirmed" || status === "no_show";
  const onItsDay = visit.scheduledAt == null || ymdOf(visit.scheduledAt, timeZone) === todayInTz(timeZone, now);

  if (can("appointments:edit") && queueable && onItsDay && canTransition(status, "waiting")) out.push("check_in");
  if (
    can("appointments:edit") &&
    can("consultations:edit") &&
    ((queueable && onItsDay) || status === "waiting")
  ) {
    out.push("start");
  }
  if (can("vitals:edit") && (status === "waiting" || status === "in_consultation")) out.push("record_vitals");
  if (can("billing:collect") && status === "completed") out.push("collect");
  if (can("appointments:edit") && (status === "booked" || status === "confirmed" || status === "no_show")) out.push("reschedule");
  if (
    can("appointments:edit") &&
    canTransition(status, "no_show") &&
    visit.scheduledAt != null &&
    new Date(visit.scheduledAt).getTime() <= now.getTime()
  ) {
    out.push("no_show");
  }
  if (can("appointments:edit") && canTransition(status, "cancelled")) out.push("cancel");
  return out;
}
