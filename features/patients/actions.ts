"use server";

import { revalidatePath } from "next/cache";
import { requireServiceContext, resolveServiceContext } from "@/lib/auth/context";
import * as patientsService from "./service";
import type { CreatePatientResult, PalettePatient, UpdatePatientResult } from "./service";
import type { PatientInput, PatientVisitHistoryItem } from "./schema";
import type { Patient } from "@/lib/db/types";

export type { CreatePatientResult, PalettePatient, UpdatePatientResult } from "./service";

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

/** Throws when unauthenticated or not permitted, as before. */
export async function searchPatients(query: string): Promise<Patient[]> {
  const ctx = await requireServiceContext("patients:view");
  return patientsService.searchPatients(ctx, query);
}

/**
 * The command palette's patient search (V2-06 06-04b, T-06-17): `patients:view`, the tenant from the session, four
 * fields per patient (`PalettePatient`). `{ ok: false }` when the caller is not signed in or not permitted.
 */
export async function searchPatientsForPalette(query: string): Promise<{ ok: true; patients: PalettePatient[] } | { ok: false }> {
  const resolved = await resolveServiceContext("patients:view");
  if (!resolved.ok) return { ok: false };
  return { ok: true, patients: await patientsService.searchPatientsForPalette(resolved.ctx, query) };
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
