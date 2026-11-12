"use server";

import { revalidatePath } from "next/cache";
import { resolveServiceContext } from "@/lib/auth/context";
import type { ScheduleBlock } from "@/lib/db/types";
import * as schedulingService from "./scheduling-service";
import type {
  BookAppointmentInput,
  CreateScheduleBlockInput,
  CreateScheduleBlockResult,
  DeleteScheduleBlockResult,
  CheckSlotResult,
  BookAppointmentResult,
} from "./scheduling-service";

export type {
  BookAppointmentInput,
  CreateScheduleBlockInput,
  CreateScheduleBlockResult,
  DeleteScheduleBlockResult,
  CheckSlotResult,
  BookAppointmentResult,
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
 * Books an appointment on the doctor's day timeline.
 * If slot is occupied or off-duty and `is_overbooked` is false, returns conflict details for confirmation dialog.
 */
export async function bookAppointment(input: BookAppointmentInput): Promise<BookAppointmentResult> {
  const resolved = await resolveServiceContext("appointments:edit");
  if (!resolved.ok) return { success: false, error: resolved.error };
  const result = await schedulingService.bookAppointment(resolved.ctx, input);
  if (result.success) revalidate("/calendar", "/queue");
  return result;
}
