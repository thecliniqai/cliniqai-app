"use server";

import { revalidatePath } from "next/cache";
import { requireServiceContext, resolveServiceContext } from "@/lib/auth/context";
import * as patientsService from "./service";
import type { CreatePatientResult, UpdatePatientResult } from "./service";
import type { PatientInput, PatientVisitHistoryItem } from "./schema";
import type { Patient } from "@/lib/db/types";

export type { CreatePatientResult, UpdatePatientResult } from "./service";

// Each action authenticates and checks permission before it reads any input and derives the tenant and actor from
// the session (ADR-0005 D1); the server-only service does the work. Failure shapes are unchanged.

function revalidate(...paths: string[]) {
  try {
    for (const path of paths) revalidatePath(path);
  } catch {
    // Outside a Next.js request (tests) revalidation is a no-op
  }
}

export async function createPatient(input: PatientInput): Promise<CreatePatientResult> {
  const resolved = await resolveServiceContext("patients:edit");
  if (!resolved.ok) return { success: false, error: resolved.error };
  const result = await patientsService.createPatient(resolved.ctx, input);
  if (result.success) revalidate("/patients");
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

/**
 * Builds the PostgREST OR filter clause for a patient search (pure helper; kept as an action export for existing
 * importers).
 */
export async function buildPatientSearchFilter(query: string): Promise<string> {
  return patientsService.buildPatientSearchFilter(query);
}

/** Throws when unauthenticated or not permitted, as before. */
export async function searchPatients(query: string): Promise<Patient[]> {
  const ctx = await requireServiceContext("patients:view");
  return patientsService.searchPatients(ctx, query);
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
