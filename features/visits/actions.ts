"use server";

import { resolveServiceContext } from "@/lib/auth/context";
import type { VisitsFilterInput, ClinicVisitsRegisterResult, ActiveDoctorOption } from "./schema";
import type { RecordVitalsInput } from "@/features/consultation/schema";
import * as visitsService from "./service";
import type { GetVisitsResult, RecordVisitVitalsResult } from "./service";
import { markAction } from "@/lib/observability/db-timing";

export type { GetVisitsResult, RecordVisitVitalsResult } from "./service";

// Each action authenticates and checks permission before it reads any input and derives the tenant and actor from
// the session (ADR-0005 D1), then delegates to the server-only service. Failure shapes are unchanged.
// Visits are created only by the front-desk commands (V2-07 07-03: enqueue_walk_in, register_and_book, V2-08 08-04a:
// promote_waitlist_entry and the cancel promotion); their status, time and doctor change only through the commands
// (reschedule, cancel, no-show, confirm in `scheduling.ts`; check-in, start and complete in the queue actions).

export async function getVisitsForDate(dateStr: string, doctorId?: string): Promise<GetVisitsResult> {
  await markAction("visits.get_visits_for_date");
  const resolved = await resolveServiceContext("appointments:view");
  if (!resolved.ok) return { success: false, error: resolved.error };
  return visitsService.getVisitsForDate(resolved.ctx, dateStr, doctorId);
}

/**
 * Retrieves the list of active doctors in the clinic for filter dropdowns.
 * An unauthenticated or unauthorised caller gets an empty list, as before.
 */
export async function getActiveClinicDoctors(): Promise<ActiveDoctorOption[]> {
  await markAction("visits.get_active_clinic_doctors");
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
  await markAction("visits.get_clinic_visits_register");
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
  await markAction("visits.record_visit_vitals");
  const resolved = await resolveServiceContext("vitals:edit");
  if (!resolved.ok) return { success: false, error: resolved.error };
  const result = await visitsService.recordVisitVitals(resolved.ctx, visitId, vitalsInput);
  return result;
}
