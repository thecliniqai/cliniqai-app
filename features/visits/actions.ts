"use server";

import { revalidatePath } from "next/cache";
import { resolveServiceContext } from "@/lib/auth/context";
import type { VisitStatus } from "@/lib/db/types";
import type { VisitsFilterInput, ClinicVisitsRegisterResult, ActiveDoctorOption } from "./schema";
import type { RecordVitalsInput } from "@/features/consultation/schema";
import * as visitsService from "./service";
import type {
  GetVisitsResult,
  UpdateVisitStatusResult,
  ConfirmAppointmentResult,
  CancelVisitResult,
  RecordVisitVitalsResult,
} from "./service";

export type {
  GetVisitsResult,
  UpdateVisitStatusResult,
  ConfirmAppointmentResult,
  CancelVisitResult,
  RecordVisitVitalsResult,
} from "./service";

// Each action authenticates and checks permission before it reads any input and derives the tenant and actor from
// the session (ADR-0005 D1), then delegates to the server-only service. Failure shapes are unchanged.
// Visits are created only by the front-desk commands (V2-07 07-03: enqueue_walk_in, register_and_book) and by the
// waitlist promotion; there is no standalone createVisit action any more.

function revalidate(...paths: string[]) {
  try {
    for (const path of paths) revalidatePath(path);
  } catch {
    // Outside a Next.js request (tests) revalidation is a no-op
  }
}

export async function getVisitsForDate(dateStr: string, doctorId?: string): Promise<GetVisitsResult> {
  const resolved = await resolveServiceContext("appointments:view");
  if (!resolved.ok) return { success: false, error: resolved.error };
  return visitsService.getVisitsForDate(resolved.ctx, dateStr, doctorId);
}

export async function updateVisitStatus(visitId: string, newStatus: VisitStatus): Promise<UpdateVisitStatusResult> {
  const resolved = await resolveServiceContext("appointments:edit");
  if (!resolved.ok) return { success: false, error: resolved.error };
  const result = await visitsService.updateVisitStatus(resolved.ctx, visitId, newStatus);
  if (result.success) revalidate("/calendar", "/today");
  return result;
}

export async function confirmAppointment(visitId: string): Promise<ConfirmAppointmentResult> {
  const resolved = await resolveServiceContext("appointments:edit");
  if (!resolved.ok) return { success: false, error: resolved.error };
  const result = await visitsService.confirmAppointment(resolved.ctx, visitId);
  if (result.success) revalidate("/calendar", "/today");
  return result;
}

export async function cancelVisit(visitId: string): Promise<CancelVisitResult> {
  const resolved = await resolveServiceContext("appointments:edit");
  if (!resolved.ok) return { success: false, error: resolved.error };
  const result = await visitsService.cancelVisit(resolved.ctx, visitId);
  if (result.success) revalidate("/calendar", "/today");
  return result;
}

/**
 * Retrieves the list of active doctors in the clinic for filter dropdowns.
 * An unauthenticated or unauthorised caller gets an empty list, as before.
 */
export async function getActiveClinicDoctors(): Promise<ActiveDoctorOption[]> {
  const resolved = await resolveServiceContext("appointments:view");
  if (!resolved.ok) return [];
  return visitsService.getActiveClinicDoctors(resolved.ctx);
}

/**
 * Retrieves the unified register of clinic visits with filtering, search, pagination, and metrics.
 * An unauthenticated or unauthorised caller gets an explicit failure (ADR-0005 V1), never an empty register that
 * reads as "no visits".
 */
export type GetClinicVisitsRegisterActionResult =
  | ({ success: true } & ClinicVisitsRegisterResult)
  | { success: false; error: string };

export async function getClinicVisitsRegister(
  input: Partial<VisitsFilterInput> = {}
): Promise<GetClinicVisitsRegisterActionResult> {
  const resolved = await resolveServiceContext("appointments:view");
  if (!resolved.ok) return { success: false, error: resolved.error };
  const register = await visitsService.getClinicVisitsRegister(resolved.ctx, input);
  return { success: true, ...register };
}

/**
 * Records or updates triage vitals on an active or waiting visit record ("vitals:edit"). The recorder is always
 * the signed-in user; a `recorded_by` sent by the caller is ignored.
 */
export async function recordVisitVitals(
  visitId: string,
  vitalsInput: RecordVitalsInput
): Promise<RecordVisitVitalsResult> {
  const resolved = await resolveServiceContext("vitals:edit");
  if (!resolved.ok) return { success: false, error: resolved.error };
  const result = await visitsService.recordVisitVitals(resolved.ctx, visitId, vitalsInput);
  if (result.success) revalidate("/today", "/visits", `/consultation/${visitId}`);
  return result;
}
