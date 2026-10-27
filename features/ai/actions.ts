"use server";

import { requirePermission } from "@/lib/permissions/guards";
import {
  generateSoapFromShorthand,
  generatePatientCatchUpSummary,
  getDoctorFrequentPrescriptions,
  SoapDraft,
  CatchUpSummary,
  PrescriptionSuggestion,
  AnonymizedPatientContext,
} from "@/lib/ai";

export interface GenerateSoapActionResult {
  success: boolean;
  draft?: SoapDraft;
  error?: string;
}

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
    console.error("[generateSoapAction] Error generating SOAP draft:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to generate clinical notes from shorthand.",
    };
  }
}

export interface GetPatientCatchUpActionResult {
  success: boolean;
  summary?: CatchUpSummary;
  error?: string;
}

export async function getPatientCatchUpSummaryAction(input: {
  patientId: string;
}): Promise<GetPatientCatchUpActionResult> {
  try {
    const session = await requirePermission("consultations:view");
    const summary = await generatePatientCatchUpSummary({
      tenantId: session.tenantId,
      patientId: input.patientId,
    });
    return { success: true, summary };
  } catch (err: unknown) {
    console.error("[getPatientCatchUpSummaryAction] Error:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to generate patient catch-up summary.",
    };
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
    const session = await requirePermission("consultations:view");
    const doctorId = input.doctorId || session.userId;
    const suggestions = await getDoctorFrequentPrescriptions({
      tenantId: session.tenantId,
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
