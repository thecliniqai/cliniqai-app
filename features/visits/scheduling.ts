"use server";

import { revalidatePath } from "next/cache";
import { resolveServiceContext } from "@/lib/auth/context";
import { contextFailureToAppError } from "@/lib/commands/context-error";
import type { Result as CommandResult } from "@/lib/errors/app-error";
import type { ScheduleBlock } from "@/lib/db/types";
import * as schedulingService from "./scheduling-service";
import type {
  RegisterAndBookInput,
  RegisterAndBookValue,
  CreateScheduleBlockInput,
  CreateScheduleBlockResult,
  DeleteScheduleBlockResult,
  CheckSlotResult,
  RescheduleVisitInput,
  RescheduleVisitValue,
  CancelVisitInput,
  CancelVisitValue,
  MarkNoShowValue,
  ConfirmAppointmentValue,
} from "./scheduling-service";

export type {
  RegisterAndBookInput,
  RegisterAndBookValue,
  CreateScheduleBlockInput,
  CreateScheduleBlockResult,
  DeleteScheduleBlockResult,
  CheckSlotResult,
  RescheduleVisitInput,
  RescheduleVisitValue,
  CancelVisitInput,
  CancelVisitValue,
  MarkNoShowValue,
  ConfirmAppointmentValue,
} from "./scheduling-service";

// Each action authenticates and checks permission before it reads any input and derives the tenant and actor from
// the session (ADR-0005 D1), then delegates to the server-only service. Failure shapes are unchanged.

function revalidate(...paths: string[]) {
  try {
    for (const path of paths) revalidatePath(path);
  } catch {
    // Outside a Next.js request (tests) revalidation is a no-op
  }
}

/**
 * Creates a schedule block (leave, vacation, break, or clinic-wide closure).
 */
export async function createScheduleBlock(input: CreateScheduleBlockInput): Promise<CreateScheduleBlockResult> {
  const resolved = await resolveServiceContext("appointments:edit");
  if (!resolved.ok) return { success: false, error: resolved.error };
  const result = await schedulingService.createScheduleBlock(resolved.ctx, input);
  if (result.success) revalidate("/calendar");
  return result;
}

/**
 * Deletes a schedule block.
 */
export async function deleteScheduleBlock(blockId: string): Promise<DeleteScheduleBlockResult> {
  const resolved = await resolveServiceContext("appointments:edit");
  if (!resolved.ok) return { success: false, error: resolved.error };
  const result = await schedulingService.deleteScheduleBlock(resolved.ctx, blockId);
  if (result.success) revalidate("/calendar");
  return result;
}

/**
 * Fetches active schedule blocks for a given date. An unauthenticated or unauthorised caller gets an empty list.
 */
export async function getScheduleBlocksForDate(dateStr: string, doctorId?: string): Promise<ScheduleBlock[]> {
  const resolved = await resolveServiceContext("appointments:view");
  if (!resolved.ok) return [];
  return schedulingService.getScheduleBlocksForDate(resolved.ctx, dateStr, doctorId);
}

/**
 * Checks whether a requested doctor appointment slot is available. An unauthenticated or unauthorised caller is
 * told the slot is unavailable (it used to be told "available").
 */
export async function checkSlotAvailability(
  doctorId: string,
  scheduledAt: string,
  durationMinutes: number = 15
): Promise<CheckSlotResult> {
  const resolved = await resolveServiceContext("appointments:view");
  if (!resolved.ok) return { available: false };
  return schedulingService.checkSlotAvailability(resolved.ctx, doctorId, scheduledAt, durationMinutes);
}

/**
 * Registers a patient (when new) and books the appointment as one atomic command (V2-07 07-03): the slot check, the
 * visit, the booking message and the audit rows commit together or not at all. A slot that is taken, off duty or
 * blocked answers CONFLICT (reasons SLOT_TAKEN, SLOT_OFF_DUTY, SLOT_BLOCKED) and writes nothing, so the overbook
 * confirmation can re-send with `is_overbooked`. `client_request_id` is required (the same id replays the first result).
 */
export async function registerAndBook(
  input: RegisterAndBookInput,
  clientRequestId: string
): Promise<CommandResult<RegisterAndBookValue>> {
  const resolved = await resolveServiceContext("appointments:edit");
  if (!resolved.ok) return { ok: false, error: contextFailureToAppError(resolved) };
  const result = await schedulingService.registerAndBook(resolved.ctx, input, clientRequestId);
  if (result.ok) revalidate("/calendar", "/today", "/patients");
  return result;
}

/**
 * Moves a booked, confirmed or missed appointment to a new time as one atomic command (V2-08 08-04a): the slot check, the
 * status back to booked, the audit row, the optional patient message and the webhook event commit together. A slot that is
 * taken, off duty or blocked answers CONFLICT (reasons SLOT_TAKEN, SLOT_OFF_DUTY, SLOT_BLOCKED) and writes nothing.
 * `client_request_id` is required (the same id replays the first result).
 */
export async function rescheduleVisit(
  input: RescheduleVisitInput,
  clientRequestId: string
): Promise<CommandResult<RescheduleVisitValue>> {
  const resolved = await resolveServiceContext("appointments:edit");
  if (!resolved.ok) return { ok: false, error: contextFailureToAppError(resolved) };
  const result = await schedulingService.rescheduleVisit(resolved.ctx, input, clientRequestId);
  if (result.ok) revalidate("/calendar", "/today");
  return result;
}

/**
 * Cancels a booked, confirmed or waiting appointment as one atomic command (V2-08 08-04a): the reason, the waitlist
 * promotion into the vacated slot, the optional patient message and the webhook event commit together.
 */
export async function cancelVisit(
  input: CancelVisitInput,
  clientRequestId: string
): Promise<CommandResult<CancelVisitValue>> {
  const resolved = await resolveServiceContext("appointments:edit");
  if (!resolved.ok) return { ok: false, error: contextFailureToAppError(resolved) };
  const result = await schedulingService.cancelVisit(resolved.ctx, input, clientRequestId);
  if (result.ok) revalidate("/calendar", "/today");
  return result;
}

/** Marks a booked or confirmed appointment whose time has passed as a no-show (V2-08 08-04a). */
export async function markNoShow(visitId: string, clientRequestId: string): Promise<CommandResult<MarkNoShowValue>> {
  const resolved = await resolveServiceContext("appointments:edit");
  if (!resolved.ok) return { ok: false, error: contextFailureToAppError(resolved) };
  const result = await schedulingService.markNoShow(resolved.ctx, visitId, clientRequestId);
  if (result.ok) revalidate("/calendar", "/today");
  return result;
}

/** Confirms a booked appointment (V2-08 08-04a). */
export async function confirmAppointment(
  visitId: string,
  clientRequestId: string
): Promise<CommandResult<ConfirmAppointmentValue>> {
  const resolved = await resolveServiceContext("appointments:edit");
  if (!resolved.ok) return { ok: false, error: contextFailureToAppError(resolved) };
  const result = await schedulingService.confirmAppointment(resolved.ctx, visitId, clientRequestId);
  if (result.ok) revalidate("/calendar", "/today");
  return result;
}
