import "server-only";

import { assertPerm } from "@/lib/permissions";
import type { ServiceContext } from "@/lib/auth/context";
import { errorTag, log } from "@/lib/log";
import { getRequestId } from "@/lib/log/request-id";
import { isRangeOk, parseScheduleRange, type ScheduleRange } from "./range";

/**
 * Schedule read model (V2-08 08-04b, P1-31; one read since V2-09e 09E-12, R-10): a range of clinic dates (at most 42) for the Schedule screen.
 * `public.schedule_range` (STABLE INVOKER, `appointments:view`) answers the clinic's zone, the server's time, the clinic versions it reflects, the
 * clinicians, the blocks, the range's non-cancelled scheduled visits, the waiting list and (unless `withSlots` is false) the free slots of each clinician
 * and date from the database's own slot list, in one statement on the user's own JWT client, so RLS decides what a row may hold. The day, agenda and week
 * views are built from the answer on the device (`buildScheduleData`). Tenant and role come from `ctx` (ADR-0005 D1), never from a caller's input. The
 * 09D per-(doctor, date) `available_slots` batching is no longer on this path.
 */
export async function getScheduleRange(
  ctx: ServiceContext,
  range: { from: string; to: string; withSlots?: boolean },
): Promise<{ ok: true; range: ScheduleRange } | { ok: false; reason: "invalid" | "failed" }> {
  assertPerm(ctx.role, "appointments:view");
  if (!isRangeOk(range.from, range.to)) return { ok: false, reason: "invalid" };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (ctx.db as any).rpc("schedule_range", {
    p_tenant_id: ctx.tenantId,
    p_from: range.from,
    p_to: range.to,
    p_include_slots: range.withSlots ?? true,
  });
  if (error) {
    log.error({ event: "schedule.range.failed", code: errorTag(error), requestId: await getRequestId(), tenantId: ctx.tenantId });
    return { ok: false, reason: "failed" };
  }
  const parsed = parseScheduleRange(data, range.from, range.to);
  if (!parsed) {
    // NULL: the database refused (no permission, not a member of a full clinic), or the answer was not the documented shape.
    log.error({ event: "schedule.range.failed", code: "empty", requestId: await getRequestId(), tenantId: ctx.tenantId });
    return { ok: false, reason: "failed" };
  }
  return { ok: true, range: parsed };
}
