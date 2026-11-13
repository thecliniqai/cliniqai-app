import "server-only";

import { assertPerm } from "@/lib/permissions";
import type { ServiceContext } from "@/lib/auth/context";
import { recordAudit } from "@/lib/audit/audit";
import { isDateOnly } from "@/lib/utils/filter-values";
import { dayWindowUtc } from "@/lib/datetime";
import { getTenantTimeZone, getTenantToday } from "@/lib/datetime/server";
import { QueuePriority, QueueToken, Visit, Patient } from "@/lib/db/types";
import type { QueueItem } from "@/components/queue/queue-card";
import { getTenantDoctorMap } from "@/features/staff/service";
import { errorTag, log } from "@/lib/log";
import { getRequestId } from "@/lib/log/request-id";
import { clientErrorMessage } from "@/lib/errors/client-message";

// Queue use-cases (check-in, state transitions, day board). Tenant and actor come only from `ctx` (ADR-0005 D1);
// each use-case checks the permission its server action checked before the move.

export type CheckInResult =
  | { success: true; tokenNumber: number; queueTokenId: string }
  | { success: false; error: string };

export async function checkInVisit(
  ctx: ServiceContext,
  visitId: string,
  priority: QueuePriority = "normal"
): Promise<CheckInResult> {
  const supabase = ctx.db;

  try {
    assertPerm(ctx.role, "appointments:edit");
    const session = ctx;
    // The token's day is the clinic date in the tenant's zone (V2-03 03-05); the SQL `DEFAULT CURRENT_DATE` is
    // never relied on (R-33; V2-05 05-08 owns the counter rework).
    const { today } = await getTenantToday(supabase, session.tenantId);

    // 1. Verify visit belongs to tenant and get current state
    // By id AND the active clinic: RLS admits every clinic the user belongs to, so a member of two clinics acting in
    // one must not reach the other's visit by id (AR-M2b).
    const { data: visit, error: visitError } = (await (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase.from("visits") as any
    )
      .select("*")
      .eq("id", visitId)
      .eq("tenant_id", session.tenantId)
      .single()) as { data: Visit | null; error: { message: string } | null };

    if (visitError || !visit) {
      return { success: false, error: "Visit record not found." };
    }

    // 2. Check if a token already exists for this visit
    const { data: existingToken } = (await (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase.from("queue_tokens") as any
    )
      .select("*")
      .eq("visit_id", visitId)
      .eq("tenant_id", session.tenantId)
      .maybeSingle()) as { data: QueueToken | null; error: unknown };

    if (existingToken) {
      return {
        success: true,
        tokenNumber: existingToken.token_number,
        queueTokenId: existingToken.id,
      };
    }

    // 3. Atomically generate daily sequential token number via RPC
    const { data: tokenNumber, error: rpcError } = await (
      supabase as unknown as {
        rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: number | null; error: { message: string } | null }>;
      }
    ).rpc("generate_daily_queue_token", {
      p_tenant_id: session.tenantId,
      p_date: today,
    });

    if (rpcError || tokenNumber == null) {
      log.error({ event: "queue.token_generate.failed", code: errorTag(rpcError), requestId: await getRequestId(), tenantId: ctx.tenantId });
      return { success: false, error: "Failed to generate queue token." };
    }

    // 4. Insert queue_token record
    const { data: newToken, error: tokenInsertError } = await (
      supabase.from("queue_tokens") as unknown as {
        insert: (row: Record<string, unknown>) => {
          select: (cols: string) => {
            single: () => Promise<{ data: { id: string } | null; error: { message: string } | null }>;
          };
        };
      }
    )
      .insert({
        tenant_id: session.tenantId,
        visit_id: visitId,
        date: today,
        token_number: tokenNumber,
        priority: priority,
      })
      .select("id")
      .single();

    if (tokenInsertError || !newToken) {
      log.error({ event: "queue.token_insert.failed", code: errorTag(tokenInsertError), requestId: await getRequestId(), tenantId: ctx.tenantId });
      return { success: false, error: "Failed to register queue entry." };
    }

    // 5. Update visit status to 'waiting'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from("visits") as any)
      .update({
        status: "waiting",
        updated_at: new Date().toISOString(),
      })
      .eq("id", visitId)
      .eq("tenant_id", session.tenantId);

    // 6. Record audit log
    await recordAudit(ctx, {
      action: "queue.check_in",
      entityType: "queue_token",
      entityId: newToken.id,
      metadata: {
        token_number: tokenNumber,
        priority,
      },
    });

    return {
      success: true,
      tokenNumber,
      queueTokenId: newToken.id,
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: clientErrorMessage(err, "Failed to check in visit.", "queue.check_in_visit.failed"),
    };
  }
}

