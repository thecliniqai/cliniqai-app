import "server-only";

import { assertPerm, hasPerm } from "@/lib/permissions";
import type { ServiceContext } from "@/lib/auth/context";
import { errorTag, log } from "@/lib/log";
import { getRequestId } from "@/lib/log/request-id";
import type { Versions } from "@/lib/live/domains";
import { buildTodayBoard } from "./board-model";
import type { TodayBoard } from "./schema";

/**
 * Today's read model (V2-08 08-03a, R-10, M4.2; one read since V2-09e 09E-06, R-9, R-12): one clinic day of visits for the front desk, with the role's own
 * view of each row. `public.today_board` (STABLE INVOKER, `appointments:view`) answers the clinic's zone, the clinic versions it reflects, the doctors and the
 * day's visits in one statement on the user's own JWT client, so RLS decides what a row may hold; `buildTodayBoard` turns the answer into the model.
 * Tenant and role come from `ctx` (ADR-0005 D1), never from a caller's input.
 * - allergy flag: only for a role with `vitals:view` or `consultations:view` (a flag, never the allergen names);
 * - vitals (and "Vitals pending"): only for a role that reads `clinical_notes` (`consultations:view`);
 * - balance due: only for a role with `billing:view`; a completed visit with money due is "To bill".
 * The clinic day is the clinic's own: a booking belongs to the day of its appointment time, a walk-in (no appointment time)
 * to the day it was created, both in the clinic's zone (a visit created at 00:10 IST belongs to that IST date).
 * Cancelled and no-show visits stay in the list (Done lane, own chip) so the day reconciles.
 */
export interface TodayBoardOptions {
  /** Only this doctor's visits (a doctor's own queue). */
  doctorId?: string;
  /** The screen mode (`front`, `triage`, `doctor`); 08-03a lists the same day for every mode. */
  mode?: "front" | "triage" | "doctor";
  /** The clinic date to read (`YYYY-MM-DD`); defaults to the clinic's today. Tests and other days only. */
  date?: string;
  now?: Date;
}

export async function getTodayBoard(
  ctx: ServiceContext,
  options: TodayBoardOptions = {}
): Promise<{ ok: true; board: TodayBoard; versions: Versions | null } | { ok: false }> {
  assertPerm(ctx.role, "appointments:view");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (ctx.db as any).rpc("today_board", {
    p_tenant_id: ctx.tenantId,
    p_mode: options.mode ?? "front",
    p_doctor_id: options.doctorId ?? null,
    p_date: options.date ?? null,
  });
  if (error) {
    log.error({ event: "today.board.failed", code: errorTag(error), requestId: await getRequestId(), tenantId: ctx.tenantId });
    return { ok: false };
  }
  const built = buildTodayBoard(data, ctx.role, { now: options.now, today: options.date });
  if (!built) {
    // NULL: the database refused (no permission or not a member), or the answer was not the documented shape.
    log.error({ event: "today.board.failed", code: "empty", requestId: await getRequestId(), tenantId: ctx.tenantId });
    return { ok: false };
  }
  return { ok: true, board: built.board, versions: built.versions };
}

export { toVitalsReading } from "./board-model";

const one = <T>(value: T | T[] | null | undefined): T | null => (Array.isArray(value) ? (value[0] ?? null) : (value ?? null));

/** An amendment still open on one of the doctor's own signed visits (V2-09b 09B-04a, hand-off of V2-09a): the visit, who it is, and when it was reopened. */
export interface OpenAmendment {
  visitId: string;
  patientName: string;
  /** The reopen time (the latest `visit_revisions.amended_at`); null when it could not be read. */
  openedAt: string | null;
}

/**
 * The calling doctor's open amendments: their own signed visits that are in consultation again (`signed_at IS NOT NULL AND status = 'in_consultation'`),
 * on any day, newest first, at most 20. Read on the user's own client under RLS (consultations:view); a role without it, or a failed read, has none.
 * T-09A-07 (an abandoned amendment) is accepted with a safe exit (Finalize with no change); this is what makes one findable.
 */
export async function getOpenAmendments(ctx: ServiceContext): Promise<OpenAmendment[]> {
  if (!hasPerm(ctx.role, "consultations:view")) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (ctx.db.from("visits") as any)
    .select("id, updated_at, patients(full_name)")
    .eq("tenant_id", ctx.tenantId)
    .eq("doctor_id", ctx.userId)
    .eq("status", "in_consultation")
    .not("signed_at", "is", null)
    .order("updated_at", { ascending: false })
    .limit(20);
  if (error || !data) {
    log.error({ event: "today.open_amendments.failed", code: errorTag(error), requestId: await getRequestId(), tenantId: ctx.tenantId });
    return [];
  }
  const rows = data as { id: string; patients: { full_name: string } | { full_name: string }[] | null }[];
  if (rows.length === 0) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: revisions } = await (ctx.db.from("visit_revisions") as any)
    .select("visit_id, amended_at")
    .eq("tenant_id", ctx.tenantId)
    .in("visit_id", rows.map((r) => r.id))
    .order("amended_at", { ascending: false });
  const opened = new Map<string, string>();
  for (const r of (revisions ?? []) as { visit_id: string; amended_at: string }[]) if (!opened.has(r.visit_id)) opened.set(r.visit_id, r.amended_at);
  return rows.map((r) => ({ visitId: r.id, patientName: one(r.patients)?.full_name ?? "Patient", openedAt: opened.get(r.id) ?? null }));
}
