"use server";

import { revalidatePath } from "next/cache";
import { resolveServiceContext } from "@/lib/auth/context";
import type { QueuePriority } from "@/lib/db/types";
import * as queueService from "./service";
import type { CheckInResult, TransitionStateResult, GetQueueResult } from "./service";

export type { CheckInResult, TransitionStateResult, GetQueueResult } from "./service";

// Each action authenticates and checks permission before it reads any input and derives the tenant and actor from
// the session (ADR-0005 D1), then delegates to the server-only service. Failure shapes are unchanged.

function revalidate(...paths: string[]) {
  try {
    for (const path of paths) revalidatePath(path);
  } catch {
    // Outside a Next.js request (tests) revalidation is a no-op
  }
}

export async function checkInVisit(visitId: string, priority: QueuePriority = "normal"): Promise<CheckInResult> {
  const resolved = await resolveServiceContext("appointments:edit");
  if (!resolved.ok) return { success: false, error: resolved.error };
  const result = await queueService.checkInVisit(resolved.ctx, visitId, priority);
  if (result.success) revalidate("/queue", "/calendar");
  return result;
}

export async function transitionQueueState(
  visitId: string,
  targetState: "in_consultation" | "completed"
): Promise<TransitionStateResult> {
  const resolved = await resolveServiceContext("appointments:edit");
  if (!resolved.ok) return { success: false, error: resolved.error };
  const result = await queueService.transitionQueueState(resolved.ctx, visitId, targetState);
  if (result.success) revalidate("/queue", "/calendar", "/cabin", "/");
  return result;
}

export async function getQueueForDate(dateStr: string, doctorId?: string): Promise<GetQueueResult> {
  const resolved = await resolveServiceContext("appointments:view");
  if (!resolved.ok) return { success: false, error: resolved.error };
  return queueService.getQueueForDate(resolved.ctx, dateStr, doctorId);
}