export type TransitionStateResult =
  | { success: true }
  | { success: false; error: string };

/** Visit statuses the queue may move forward (AR2-L2). */
const QUEUE_OPEN_STATUSES = ["booked", "confirmed", "waiting", "in_consultation"];

export const QUEUE_TRANSITION_REFUSED_MESSAGE =
  "This visit can no longer be moved in the queue. Signed or closed consultations change only through an amendment.";

type QueueTokenUpdate = {
  update: (vals: Record<string, unknown>) => {
    eq: (col: string, val: string) => {
      eq: (col: string, val: string) => Promise<{ error: unknown }>;
    };
  };
};

export async function transitionQueueState(
  ctx: ServiceContext,
  visitId: string,
  targetState: "in_consultation" | "completed"
): Promise<TransitionStateResult> {
  const supabase = ctx.db;

  try {
    assertPerm(ctx.role, "appointments:edit");
    const nowIso = new Date().toISOString();

    if (targetState !== "in_consultation" && targetState !== "completed") {
      return { success: false, error: QUEUE_TRANSITION_REFUSED_MESSAGE };
    }

    // AR2-L2: the queue moves only open, unsigned visits forward. A completed or cancelled visit never goes back to
    // in_consultation, and a signed visit (including one reopened for amendment) is never moved by the queue: only
    // the amendment flow (reopenVisitForAmendment / finalizeVisitAmendment) changes those. The precondition sits in
    // the UPDATE filter, so a concurrent sign-off cannot slip between a read and the write.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: moved, error: moveErr } = await (supabase.from("visits") as any)
      .update({ status: targetState, updated_at: nowIso })
      .eq("id", visitId)
      .eq("tenant_id", ctx.tenantId)
      .in("status", QUEUE_OPEN_STATUSES)
      .is("signed_at", null)
      .select("id");

    if (moveErr) {
      log.error({ event: "queue.transition.failed", code: errorTag(moveErr), requestId: await getRequestId(), tenantId: ctx.tenantId });
      return { success: false, error: "Failed to transition queue state." };
    }

    if (!moved || moved.length === 0) {
      // Completing an already-completed visit (checkout after sign-off) is a no-op, not an error.
      if (targetState === "completed") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: current } = await (supabase.from("visits") as any)
          .select("status")
          .eq("id", visitId)
          .eq("tenant_id", ctx.tenantId)
          .maybeSingle();
        if (current?.status === "completed") {
          await (supabase.from("queue_tokens") as unknown as QueueTokenUpdate)
            .update({ completed_at: nowIso })
            .eq("visit_id", visitId)
            .eq("tenant_id", ctx.tenantId);
          return { success: true };
        }
      }
      return { success: false, error: QUEUE_TRANSITION_REFUSED_MESSAGE };
    }

    await (supabase.from("queue_tokens") as unknown as QueueTokenUpdate)
      .update(targetState === "in_consultation" ? { called_at: nowIso } : { completed_at: nowIso })
      .eq("visit_id", visitId)
      .eq("tenant_id", ctx.tenantId);

    await recordAudit(ctx, {
      action: "queue.transition",
      entityType: "visit",
      entityId: visitId,
      metadata: {
        new_status: targetState,
      },
    });

    return { success: true };
  } catch (err: unknown) {
    return {
      success: false,
      error: clientErrorMessage(err, "Failed to transition queue state.", "queue.transition_queue_state.failed"),
    };
  }
}

