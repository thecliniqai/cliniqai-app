"use server";

import { revalidatePath } from "next/cache";
import { resolveServiceContext } from "@/lib/auth/context";
import { SaveConsultationDraftInput } from "./schema";
import * as consultationService from "./service";
import type {
  SaveConsultationDraftResult,
  RecordFollowUpInput,
  RecordFollowUpResult,
  GetPatientConsultationHistoryResult,
  CompleteAndSignConsultationResult,
  ReopenVisitForAmendmentResult,
  FinalizeVisitAmendmentResult,
} from "./service";

export type {
  SaveConsultationDraftResult,
  RecordFollowUpInput,
  RecordFollowUpResult,
  PastVisitEncounter,
  GetPatientConsultationHistoryResult,
  CompleteAndSignConsultationResult,
  ReopenVisitForAmendmentResult,
  FinalizeVisitAmendmentResult,
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

export async function completeAndSignConsultation(visitId: string): Promise<CompleteAndSignConsultationResult> {
  const resolved = await resolveServiceContext("consultations:edit");
  if (!resolved.ok) return { success: false, error: resolved.error };
  const result = await consultationService.completeAndSignConsultation(resolved.ctx, visitId);
  if (result.success) revalidate(`/consultation/${visitId}`, "/queue");
  return result;
}

export async function reopenVisitForAmendment(visitId: string, reason: string): Promise<ReopenVisitForAmendmentResult> {
  const resolved = await resolveServiceContext("consultations:edit");
  if (!resolved.ok) return { success: false, error: resolved.error };
  const result = await consultationService.reopenVisitForAmendment(resolved.ctx, visitId, reason);
  if (result.success) revalidate(`/consultation/${visitId}`, "/queue");
  return result;
}

export async function finalizeVisitAmendment(visitId: string): Promise<FinalizeVisitAmendmentResult> {
  const resolved = await resolveServiceContext("consultations:edit");
  if (!resolved.ok) return { success: false, error: resolved.error };
  const result = await consultationService.finalizeVisitAmendment(resolved.ctx, visitId);
  if (result.success) revalidate(`/consultation/${visitId}`, "/queue");
  return result;
}
