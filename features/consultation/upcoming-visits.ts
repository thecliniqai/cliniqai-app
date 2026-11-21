import "server-only";

import type { ServiceContext } from "@/lib/auth/context";
import { errorTag, log } from "@/lib/log";
import { getRequestId } from "@/lib/log/request-id";

/**
 * The instants of a patient's booked or confirmed visits with one doctor from three days ago onward (V2-09b 09B-04b, R-15, Q-14): the read behind the
 * display rule of "Book follow-up" (the follow-up row is sealed with its visit, so nothing about a booking is stored on it). Read on the caller's own
 * client under RLS; the tenant comes from the session. A failed read is "none" (the action is offered).
 */
export async function getUpcomingVisitInstants(ctx: ServiceContext, patientId: string, doctorId: string, now: Date = new Date()): Promise<string[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (ctx.db.from("visits") as any)
    .select("scheduled_at")
    .eq("tenant_id", ctx.tenantId)
    .eq("patient_id", patientId)
    .eq("doctor_id", doctorId)
    .in("status", ["booked", "confirmed"])
    .gte("scheduled_at", new Date(now.getTime() - 3 * 86_400_000).toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(20);
  if (error || !data) {
    log.error({ event: "consultation.upcoming_visits.failed", code: errorTag(error), requestId: await getRequestId(), tenantId: ctx.tenantId });
    return [];
  }
  return (data as { scheduled_at: string | null }[]).flatMap((v) => (v.scheduled_at ? [v.scheduled_at] : []));
}
