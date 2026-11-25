"use server";

import { resolveServiceContext } from "@/lib/auth/context";
import * as terminologyService from "./service";
import type {
  AddConsultationDiagnosisResult,
  RemoveConsultationDiagnosisResult,
  UpdateDiagnosisNoteResult,
  GetVisitDiagnosesResult,
} from "./service";
import type { AddConsultationDiagnosisInput } from "./schema";
import { markAction } from "@/lib/observability/db-timing";

export type {
  AddConsultationDiagnosisResult,
  RemoveConsultationDiagnosisResult,
  UpdateDiagnosisNoteResult,
  GetVisitDiagnosesResult,
} from "./service";

// Each action authenticates and checks permission before it reads any input, derives the tenant and actor from the
// session (ADR-0005 D1), then delegates to the server-only service.

/**
 * Adds a diagnosis to an active consultation visit.
 */
export async function addConsultationDiagnosis(
  input: AddConsultationDiagnosisInput
): Promise<AddConsultationDiagnosisResult> {
  await markAction("terminology.add_consultation_diagnosis");
  const resolved = await resolveServiceContext("consultations:edit");
  if (!resolved.ok) return { success: false, error: resolved.error };
  const result = await terminologyService.addConsultationDiagnosis(resolved.ctx, input);
  return result;
}

/**
 * Removes a diagnosis from a consultation visit.
 */
export async function removeConsultationDiagnosis(
  diagnosisId: string,
  visitId: string
): Promise<RemoveConsultationDiagnosisResult> {
  await markAction("terminology.remove_consultation_diagnosis");
  const resolved = await resolveServiceContext("consultations:edit");
  if (!resolved.ok) return { success: false, error: resolved.error };
  const result = await terminologyService.removeConsultationDiagnosis(resolved.ctx, diagnosisId, visitId);
  return result;
}

/**
 * Updates an optional inline clinical note for a consultation diagnosis.
 */
export async function updateDiagnosisNote(
  diagnosisId: string,
  visitId: string,
  notes: string | null
): Promise<UpdateDiagnosisNoteResult> {
  await markAction("terminology.update_diagnosis_note");
  const resolved = await resolveServiceContext("consultations:edit");
  if (!resolved.ok) return { success: false, error: resolved.error };
  const result = await terminologyService.updateDiagnosisNote(resolved.ctx, diagnosisId, visitId, notes);
  return result;
}

/**
 * Fetches all diagnoses recorded for a specific visit.
 */
export async function getVisitDiagnoses(visitId: string): Promise<GetVisitDiagnosesResult> {
  await markAction("terminology.get_visit_diagnoses");
  const resolved = await resolveServiceContext("consultations:view");
  if (!resolved.ok) return { success: false, error: resolved.error };
  return terminologyService.getVisitDiagnoses(resolved.ctx, visitId);
}
