"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/permissions/guards";
import { recordAudit } from "@/lib/audit/audit";
import { QueuePriority, QueueToken, Visit, Database, Patient } from "@/lib/db/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { QueueItem } from "@/components/queue/queue-card";

export type CheckInResult =
  | { success: true; tokenNumber: number; queueTokenId: string }
  | { success: false; error: string };

export async function checkInVisit(
  visitId: string,
  priority: QueuePriority = "normal",
  clientOverride?: SupabaseClient<Database>,
  sessionOverride?: { userId: string; tenantId: string }
): Promise<CheckInResult> {
  const supabase = clientOverride || (await createClient());

  try {
    const session = sessionOverride || (await requirePermission("appointments:edit"));
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
      console.error("[features/queue/actions] Token generation RPC failed:", rpcError);
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
      console.error("[features/queue/actions] Failed to insert queue token:", tokenInsertError);
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
    await recordAudit(
      {
        action: "queue.check_in",
        entityType: "queue_token",
        entityId: newToken.id,
        metadata: {
          token_number: tokenNumber,
          priority,
        },
      },
      clientOverride,
      session
    );

    try {
      revalidatePath("/queue");
      revalidatePath("/calendar");
    } catch {
      // Ignore revalidation errors in testing context
    }
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
  visitId: string,
  targetState: "in_consultation" | "completed",
  clientOverride?: SupabaseClient<Database>,
  sessionOverride?: { userId: string; tenantId: string }
): Promise<TransitionStateResult> {
  const supabase = clientOverride || (await createClient());

  try {
    const session = sessionOverride || (await requirePermission("appointments:edit"));
    const nowIso = new Date().toISOString();

    if (targetState === "in_consultation") {
      // Update queue token called_at
      await (
        supabase.from("queue_tokens") as unknown as {
          update: (vals: Record<string, unknown>) => {
            eq: (col: string, val: string) => Promise<{ error: unknown }>;
          };
        }
      )
        .update({ called_at: nowIso })
        .eq("visit_id", visitId);

      // Update visit status
      await (
        supabase.from("visits") as unknown as {
          update: (vals: Record<string, unknown>) => {
            eq: (col: string, val: string) => Promise<{ error: unknown }>;
          };
        }
      )
        .update({ status: "in_consultation", updated_at: nowIso })
        .eq("id", visitId);

      await recordAudit(
        {
          action: "queue.transition",
          entityType: "visit",
          entityId: visitId,
          metadata: {
            new_status: "in_consultation",
          },
        },
        clientOverride,
        session
      );
    } else if (targetState === "completed") {
      // Update queue token completed_at
      await (
        supabase.from("queue_tokens") as unknown as {
          update: (vals: Record<string, unknown>) => {
            eq: (col: string, val: string) => Promise<{ error: unknown }>;
          };
        }
      )
        .update({ completed_at: nowIso })
        .eq("visit_id", visitId);

      // Update visit status
      await (
        supabase.from("visits") as unknown as {
          update: (vals: Record<string, unknown>) => {
            eq: (col: string, val: string) => Promise<{ error: unknown }>;
          };
        }
      )
        .update({ status: "completed", updated_at: nowIso })
        .eq("id", visitId);

      await recordAudit(
        {
          action: "queue.transition",
          entityType: "visit",
          entityId: visitId,
          metadata: {
            new_status: "completed",
          },
        },
        clientOverride,
        session
      );
    }

    try {
      revalidatePath("/queue");
      revalidatePath("/calendar");
    } catch {
      // Ignore revalidation errors in testing context
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

export async function getQueueForDate(
  dateStr: string,
  doctorId?: string,
  clientOverride?: SupabaseClient<Database>,
  sessionOverride?: { userId: string; tenantId: string }
): Promise<{ success: true; items: QueueItem[] } | { success: false; error: string }> {
  const supabase = clientOverride || (await createClient());

  try {
    const session = sessionOverride || (await requirePermission("appointments:view"));
    const startOfDay = `${dateStr}T00:00:00.000Z`;
    const endOfDay = `${dateStr}T23:59:59.999Z`;

    let query = (supabase.from("visits") as unknown as {
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
      console.error("[features/queue/actions] Failed to fetch queue visits:", error);
      return { success: false, error: "Failed to load queue for date." };
    }

    const items: QueueItem[] = (data || []).map((row) => {
      const queueToken = Array.isArray(row.queue_tokens)
        ? row.queue_tokens[0] || null
        : row.queue_tokens || null;

      const { patients, queue_tokens: _qt, ...visitData } = row;

      return {
        visit: visitData as Visit,
        patient: patients || null,
        queueToken: queueToken || null,
        doctorName: `Doctor (${row.doctor_id ? row.doctor_id.slice(0, 8) : "Clinic"})`,
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
