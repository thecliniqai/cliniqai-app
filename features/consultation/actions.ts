"use server";

import { revalidatePath } from "next/cache";
import { resolveServiceContext } from "@/lib/auth/context";
import type { SaveDraftCommandInput } from "./schema";
import type { ServerDraft } from "./draft";
import { contextFailureToAppError } from "@/lib/commands/context-error";
import { toCommandResult } from "@/lib/commands/command-result";
import { appError, type Result as CommandResult } from "@/lib/errors/app-error";
import * as consultationService from "./service";
import type { GetPatientConsultationHistoryResult } from "./service";

export type { PastVisitEncounter, GetPatientConsultationHistoryResult } from "./service";

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
 * The consult's draft save as one atomic command (V2-09b R-3): `Result` with the `AppError` code and reason the draft saver needs
 * (`CONFLICT` / `DRAFT_CONFLICT` makes it read the server copy and rebase; `DRAFT_LOCKED` stops it); `client_request_id` is required and the same
 * id replays the first result.
 */
export async function saveConsultationDraft(
  input: SaveDraftCommandInput
): Promise<CommandResult<{ visitId: string; draftVersion: number; started: boolean; replayed: boolean }>> {
  const resolved = await resolveServiceContext("consultations:edit");
  if (!resolved.ok) return { ok: false, error: contextFailureToAppError(resolved) };
  const result = await consultationService.saveConsultationDraft(resolved.ctx, input);
  // The consult page is not revalidated per save: the editor holds the draft in memory and Today refreshes on its own signals (000102).
  if (!result.success) {
    return { ok: false, error: appError(result.code ?? "INTERNAL", { message: result.error, reason: result.reason, fieldErrors: result.fieldErrors }) };
  }
  return { ok: true, value: { visitId: result.visitId, draftVersion: result.draftVersion, started: result.started, replayed: result.replayed } };
}

/** The server copy of the consult draft, for the conflict rebase (V2-09b R-5). */
export async function getConsultationDraft(visitId: string): Promise<CommandResult<ServerDraft>> {
  const resolved = await resolveServiceContext("consultations:view");
  if (!resolved.ok) return { ok: false, error: contextFailureToAppError(resolved) };
  const result = await consultationService.getConsultationDraft(resolved.ctx, visitId);
  return result.success ? { ok: true, value: result.draft } : { ok: false, error: appError(result.code ?? "INTERNAL", { message: result.error }) };
}

export async function getPatientConsultationHistory(
  patientId: string,
  currentVisitId?: string
): Promise<GetPatientConsultationHistoryResult> {
  const resolved = await resolveServiceContext("consultations:view");
  if (!resolved.ok) return { success: false, error: resolved.error };
  return consultationService.getPatientConsultationHistory(resolved.ctx, patientId, currentVisitId);
}

/**
 * Sign-off as one atomic command (V2-07 07-01): `Result` with the `AppError` code `useCommand` needs; the
 * `client_request_id` is required (the same id replays the first result and writes nothing new).
 */
export async function completeAndSignConsultation(
  visitId: string,
  clientRequestId: string
): Promise<CommandResult<{ visitId: string; replayed: boolean }>> {
  const resolved = await resolveServiceContext("consultations:edit");
  if (!resolved.ok) return { ok: false, error: contextFailureToAppError(resolved) };
  const result = await consultationService.completeAndSignConsultation(resolved.ctx, visitId, clientRequestId);
  if (result.success) revalidate(`/consultation/${visitId}`, "/today");
  return toCommandResult(result, (ok) => ({ visitId: ok.visitId, replayed: ok.replayed }));
}

export async function reopenVisitForAmendment(
  visitId: string,
  reason: string,
  clientRequestId: string
): Promise<CommandResult<{ visitId: string; revisionNumber: number; replayed: boolean }>> {
  const resolved = await resolveServiceContext("consultations:edit");
  if (!resolved.ok) return { ok: false, error: contextFailureToAppError(resolved) };
  const result = await consultationService.reopenVisitForAmendment(resolved.ctx, visitId, reason, clientRequestId);
  if (result.success) revalidate(`/consultation/${visitId}`, "/today");
  return toCommandResult(result, (ok) => ({ visitId: ok.visitId, revisionNumber: ok.revisionNumber, replayed: ok.replayed }));
}

export async function finalizeVisitAmendment(
  visitId: string,
  clientRequestId: string
): Promise<CommandResult<{ visitId: string; version: number; replayed: boolean }>> {
  const resolved = await resolveServiceContext("consultations:edit");
  if (!resolved.ok) return { ok: false, error: contextFailureToAppError(resolved) };
  const result = await consultationService.finalizeVisitAmendment(resolved.ctx, visitId, clientRequestId);
  if (result.success) revalidate(`/consultation/${visitId}`, "/today");
  return toCommandResult(result, (ok) => ({ visitId: ok.visitId, version: ok.version, replayed: ok.replayed }));
}
