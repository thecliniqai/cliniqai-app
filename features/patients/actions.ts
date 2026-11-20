"use server";

import { revalidatePath } from "next/cache";
import { requireServiceContext, resolveServiceContext } from "@/lib/auth/context";
import { contextFailureToAppError } from "@/lib/commands/context-error";
import type { Result as CommandResult } from "@/lib/errors/app-error";
import * as patientsService from "./service";
import { registerPatient as registerPatientService, type RegisterPatientValue } from "./register";
import type { UpdatePatientResult } from "./service";
import type { NewPatientInput, PatientInput, PatientVisitHistoryItem } from "./schema";
import type { Patient } from "@/lib/db/types";

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
  const resolved = await resolveServiceContext("patients:edit");
  if (!resolved.ok) return { ok: false, error: contextFailureToAppError(resolved) };
  const result = await registerPatientService(resolved.ctx, input, clientRequestId);
  if (result.ok) revalidate("/patients");
  return result;
}

export async function updatePatient(patientId: string, input: PatientInput): Promise<UpdatePatientResult> {
  const resolved = await resolveServiceContext("patients:edit");
  if (!resolved.ok) return { success: false, error: resolved.error };
  const result = await patientsService.updatePatient(resolved.ctx, patientId, input);
  if (result.success) revalidate(`/patients/${patientId}`, "/patients");
  return result;
}

/** Throws when unauthenticated or not permitted, as before. */
export async function getPatient(patientId: string, includeErased = false): Promise<Patient | null> {
  const ctx = await requireServiceContext("patients:view");
  return patientsService.getPatient(ctx, patientId, includeErased);
}

/** Throws when unauthenticated or not permitted, as before. */
export async function getPatients(): Promise<Patient[]> {
  const ctx = await requireServiceContext("patients:view");
  return patientsService.getPatients(ctx);
}

/**
 * Loads full chronological clinical visit history for a patient in the current tenant.
 * An unauthenticated or unauthorised caller gets an empty history, as before.
 */
export async function getPatientVisitHistory(patientId: string): Promise<PatientVisitHistoryItem[]> {
  const resolved = await resolveServiceContext("patients:view");
  if (!resolved.ok) return [];
  return patientsService.getPatientVisitHistory(resolved.ctx, patientId);
}
