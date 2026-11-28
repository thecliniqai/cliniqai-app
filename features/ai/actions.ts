"use server";

import { requirePermission } from "@/lib/permissions/guards";
import {
  getAiChatClient,
  AiUnavailableError,
  AiUnavailableReason,
  generateSoapFromShorthand,
  SoapDraft,
  AnonymizedPatientContext,
} from "@/lib/ai";
import { errorTag, log } from "@/lib/log";
import { getRequestId } from "@/lib/log/request-id";
import { markAction } from "@/lib/observability/db-timing";

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
  await markAction("ai.generate_soap_action");
  try {
    await requirePermission(undefined, "consultations:edit", "full", { sensitive: "ai.soap.generate" });
    const draft = await generateSoapFromShorthand({
      shorthand: input.shorthand,
      patientContext: input.patientContext,
    });
    return { success: true, draft };
  } catch (err: unknown) {
    if (err instanceof AiUnavailableError) return aiUnavailable(err.reason);
    // Never log the error object: it may carry clinical text.
    log.error({ event: "ai.soap_generate.failed", code: errorTag(err), requestId: await getRequestId() });
    return { success: false, code: "ERROR", error: "Failed to generate clinical notes." };
  }
}
