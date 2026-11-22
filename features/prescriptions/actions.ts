"use server";

import { resolveServiceContext } from "@/lib/auth/context";
import type { ChangePrescriptionInput, ProtocolTemplateInput } from "./schema";
import { contextFailureToAppError } from "@/lib/commands/context-error";
import { appError, type Result as CommandResult } from "@/lib/errors/app-error";
import * as rxService from "./service";
import type {
  GetRxAllergyContextResult,
  SaveDoctorProtocolTemplateResult,
  GetDoctorProtocolTemplatesResult,
  GetVisitPrescriptionResult,
  GetPrescriptionPdfSignedUrlResult,
  SharePrescriptionViaWhatsAppResult,
} from "./service";

export type {
  GetRxAllergyContextResult,
  SearchMedicinesResult,
  ChangePrescriptionResult,
  SaveDoctorProtocolTemplateResult,
  DoctorProtocolTemplate,
  GetDoctorProtocolTemplatesResult,
  VisitPrescriptionData,
  GetVisitPrescriptionResult,
  GetPrescriptionPdfSignedUrlResult,
  SharePrescriptionViaWhatsAppResult,
} from "./service";

// Each action authenticates and checks permission before it reads any input and derives the tenant and actor from
// the session (ADR-0005 D1), then delegates to the server-only service. Failure shapes are unchanged.

/**
 * Every Rx change as one atomic command (V2-09c R-2): add, edit and remove lines in one transaction. `Result` with the `AppError` code and reason the
 * builder needs; `client_request_id` is required and the same id replays the first result. `prescriptions:edit`; the tenant is the session's.
 */
export async function changePrescriptionAction(input: ChangePrescriptionInput): Promise<CommandResult<{ prescriptionId: string; addedItemIds: string[]; replayed: boolean }>> {
  const resolved = await resolveServiceContext("prescriptions:edit");
  if (!resolved.ok) return { ok: false, error: contextFailureToAppError(resolved) };
  const result = await rxService.changePrescription(resolved.ctx, input);
  if (!result.success) {
    return { ok: false, error: appError(result.code ?? "INTERNAL", { message: result.error, reason: result.reason, fieldErrors: result.fieldErrors }) };
  }
  // The consult page is not revalidated per change: the section holds the lines in memory and the page reads them again on the next load.
  return { ok: true, value: { prescriptionId: result.prescriptionId, addedItemIds: result.addedItemIds, replayed: result.replayed } };
}

/** The allergy picture of a consult (V2-09c 09C-02, R-7), read again after a change. consultations:view; the tenant is the session's. */
export async function getRxAllergyContextAction(visitId: string): Promise<GetRxAllergyContextResult> {
  const resolved = await resolveServiceContext("consultations:view");
  if (!resolved.ok) return { success: false, error: resolved.error };
  return rxService.getRxAllergyContext(resolved.ctx, visitId);
}

export async function saveDoctorProtocolTemplate(input: ProtocolTemplateInput): Promise<SaveDoctorProtocolTemplateResult> {
  const resolved = await resolveServiceContext("consultations:edit");
  if (!resolved.ok) return { success: false, error: resolved.error };
  return rxService.saveDoctorProtocolTemplate(resolved.ctx, input);
}

export async function getDoctorProtocolTemplates(specialty?: string): Promise<GetDoctorProtocolTemplatesResult> {
  const resolved = await resolveServiceContext("consultations:view");
  if (!resolved.ok) return { success: false, error: resolved.error };
  return rxService.getDoctorProtocolTemplates(resolved.ctx, specialty);
}

export async function getVisitPrescription(visitId: string): Promise<GetVisitPrescriptionResult> {
  const resolved = await resolveServiceContext("consultations:view");
  if (!resolved.ok) return { success: false, error: resolved.error };
  return rxService.getVisitPrescription(resolved.ctx, visitId);
}

export async function getPrescriptionPdfSignedUrl(
  prescriptionId: string,
  letterheadMode: "blank_paper" | "preprinted_letterhead" = "blank_paper"
): Promise<GetPrescriptionPdfSignedUrlResult> {
  const resolved = await resolveServiceContext("prescriptions:view");
  if (!resolved.ok) return { success: false, error: resolved.error };
  return rxService.getPrescriptionPdfSignedUrl(resolved.ctx, prescriptionId, letterheadMode);
}

export async function sharePrescriptionViaWhatsApp(prescriptionId: string): Promise<SharePrescriptionViaWhatsAppResult> {
  const resolved = await resolveServiceContext("prescriptions:view");
  if (!resolved.ok) return { success: false, error: resolved.error };
  return rxService.sharePrescriptionViaWhatsApp(resolved.ctx, prescriptionId);
}