interface QueueRow extends Visit {
  patients?: Patient | null;
  queue_tokens?: QueueToken | QueueToken[] | null;
}

export type GetQueueResult = { success: true; items: QueueItem[] } | { success: false; error: string };

export async function getQueueForDate(
  ctx: ServiceContext,
  dateStr: string,
  doctorId?: string
): Promise<GetQueueResult> {
  const supabase = ctx.db;

  try {
    assertPerm(ctx.role, "appointments:view");
    const session = ctx;

    // The date is interpolated into PostgREST filter strings below, so only YYYY-MM-DD is accepted.
    if (!isDateOnly(dateStr)) {
      return { success: false, error: "Failed to load queue for date." };
    }

    // The clinic day in the tenant's zone, half-open (V2-03 03-05).
    const { startIso: startOfDay, endIsoExclusive: endOfDay } = dayWindowUtc(
      dateStr,
      await getTenantTimeZone(supabase, session.tenantId)
    );

    const query = (supabase.from("visits") as unknown as {
      select: (cols: string) => {
        eq: (col: string, val: string) => {
          or: (f1: string) => {
            or: (f2: string) => Promise<{ data: QueueRow[] | null; error: { message: string } | null }> & {
              eq: (col: string, val: string) => Promise<{ data: QueueRow[] | null; error: { message: string } | null }>;
            };
          };
        };
      };
    })
      .select("*, patients(*), queue_tokens(*)")
      .eq("tenant_id", session.tenantId)
      .or(`scheduled_at.gte.${startOfDay},created_at.gte.${startOfDay}`)
      .or(`scheduled_at.lt.${endOfDay},created_at.lt.${endOfDay}`);

    let data: QueueRow[] | null = null;
    let error: { message: string } | null = null;

    if (doctorId && doctorId !== "all") {
      const res = await query.eq("doctor_id", doctorId);
      data = res.data;
      error = res.error;
    } else {
      const res = await query;
      data = res.data;
      error = res.error;
    }

    if (error) {
      log.error({ event: "queue.list.failed", code: errorTag(error), requestId: await getRequestId(), tenantId: ctx.tenantId });
      return { success: false, error: "Failed to load queue for date." };
    }

    const doctorMap = await getTenantDoctorMap(ctx);

    const items: QueueItem[] = (data || []).map((row) => {
      const queueToken = Array.isArray(row.queue_tokens)
        ? row.queue_tokens[0] || null
        : row.queue_tokens || null;

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { patients, queue_tokens: _qt, ...visitData } = row;
      const resolvedDocName = row.doctor_id ? doctorMap[row.doctor_id] : null;

      return {
        visit: visitData as Visit,
        patient: patients || null,
        queueToken: queueToken || null,
        doctorName: resolvedDocName || (row.doctor_id ? "Doctor" : "Clinic"),
      };
    });

    const statusOrder: Record<string, number> = {
      in_consultation: 1,
      waiting: 2,
      booked: 3,
      confirmed: 3,
      completed: 4,
      cancelled: 5,
      no_show: 6,
    };

    items.sort((a, b) => {
      const orderA = statusOrder[a.visit.status] ?? 99;
      const orderB = statusOrder[b.visit.status] ?? 99;
      if (orderA !== orderB) return orderA - orderB;

      if (a.visit.status === "waiting" && b.visit.status === "waiting") {
        const tokenA = a.queueToken?.token_number ?? 999999;
        const tokenB = b.queueToken?.token_number ?? 999999;
        return tokenA - tokenB;
      }

      if (a.visit.scheduled_at && b.visit.scheduled_at) {
        return new Date(a.visit.scheduled_at).getTime() - new Date(b.visit.scheduled_at).getTime();
      }

      return new Date(a.visit.created_at).getTime() - new Date(b.visit.created_at).getTime();
    });

    return { success: true, items };
  } catch (err: unknown) {
    return {
      success: false,
      error: clientErrorMessage(err, "Failed to fetch queue.", "queue.get_queue_for_date.failed"),
    };
  }
}
