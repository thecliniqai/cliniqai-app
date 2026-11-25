"use server";

import { resolveServiceContext } from "@/lib/auth/context";
import { contextFailureToAppError } from "@/lib/commands/context-error";
import { toCommandResult } from "@/lib/commands/command-result";
import type { Result as CommandResult } from "@/lib/errors/app-error";
import type { QueuePriority } from "@/lib/db/types";
import * as queueService from "./service";
import type {
  PaletteQueueMatch,
  EnqueueWalkInInput,
  WalkInValue,
  StartConsultationValue,
  CompleteVisitValue,
} from "./service";
import { markAction } from "@/lib/observability/db-timing";
import { expectedVersionError } from "@/lib/errors/expected-version";

export type { CheckInResult, PaletteQueueMatch } from "./service";

// Each action authenticates and checks permission before it reads any input and derives the tenant and actor from
// the session (ADR-0005 D1), then delegates to the server-only service. Failure shapes are unchanged.

/**
 * Check-in as one atomic command (V2-07 07-01): `Result` with the `AppError` code `useCommand` needs; the
 * `client_request_id` is required (the same id replays the first result and writes nothing new). `expectedVersion` (09E-07, R-19) is the visit's
 * `row_version` the screen shows: required here, so every screen sends one; a visit that moved on is refused (`CONFLICT` / `ROW_CHANGED`) and nothing is written.
 */
export async function checkInVisit(
  visitId: string,
  priority: QueuePriority,
  clientRequestId: string,
  expectedVersion: number
): Promise<CommandResult<{ tokenNumber: number; queueTokenId: string; replayed: boolean; rowVersion?: number }>> {
  await markAction("queue.check_in_visit");
  const resolved = await resolveServiceContext("appointments:edit");
  if (!resolved.ok) return { ok: false, error: contextFailureToAppError(resolved) };
  const invalid = expectedVersionError(expectedVersion);
  if (invalid) return { ok: false, error: invalid };
  const result = await queueService.checkInVisit(resolved.ctx, visitId, priority, clientRequestId, expectedVersion);
  return toCommandResult(result, (ok) => ({
    tokenNumber: ok.tokenNumber,
    queueTokenId: ok.queueTokenId,
    replayed: ok.replayed,
    rowVersion: ok.rowVersion,
  }));
}

/**
 * Registers a walk-in as one atomic command (V2-07 07-03): [new patient] + walk-in visit + queue token in one
 * transaction. `Result` with the `AppError` code `useCommand` needs; `client_request_id` is required (the same id replays
 * the first result and writes nothing new). The service repeats the finer `patients:edit` check for a new patient.
 */
export async function enqueueWalkIn(
  input: EnqueueWalkInInput,
  clientRequestId: string
): Promise<CommandResult<WalkInValue>> {
  await markAction("queue.enqueue_walk_in");
  const resolved = await resolveServiceContext("appointments:edit");
  if (!resolved.ok) return { ok: false, error: contextFailureToAppError(resolved) };
  const result = await queueService.enqueueWalkIn(resolved.ctx, input, clientRequestId);
  return result;
}

/**
 * "Start Consultation" as one atomic command (V2-08 08-01b, R-1): a booked, confirmed or no-show visit is checked in first, then
 * moved to `in_consultation`, in one transaction. `Result` with the `AppError` code `useCommand` needs; `client_request_id` is
 * required (the same id replays the first result). Owner and doctor only (`consultations:edit`). `expectedVersion`: the visit's `row_version` the screen
 * shows (09E-07, R-19), required.
 */
export async function startConsultation(
  visitId: string,
  clientRequestId: string,
  expectedVersion: number
): Promise<CommandResult<StartConsultationValue>> {
  await markAction("queue.start_consultation");
  const resolved = await resolveServiceContext("consultations:edit");
  if (!resolved.ok) return { ok: false, error: contextFailureToAppError(resolved) };
  const invalid = expectedVersionError(expectedVersion);
  if (invalid) return { ok: false, error: invalid };
  const result = await queueService.startConsultation(resolved.ctx, visitId, clientRequestId, expectedVersion);
  return result;
}

/**
 * Completes an unsigned waiting or in-consultation visit at the desk as one atomic command (V2-08 08-01b); a visit that is
 * already completed (the checkout after a sign-off) is a no-op that stamps the queue token's completion time. `expectedVersion`: the visit's
 * `row_version` the screen shows (09E-07, R-19), required.
 */
export async function completeVisit(
  visitId: string,
  clientRequestId: string,
  expectedVersion: number
): Promise<CommandResult<CompleteVisitValue>> {
  await markAction("queue.complete_visit");
  const resolved = await resolveServiceContext("appointments:edit");
  if (!resolved.ok) return { ok: false, error: contextFailureToAppError(resolved) };
  const invalid = expectedVersionError(expectedVersion);
  if (invalid) return { ok: false, error: invalid };
  const result = await queueService.completeVisit(resolved.ctx, visitId, clientRequestId, expectedVersion);
  return result;
}

/**
 * The command palette's "Today queue" group (V2-06 06-04b): `appointments:view`, the tenant from the session, four
 * fields per match. `{ ok: false }` when the caller is not signed in or not permitted.
 */
export async function searchTodayQueueForPalette(
  query: string
): Promise<{ ok: true; matches: PaletteQueueMatch[] } | { ok: false }> {
  await markAction("queue.search_today_queue_for_palette");
  const resolved = await resolveServiceContext("appointments:view");
  if (!resolved.ok) return { ok: false };
  return { ok: true, matches: await queueService.searchTodayQueueForPalette(resolved.ctx, query) };
}
