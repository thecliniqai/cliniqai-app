import "server-only";

import { assertPerm } from "@/lib/permissions";
import type { ServiceContext } from "@/lib/auth/context";
import { recordAudit } from "@/lib/audit/audit";
import { isDateOnly } from "@/lib/utils/filter-values";
import { QueuePriority, QueueToken, Visit, Patient } from "@/lib/db/types";
import type { QueueItem } from "@/components/queue/queue-card";
import { getTenantDoctorMap } from "@/features/staff/service";

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
    const today = new Date().toISOString().split("T")[0];

    // 1. Verify visit belongs to tenant and get current state
    const { data: visit, error: visitError } = await (
      supabase.from("visits") as unknown as {
        select: (cols: string) => {
          eq: (col: string, val: string) => {
            single: () => Promise<{ data: Visit | null; error: { message: string } | null }>;
          };
        };
      }
    )
      .select("*")
      .eq("id", visitId)
      .single();

    if (visitError || !visit) {
      return { success: false, error: "Visit record not found." };
    }

    // 2. Check if a token already exists for this visit
    const { data: existingToken } = await (
      supabase.from("queue_tokens") as unknown as {
        select: (cols: string) => {
          eq: (col: string, val: string) => {
            maybeSingle: () => Promise<{ data: QueueToken | null; error: unknown }>;
          };
        };
      }
    )
      .select("*")
      .eq("visit_id", visitId)
      .maybeSingle();

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
      console.error("[features/queue/service] Token generation RPC failed:", rpcError);
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
      console.error("[features/queue/service] Failed to insert queue token:", tokenInsertError);
      return { success: false, error: "Failed to register queue entry." };
    }

    // 5. Update visit status to 'waiting'
    await (
      supabase.from("visits") as unknown as {
        update: (row: Record<string, unknown>) => {
          eq: (col: string, val: string) => Promise<{ error: unknown }>;
        };
      }
    )
      .update({
        status: "waiting",
        updated_at: new Date().toISOString(),
      })
      .eq("id", visitId);

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
      error: err instanceof Error ? err.message : "Failed to check in visit.",
    };
  }
}

export type TransitionStateResult =
  | { success: true }
  | { success: false; error: string };

export async function transitionQueueState(
  ctx: ServiceContext,
  visitId: string,
  targetState: "in_consultation" | "completed"
): Promise<TransitionStateResult> {
  const supabase = ctx.db;

  try {
    assertPerm(ctx.role, "appointments:edit");
    const nowIso = new Date().toISOString();

    type UpdateTable = {
      update: (vals: Record<string, unknown>) => {
        eq: (col: string, val: string) => Promise<{ error: unknown }>;
      };
    };

    if (targetState === "in_consultation") {
      // Update queue token called_at
      await (supabase.from("queue_tokens") as unknown as UpdateTable)
        .update({ called_at: nowIso })
        .eq("visit_id", visitId);

      // Update visit status
      await (supabase.from("visits") as unknown as UpdateTable)
        .update({ status: "in_consultation", updated_at: nowIso })
        .eq("id", visitId);

      await recordAudit(ctx, {
        action: "queue.transition",
        entityType: "visit",
        entityId: visitId,
        metadata: {
          new_status: "in_consultation",
        },
      });
    } else if (targetState === "completed") {
      // Update queue token completed_at
      await (supabase.from("queue_tokens") as unknown as UpdateTable)
        .update({ completed_at: nowIso })
        .eq("visit_id", visitId);

      // Update visit status
      await (supabase.from("visits") as unknown as UpdateTable)
        .update({ status: "completed", updated_at: nowIso })
        .eq("id", visitId);

      await recordAudit(ctx, {
        action: "queue.transition",
        entityType: "visit",
        entityId: visitId,
        metadata: {
          new_status: "completed",
        },
      });
    }

    return { success: true };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to transition queue state.",
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

    const startOfDay = `${dateStr}T00:00:00.000Z`;
    const endOfDay = `${dateStr}T23:59:59.999Z`;

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
      .or(`scheduled_at.lte.${endOfDay},created_at.lte.${endOfDay}`);

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
      console.error("[features/queue/service] Failed to fetch queue visits:", error);
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
      error: err instanceof Error ? err.message : "Failed to fetch queue.",
    };
  }
}
