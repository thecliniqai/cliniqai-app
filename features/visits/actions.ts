"use server";

import { revalidatePath } from "next/cache";
import { resolveServiceContext } from "@/lib/auth/context";
import type { VisitStatus } from "@/lib/db/types";
import { visitsFilterSchema, VisitsFilterInput, ClinicVisitsRegisterResult, ActiveDoctorOption } from "./schema";
import type { RecordVitalsInput } from "@/features/consultation/schema";
import * as visitsService from "./service";
import type {
  CreateVisitInput,
  CreateVisitResult,
  GetVisitsResult,
  UpdateVisitStatusResult,
  ConfirmAppointmentResult,
  CancelVisitResult,
  RecordVisitVitalsResult,
} from "./service";

export type {
  CreateVisitInput,
  CreateVisitResult,
  GetVisitsResult,
  UpdateVisitStatusResult,
  ConfirmAppointmentResult,
  CancelVisitResult,
  RecordVisitVitalsResult,
} from "./service";

// Each action authenticates and checks permission before it reads any input and derives the tenant and actor from
// the session (ADR-0005 D1), then delegates to the server-only service. Failure shapes are unchanged.

function revalidate(...paths: string[]) {
  try {
    for (const path of paths) revalidatePath(path);
  } catch {
    // Outside a Next.js request (tests) revalidation is a no-op
  }
}

export async function createVisit(input: CreateVisitInput): Promise<CreateVisitResult> {
  const resolved = await resolveServiceContext("appointments:edit");
  if (!resolved.ok) return { success: false, error: resolved.error };
  const result = await visitsService.createVisit(resolved.ctx, input);
  if (result.success) revalidate("/calendar", "/queue");
  return result;
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
  if (result.success) revalidate("/calendar", "/queue");
  return result;
}

export async function confirmAppointment(visitId: string): Promise<ConfirmAppointmentResult> {
  const resolved = await resolveServiceContext("appointments:edit");
  if (!resolved.ok) return { success: false, error: resolved.error };
  const result = await visitsService.confirmAppointment(resolved.ctx, visitId);
  if (result.success) revalidate("/calendar", "/queue");
  return result;
}

export async function cancelVisit(visitId: string): Promise<CancelVisitResult> {
  const resolved = await resolveServiceContext("appointments:edit");
  if (!resolved.ok) return { success: false, error: resolved.error };
  const result = await visitsService.cancelVisit(resolved.ctx, visitId);
  if (result.success) revalidate("/calendar", "/queue");
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
 * An unauthenticated or unauthorised caller gets an empty register, as before.
 */
export async function getClinicVisitsRegister(
  input: Partial<VisitsFilterInput> = {}
): Promise<ClinicVisitsRegisterResult> {
  const resolved = await resolveServiceContext("appointments:view");
  if (!resolved.ok) {
    const paging = visitsFilterSchema.safeParse(input);
    const { page, pageSize } = paging.success ? paging.data : visitsFilterSchema.parse({});
    return visitsService.emptyVisitsRegister(page, pageSize);
  }
  return visitsService.getClinicVisitsRegister(resolved.ctx, input);
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
  if (result.success) revalidate("/queue", "/visits", "/cabin", `/consultation/${visitId}`);
  return result;
}
