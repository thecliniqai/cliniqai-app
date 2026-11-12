"use server";

import { revalidatePath } from "next/cache";
import { resolveServiceContext } from "@/lib/auth/context";
import { PrescriptionItemInput, ProtocolTemplateInput } from "./schema";
import * as rxService from "./service";
import type {
  SearchMedicinesResult,
  GetOrCreateDraftPrescriptionResult,
  AddPrescriptionItemResult,
  RemovePrescriptionItemResult,
  SaveDoctorProtocolTemplateResult,
  GetDoctorProtocolTemplatesResult,
  GetVisitPrescriptionResult,
  GetPrescriptionPdfSignedUrlResult,
  SharePrescriptionViaWhatsAppResult,
} from "./service";

export type {
  SearchMedicinesResult,
  GetOrCreateDraftPrescriptionResult,
  AddPrescriptionItemResult,
  RemovePrescriptionItemResult,
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

function revalidate(path: string) {
  try {
    revalidatePath(path);
  } catch {
    // Outside a Next.js request (tests) revalidation is a no-op
  }
}

export async function searchMedicines(query: string, limit = 20): Promise<SearchMedicinesResult> {
  const resolved = await resolveServiceContext("consultations:view");
  if (!resolved.ok) return { success: false, error: resolved.error };
  return rxService.searchMedicines(resolved.ctx, query, limit);
}

export async function getOrCreateDraftPrescription(visitId: string): Promise<GetOrCreateDraftPrescriptionResult> {
  const resolved = await resolveServiceContext("consultations:edit");
  if (!resolved.ok) return { success: false, error: resolved.error };
  return rxService.getOrCreateDraftPrescription(resolved.ctx, visitId);
}

export async function addPrescriptionItem(
  visitId: string,
  input: PrescriptionItemInput
): Promise<AddPrescriptionItemResult> {
  const resolved = await resolveServiceContext("consultations:edit");
  if (!resolved.ok) return { success: false, error: resolved.error };
  const result = await rxService.addPrescriptionItem(resolved.ctx, visitId, input);
  if (result.success) revalidate(`/consultation/${visitId}`);
  return result;
}

export async function removePrescriptionItem(itemId: string, visitId: string): Promise<RemovePrescriptionItemResult> {
  const resolved = await resolveServiceContext("consultations:edit");
  if (!resolved.ok) return { success: false, error: resolved.error };
  const result = await rxService.removePrescriptionItem(resolved.ctx, itemId);
  if (result.success) revalidate(`/consultation/${visitId}`);
  return result;
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
  const resolved = await resolveServiceContext("consultations:view");
  if (!resolved.ok) return { success: false, error: resolved.error };
  return rxService.getPrescriptionPdfSignedUrl(resolved.ctx, prescriptionId, letterheadMode);
}

export async function sharePrescriptionViaWhatsApp(prescriptionId: string): Promise<SharePrescriptionViaWhatsAppResult> {
  const resolved = await resolveServiceContext("consultations:view");
  if (!resolved.ok) return { success: false, error: resolved.error };
  return rxService.sharePrescriptionViaWhatsApp(resolved.ctx, prescriptionId);
}
