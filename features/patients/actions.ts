"use server";

import { revalidatePath } from "next/cache";
import { requireServiceContext, resolveServiceContext } from "@/lib/auth/context";
import { contextFailureToAppError } from "@/lib/commands/context-error";
import type { Result as CommandResult } from "@/lib/errors/app-error";
import * as patientsService from "./service";
import { registerPatient as registerPatientService, type RegisterPatientValue } from "./register";
import { recordPatientAllergies as recordPatientAllergiesService, type RecordAllergiesInput, type RecordAllergiesValue } from "./allergies";
import type { UpdatePatientResult } from "./service";
import type { NewPatientInput, PatientInput, PatientVisitHistoryItem } from "./schema";
import type { Patient } from "@/lib/db/types";
import { markAction } from "@/lib/observability/db-timing";

export type { UpdatePatientResult } from "./service";

// Each action authenticates and checks permission before it reads any input and derives the tenant and actor from
// the session (ADR-0005 D1); the server-only service does the work. Failure shapes are unchanged.

function revalidate(...paths: string[]) {
  try {
    for (const path of paths) revalidatePath(path);
  } catch {
    // Outside a Next.js request (tests) revalidation is a no-op
  }
}

/**
 * Registers a patient as one atomic command (V2-08 08-02, R-6, R-12): `Result` with the `AppError` code `useCommand` needs;
 * `client_request_id` is required (the same id replays the first result and writes nothing new). `patients:edit`.
 */
export async function registerPatient(
  input: NewPatientInput,
  clientRequestId: string
): Promise<CommandResult<RegisterPatientValue>> {
  await markAction("patients.register_patient");
  const resolved = await resolveServiceContext("patients:edit");
  if (!resolved.ok) return { ok: false, error: contextFailureToAppError(resolved) };
  const result = await registerPatientService(resolved.ctx, input, clientRequestId);
  return result;
}

/**
 * Records a patient's allergies as one atomic command (V2-09c 09C-02, R-8): `[]` is "No known allergies"; `client_request_id` is required and the same id
 * replays the first result. `patients:edit` and `consultations:view` (the front desk cannot); the tenant is the session's.
 */
export async function recordPatientAllergies(input: RecordAllergiesInput): Promise<CommandResult<RecordAllergiesValue>> {
  await markAction("patients.record_patient_allergies");
  // The gate here is consultations:view (the roles that read allergies); the service and the command also require patients:edit (the 000055 rule).
  const resolved = await resolveServiceContext("consultations:view");
  if (!resolved.ok) return { ok: false, error: contextFailureToAppError(resolved) };
  const result = await recordPatientAllergiesService(resolved.ctx, input);
  return result;
}

export async function updatePatient(patientId: string, input: PatientInput): Promise<UpdatePatientResult> {
  await markAction("patients.update_patient");
  const resolved = await resolveServiceContext("patients:edit");
  if (!resolved.ok) return { success: false, error: resolved.error };
  const result = await patientsService.updatePatient(resolved.ctx, patientId, input);
  if (result.success) revalidate(`/patients/${patientId}`, "/patients");
  return result;
}

/** Throws when unauthenticated or not permitted, as before. */
export async function getPatient(patientId: string, includeErased = false): Promise<Patient | null> {
  await markAction("patients.get_patient");
  const ctx = await requireServiceContext("patients:view");
  return patientsService.getPatient(ctx, patientId, includeErased);
}

/** Throws when unauthenticated or not permitted, as before. */
export async function getPatients(): Promise<Patient[]> {
  await markAction("patients.get_patients");
  const ctx = await requireServiceContext("patients:view");
  return patientsService.getPatients(ctx);
}

/**
 * Loads full chronological clinical visit history for a patient in the current tenant.
 * An unauthenticated or unauthorised caller gets an empty history, as before.
 */
export async function getPatientVisitHistory(patientId: string): Promise<PatientVisitHistoryItem[]> {
  await markAction("patients.get_patient_visit_history");
  const resolved = await resolveServiceContext("patients:view");
  if (!resolved.ok) return [];
  return patientsService.getPatientVisitHistory(resolved.ctx, patientId);
}
