"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/permissions/guards";
import { recordAudit } from "@/lib/audit/audit";
import { QueuePriority, QueueToken, Visit } from "@/lib/db/types";

export type CheckInResult =
  | { success: true; tokenNumber: number; queueTokenId: string }
  | { success: false; error: string };

export async function checkInVisit(
  visitId: string,
  priority: QueuePriority = "normal"
): Promise<CheckInResult> {
  const supabase = await createClient();

  try {
    const session = await requirePermission("appointments:edit");
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
    await recordAudit({
      action: "queue.check_in",
      entityType: "queue_token",
      entityId: newToken.id,
      metadata: {
        token_number: tokenNumber,
        priority,
      },
    });

    revalidatePath("/queue");
    revalidatePath("/calendar");
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
  targetState: "in_consultation" | "completed"
): Promise<TransitionStateResult> {
  const supabase = await createClient();

  try {
    await requirePermission("appointments:edit");
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

      await recordAudit({
        action: "queue.transition",
        entityType: "visit",
        entityId: visitId,
        metadata: {
          new_status: "in_consultation",
        },
      });
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

      await recordAudit({
        action: "queue.transition",
        entityType: "visit",
        entityId: visitId,
        metadata: {
          new_status: "completed",
        },
      });
    }

    revalidatePath("/queue");
    revalidatePath("/calendar");
    return { success: true };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to transition queue state.",
    };
  }
}
