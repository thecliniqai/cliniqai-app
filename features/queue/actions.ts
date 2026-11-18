"use server";

import { revalidatePath } from "next/cache";
import { resolveServiceContext } from "@/lib/auth/context";
import { contextFailureToAppError } from "@/lib/commands/context-error";
import { toCommandResult } from "@/lib/commands/command-result";
import type { Result as CommandResult } from "@/lib/errors/app-error";
import type { QueuePriority } from "@/lib/db/types";
import * as queueService from "./service";
import type { TransitionStateResult, GetQueueResult, PaletteQueueMatch } from "./service";

export type { CheckInResult, TransitionStateResult, GetQueueResult, PaletteQueueMatch } from "./service";

// Each action authenticates and checks permission before it reads any input and derives the tenant and actor from
// the session (ADR-0005 D1), then delegates to the server-only service. Failure shapes are unchanged.

function revalidate(...paths: string[]) {
  try {
    for (const path of paths) revalidatePath(path);
  } catch {
    // Outside a Next.js request (tests) revalidation is a no-op
  }
}

/**
 * Check-in as one atomic command (V2-07 07-01): `Result` with the `AppError` code `useCommand` needs; the
 * `client_request_id` is required (the same id replays the first result and writes nothing new).
 */
export async function checkInVisit(
  visitId: string,
  priority: QueuePriority,
  clientRequestId: string
): Promise<CommandResult<{ tokenNumber: number; queueTokenId: string; replayed: boolean }>> {
  const resolved = await resolveServiceContext("appointments:edit");
  if (!resolved.ok) return { ok: false, error: contextFailureToAppError(resolved) };
  const result = await queueService.checkInVisit(resolved.ctx, visitId, priority, clientRequestId);
  if (result.success) revalidate("/queue", "/calendar");
  return toCommandResult(result, (ok) => ({
    tokenNumber: ok.tokenNumber,
    queueTokenId: ok.queueTokenId,
    replayed: ok.replayed,
  }));
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

/**
 * The command palette's "Today queue" group (V2-06 06-04b): `appointments:view`, the tenant from the session, four
 * fields per match. `{ ok: false }` when the caller is not signed in or not permitted.
 */
export async function searchTodayQueueForPalette(
  query: string
): Promise<{ ok: true; matches: PaletteQueueMatch[] } | { ok: false }> {
  const resolved = await resolveServiceContext("appointments:view");
  if (!resolved.ok) return { ok: false };
  return { ok: true, matches: await queueService.searchTodayQueueForPalette(resolved.ctx, query) };
}
