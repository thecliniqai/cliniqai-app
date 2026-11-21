"use server";

import { revalidatePath } from "next/cache";
import { resolveServiceContext } from "@/lib/auth/context";
import { contextFailureToAppError } from "@/lib/commands/context-error";
import type { Result as CommandResult } from "@/lib/errors/app-error";
import type { ScheduleBlock } from "@/lib/db/types";
import { requireEntitlement } from "@/lib/entitlements/require-entitlement";
import * as schedulingService from "./scheduling-service";
import type {
  AvailableSlot,
  SlotAssist,
  RescheduleTarget,
  RegisterAndBookInput,
  RegisterAndBookValue,
  CreateScheduleBlockInput,
  CreateScheduleBlockResult,
  DeleteScheduleBlockResult,
  RescheduleVisitInput,
  RescheduleVisitValue,
  CancelVisitInput,
  CancelVisitValue,
  MarkNoShowValue,
  ConfirmAppointmentValue,
} from "./scheduling-service";

export type {
  AvailableSlot,
  SlotAssist,
  RescheduleTarget,
  RegisterAndBookInput,
  RegisterAndBookValue,
  CreateScheduleBlockInput,
  CreateScheduleBlockResult,
  DeleteScheduleBlockResult,
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
  if (result.success) revalidate("/schedule");
  return result;
}

/**
 * Deletes a schedule block.
 */
export async function deleteScheduleBlock(blockId: string): Promise<DeleteScheduleBlockResult> {
  const resolved = await resolveServiceContext("appointments:edit");
  if (!resolved.ok) return { success: false, error: resolved.error };
  const result = await schedulingService.deleteScheduleBlock(resolved.ctx, blockId);
  if (result.success) revalidate("/schedule");
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
 * The doctor's free slots on a clinic-local date (V2-08 08-04b): `public.available_slots`, the list the booking and
 * reschedule sheets show and the command later checks again. `exclude_visit_id` lists a visit's own slot again (a
 * reschedule). A denied caller gets the permission refusal, never an empty list that reads as "no slots".
 */
export async function getAvailableSlots(
  doctorId: string,
  date: string,
  excludeVisitId?: string
): Promise<CommandResult<AvailableSlot[]>> {
  const resolved = await resolveServiceContext("appointments:view");
  if (!resolved.ok) return { ok: false, error: contextFailureToAppError(resolved) };
  return schedulingService.getAvailableSlots(resolved.ctx, doctorId, date, excludeVisitId);
}

/**
 * Smart Assist slot suggestions' inputs (V2-08 08-05, AI-13, R-18): the doctor's average consult minutes and the patient's preferred
 * time band, only when the clinic holds the `assist.slots` entitlement; otherwise `{ entitled: false }` and the booking sheet keeps
 * the earliest free slot. Deterministic; no model, no outbound call. The clinic comes from the session.
 */
export async function getSlotAssist(doctorId: string, patientId?: string | null): Promise<CommandResult<SlotAssist>> {
  const resolved = await resolveServiceContext("appointments:view");
  if (!resolved.ok) return { ok: false, error: contextFailureToAppError(resolved) };
  // Fail closed: a lookup failure or a locked clinic reads as "not entitled".
  const entitled = await requireEntitlement("assist.slots").catch(() => false);
  if (!entitled) return { ok: true, value: { entitled: false, avgConsultMinutes: null, preferredBand: null } };
  return schedulingService.getSlotSuggestionContext(resolved.ctx, doctorId, patientId ?? null);
}

/** The appointment the reschedule sheet moves (`?reschedule=<visitId>`, V2-08 08-04b): patient name, doctor and the current slot. */
export async function getRescheduleTarget(visitId: string): Promise<CommandResult<RescheduleTarget>> {
  const resolved = await resolveServiceContext("appointments:view");
  if (!resolved.ok) return { ok: false, error: contextFailureToAppError(resolved) };
  return schedulingService.getRescheduleTarget(resolved.ctx, visitId);
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
  if (result.ok) revalidate("/schedule", "/today", "/patients");
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
  if (result.ok) revalidate("/schedule", "/today");
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
  if (result.ok) revalidate("/schedule", "/today");
  return result;
}

/** Marks a booked or confirmed appointment whose time has passed as a no-show (V2-08 08-04a). */
export async function markNoShow(visitId: string, clientRequestId: string): Promise<CommandResult<MarkNoShowValue>> {
  const resolved = await resolveServiceContext("appointments:edit");
  if (!resolved.ok) return { ok: false, error: contextFailureToAppError(resolved) };
  const result = await schedulingService.markNoShow(resolved.ctx, visitId, clientRequestId);
  if (result.ok) revalidate("/schedule", "/today");
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
  if (result.ok) revalidate("/schedule", "/today");
  return result;
}
