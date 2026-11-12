"use server";

import { requirePermission } from "@/lib/permissions/guards";
import { requireServiceContext } from "@/lib/auth/context";
import {
  getAiChatClient,
  AiUnavailableError,
  AiUnavailableReason,
  generateSoapFromShorthand,
  generatePatientCatchUpSummary,
  getDoctorFrequentPrescriptions,
  SoapDraft,
  CatchUpSummary,
  PrescriptionSuggestion,
  AnonymizedPatientContext,
} from "@/lib/ai";

/** Typed "AI unavailable" result (AI-01): no draft, no reason detail beyond the code. */
export interface AiUnavailableResult {
  success: false;
  code: "AI_UNAVAILABLE";
  reason: AiUnavailableReason;
  error: "AI unavailable";
}

export interface AiActionErrorResult {
  success: false;
  code: "ERROR";
  error: string;
}

function aiUnavailable(reason: AiUnavailableReason): AiUnavailableResult {
  return { success: false, code: "AI_UNAVAILABLE", reason, error: "AI unavailable" };
}

export type GenerateSoapActionResult =
  | { success: true; draft: SoapDraft }
  | AiUnavailableResult
  | AiActionErrorResult;

export async function generateSoapAction(input: {
  shorthand: string;
  patientContext?: AnonymizedPatientContext;
}): Promise<GenerateSoapActionResult> {
  try {
    await requirePermission("consultations:edit");
    const draft = await generateSoapFromShorthand({
      shorthand: input.shorthand,
      patientContext: input.patientContext,
    });
    return { success: true, draft };
  } catch (err: unknown) {
    if (err instanceof AiUnavailableError) return aiUnavailable(err.reason);
    // Never log the error object: it may carry clinical text.
    console.error("[generateSoapAction] failed");
    return { success: false, code: "ERROR", error: "Failed to generate clinical notes." };
  }
}

export type GetPatientCatchUpActionResult =
  | { success: true; summary: CatchUpSummary }
  | AiUnavailableResult
  | AiActionErrorResult;

export async function getPatientCatchUpSummaryAction(input: {
  patientId: string;
}): Promise<GetPatientCatchUpActionResult> {
  try {
    await requirePermission("consultations:view");
    // Fail closed before any data access (AI-01): no provider, no read.
    const aiClient = getAiChatClient();
    if (!aiClient) throw new AiUnavailableError("not_configured");
    const ctx = await requireServiceContext("consultations:view");
    const summary = await generatePatientCatchUpSummary(ctx, { patientId: input.patientId }, { aiClient });
    return { success: true, summary };
  } catch (err: unknown) {
    if (err instanceof AiUnavailableError) return aiUnavailable(err.reason);
    console.error("[getPatientCatchUpSummaryAction] failed");
    return { success: false, code: "ERROR", error: "Failed to generate patient catch-up summary." };
  }
}

export interface GetFrequentPrescriptionsActionResult {
  success: boolean;
  suggestions: PrescriptionSuggestion[];
  error?: string;
}

export async function getFrequentPrescriptionsAction(input: {
  diagnosis: string;
  doctorId?: string;
  limit?: number;
}): Promise<GetFrequentPrescriptionsActionResult> {
  try {
    const ctx = await requireServiceContext("consultations:view");
    const doctorId = input.doctorId || ctx.userId;
    const suggestions = await getDoctorFrequentPrescriptions(ctx, {
      doctorId,
      diagnosis: input.diagnosis,
      limit: input.limit,
    });
    return { success: true, suggestions };
  } catch (err: unknown) {
    console.error("[getFrequentPrescriptionsAction] Error:", err);
    return {
      success: false,
      suggestions: [],
      error: err instanceof Error ? err.message : "Failed to retrieve frequent prescriptions.",
    };
  }
}
