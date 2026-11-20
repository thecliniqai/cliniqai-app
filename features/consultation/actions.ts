"use server";

import { revalidatePath } from "next/cache";
import { resolveServiceContext } from "@/lib/auth/context";
import { SaveConsultationDraftInput } from "./schema";
import { contextFailureToAppError } from "@/lib/commands/context-error";
import { toCommandResult } from "@/lib/commands/command-result";
import type { Result as CommandResult } from "@/lib/errors/app-error";
import * as consultationService from "./service";
import type {
  SaveConsultationDraftResult,
  RecordFollowUpInput,
  RecordFollowUpResult,
  GetPatientConsultationHistoryResult,
} from "./service";

export type {
  SaveConsultationDraftResult,
  RecordFollowUpInput,
  RecordFollowUpResult,
  PastVisitEncounter,
  GetPatientConsultationHistoryResult,
} from "./service";

// Each action authenticates and checks permission before it reads any input and derives the tenant and actor from
// the session (ADR-0005 D1), then delegates to the server-only service. Failure shapes are unchanged.

function revalidate(...paths: string[]) {
  try {
    for (const path of paths) revalidatePath(path);
  } catch {
    // Outside a Next.js request (tests) revalidation is a no-op
  }
}

export async function saveConsultationDraft(input: SaveConsultationDraftInput): Promise<SaveConsultationDraftResult> {
  const resolved = await resolveServiceContext("consultations:edit");
  if (!resolved.ok) return { success: false, error: resolved.error };
  const result = await consultationService.saveConsultationDraft(resolved.ctx, input);
  if (result.success) revalidate(`/consultation/${result.visitId}`, "/queue");
  return result;
}

export async function recordFollowUp(input: RecordFollowUpInput): Promise<RecordFollowUpResult> {
  const resolved = await resolveServiceContext("consultations:edit");
  if (!resolved.ok) return { success: false, error: resolved.error };
  return consultationService.recordFollowUp(resolved.ctx, input);
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
  if (result.success) revalidate(`/consultation/${visitId}`, "/queue");
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
  if (result.success) revalidate(`/consultation/${visitId}`, "/queue");
  return toCommandResult(result, (ok) => ({ visitId: ok.visitId, revisionNumber: ok.revisionNumber, replayed: ok.replayed }));
}

export async function finalizeVisitAmendment(
  visitId: string,
  clientRequestId: string
): Promise<CommandResult<{ visitId: string; version: number; replayed: boolean }>> {
  const resolved = await resolveServiceContext("consultations:edit");
  if (!resolved.ok) return { ok: false, error: contextFailureToAppError(resolved) };
  const result = await consultationService.finalizeVisitAmendment(resolved.ctx, visitId, clientRequestId);
  if (result.success) revalidate(`/consultation/${visitId}`, "/queue");
  return toCommandResult(result, (ok) => ({ visitId: ok.visitId, version: ok.version, replayed: ok.replayed }));
}
