"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/permissions/guards";
import { recordAudit } from "@/lib/audit/audit";
import { createVisit } from "./actions";
import {
  Database,
  Visit,
  DayShiftSchedule,
  DayAvailability,
  DayOfWeek,
  DoctorWeeklySchedule,
  ScheduleBlock,
} from "@/lib/db/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  bookAppointmentSchema,
  createScheduleBlockSchema,
  type BookAppointmentInput,
  type CreateScheduleBlockInput,
} from "./schema";
import {
  timeToMinutes,
  isSlotWithinShifts,
  getTimePartsFromISO,
  DAY_OF_WEEK_NAMES,
} from "./scheduling-utils";

export type { BookAppointmentInput, CreateScheduleBlockInput };

export type CreateScheduleBlockResult =
  | { success: true; block: ScheduleBlock }
  | { success: false; error: string };

export type DeleteScheduleBlockResult =
  | { success: true }
  | { success: false; error: string };

export interface CheckSlotResult {
  available: boolean;
  isOffDuty?: boolean;
  isBlocked?: boolean;
  blockReason?: string;
  conflictingVisit?: Visit | null;
  conflictingBlock?: ScheduleBlock | null;
}

/**
 * Creates a schedule block (leave, vacation, break, or clinic-wide closure).
 */
export async function createScheduleBlock(
  input: CreateScheduleBlockInput,
  clientOverride?: any,
  sessionOverride?: { userId: string; tenantId: string }
): Promise<CreateScheduleBlockResult> {
  const parseResult = createScheduleBlockSchema.safeParse(input);
  if (!parseResult.success) {
    return {
      success: false,
      error: parseResult.error.issues[0]?.message || "Invalid block details",
    };
  }

  const supabase = clientOverride || (await createClient());

  try {
    const session = sessionOverride || (await requirePermission("appointments:edit"));
    const data = parseResult.data;

    // Doctor can block their own time; admins/owners can block any doctor or clinic-wide
    const isTargetingOther = data.doctor_id && data.doctor_id !== session.userId;
    const isClinicWide = !data.doctor_id;

    if (isTargetingOther || isClinicWide) {
      // Must have clinic:manage or appointments:manage permission
      await requirePermission("clinic:manage");
    }

    const { data: newBlock, error: insertError } = await (supabase.from("schedule_blocks") as any)
      .insert({
        tenant_id: session.tenantId,
        doctor_id: data.doctor_id || null,
        start_time: data.start_time,
        end_time: data.end_time,
        reason: data.reason?.trim() || null,
        all_day: data.all_day,
        created_by: session.userId,
      })
      .select("*")
      .single();

    if (insertError || !newBlock) {
      console.error("[createScheduleBlock] Insert error:", insertError);
      return { success: false, error: "Failed to create schedule block." };
    }

    await recordAudit(
      {
        action: "schedule_block.create",
        entityType: "schedule_block",
        entityId: newBlock.id,
        metadata: {
          doctor_id: data.doctor_id,
          all_day: data.all_day,
          reason: data.reason,
          start_time: data.start_time,
          end_time: data.end_time,
        },
      },
      clientOverride,
      session
    );

    try {
      revalidatePath("/calendar");
    } catch {
      // Ignore during test
    }

    return { success: true, block: newBlock as ScheduleBlock };
  } catch (err: unknown) {
    console.error("[createScheduleBlock] Unexpected error:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to create schedule block.",
    };
  }
}

/**
 * Deletes a schedule block.
 */
export async function deleteScheduleBlock(
  blockId: string,
  clientOverride?: any,
  sessionOverride?: { userId: string; tenantId: string }
): Promise<DeleteScheduleBlockResult> {
  if (!blockId) {
    return { success: false, error: "Block ID is required." };
  }

  const supabase = clientOverride || (await createClient());

  try {
    const session = sessionOverride || (await requirePermission("appointments:edit"));

    // Fetch block to verify ownership/permission
    const { data: block, error: fetchErr } = await (supabase.from("schedule_blocks") as any)
      .select("*")
      .eq("id", blockId)
      .eq("tenant_id", session.tenantId)
      .single();

    if (fetchErr || !block) {
      return { success: false, error: "Schedule block not found or access denied." };
    }

    // Doctors can delete their own blocks; admins/owners can delete any
    if (block.doctor_id && block.doctor_id !== session.userId && block.created_by !== session.userId) {
      await requirePermission("clinic:manage");
    }

    const { error: delError } = await (supabase.from("schedule_blocks") as any)
      .delete()
      .eq("id", blockId)
      .eq("tenant_id", session.tenantId);

    if (delError) {
      console.error("[deleteScheduleBlock] Delete error:", delError);
      return { success: false, error: "Failed to delete schedule block." };
    }

    await recordAudit(
      {
        action: "schedule_block.delete",
        entityType: "schedule_block",
        entityId: blockId,
        metadata: {
          doctor_id: block.doctor_id,
          reason: block.reason,
        },
      },
      clientOverride,
      session
    );

    try {
      revalidatePath("/calendar");
    } catch {
      // Ignore during test
    }

    return { success: true };
  } catch (err: unknown) {
    console.error("[deleteScheduleBlock] Unexpected error:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to delete schedule block.",
    };
  }
}

/**
 * Fetches active schedule blocks for a given date.
 */
export async function getScheduleBlocksForDate(
  dateStr: string,
  doctorId?: string,
  clientOverride?: any,
  sessionOverride?: { userId: string; tenantId: string }
): Promise<ScheduleBlock[]> {
  const supabase = clientOverride || (await createClient());

  try {
    const session = sessionOverride || (await requirePermission("appointments:view"));
    const startOfDay = `${dateStr}T00:00:00.000Z`;
    const endOfDay = `${dateStr}T23:59:59.999Z`;

    let query = (supabase.from("schedule_blocks") as any)
      .select("*")
      .eq("tenant_id", session.tenantId)
      .lte("start_time", endOfDay)
      .gte("end_time", startOfDay);

    if (doctorId && doctorId !== "all") {
      // Return blocks for this doctor OR clinic-wide (doctor_id is null)
      query = query.or(`doctor_id.eq.${doctorId},doctor_id.is.null`);
    }

    const { data, error } = await query;
    if (error || !data) {
      console.error("[getScheduleBlocksForDate] Error fetching blocks:", error ? { message: error.message, code: error.code, details: error.details, hint: error.hint } : "No data returned");
      return [];
    }

    return data as ScheduleBlock[];
  } catch (err) {
    console.error("[getScheduleBlocksForDate] Unexpected error:", err);
    return [];
  }
}

/**
 * Checks whether a requested doctor appointment slot is available:
 * 1. Checks doctor working shift hours (availability_schedule).
 * 2. Checks active schedule blocks (leaves/vacations/clinic closures).
 * 3. Checks existing non-cancelled booked/waiting/in_consultation visits.
 */
export async function checkSlotAvailability(
  doctorId: string,
  scheduledAt: string,
  durationMinutes: number = 15,
  clientOverride?: any,
  sessionOverride?: { userId: string; tenantId: string }
): Promise<CheckSlotResult> {
  const supabase = clientOverride || (await createClient());

  try {
    const session = sessionOverride || (await requirePermission("appointments:view"));
    const targetStart = new Date(scheduledAt).getTime();
    const targetEnd = targetStart + durationMinutes * 60000;
    const targetStartISO = new Date(targetStart).toISOString();
    const targetEndISO = new Date(targetEnd).toISOString();

    const targetDate = scheduledAt.split("T")[0];
    const startOfDay = `${targetDate}T00:00:00.000Z`;
    const endOfDay = `${targetDate}T23:59:59.999Z`;

    // 1. Check Doctor Working Shifts (availability_schedule)
    const { data: member } = await (supabase.from("memberships") as any)
      .select("availability_schedule")
      .eq("tenant_id", session.tenantId)
      .eq("user_id", doctorId)
      .maybeSingle();

    if (member?.availability_schedule) {
      const schedule = member.availability_schedule as DoctorWeeklySchedule;
      const { timeHHMM, dayOfWeek } = getTimePartsFromISO(scheduledAt);
      const dayAvailability = schedule[dayOfWeek];

      const isWithinShift = isSlotWithinShifts(timeHHMM, durationMinutes, dayAvailability);
      if (!isWithinShift) {
        return {
          available: false,
          isOffDuty: true,
        };
      }
    }

    // 2. Check Schedule Blocks (doctor-specific or clinic-wide)
    const { data: blocks } = await (supabase.from("schedule_blocks") as any)
      .select("*")
      .eq("tenant_id", session.tenantId)
      .or(`doctor_id.eq.${doctorId},doctor_id.is.null`)
      .lte("start_time", targetEndISO)
      .gte("end_time", targetStartISO);

    if (blocks && blocks.length > 0) {
      for (const block of blocks as ScheduleBlock[]) {
        const bStart = new Date(block.start_time).getTime();
        const bEnd = new Date(block.end_time).getTime();
        if (targetStart < bEnd && targetEnd > bStart) {
          return {
            available: false,
            isBlocked: true,
            blockReason: block.reason || (block.doctor_id ? "Doctor on leave / blocked" : "Clinic closed / blocked"),
            conflictingBlock: block,
          };
        }
      }
    }

    // 3. Check existing non-cancelled visits for this doctor on the target date
    const { data: visits, error } = await (
      supabase.from("visits") as unknown as {
        select: (cols: string) => {
          eq: (col: string, val: string) => {
            eq: (col: string, val: string) => {
              gte: (col: string, val: string) => {
                lte: (col: string, val: string) => {
                  not: (col: string, op: string, val: string) => Promise<{ data: Visit[] | null; error: { message: string } | null }>;
                };
              };
            };
          };
        };
      }
    )
      .select("*")
      .eq("tenant_id", session.tenantId)
      .eq("doctor_id", doctorId)
      .gte("scheduled_at", startOfDay)
      .lte("scheduled_at", endOfDay)
      .not("status", "in", '("cancelled")');

    if (error || !visits) {
      console.error("[features/visits/scheduling] Availability check failed:", error);
      return { available: true };
    }

    for (const v of visits) {
      if (!v.scheduled_at) continue;
      const visitStart = new Date(v.scheduled_at).getTime();
      const visitEnd = visitStart + (v.estimated_duration_minutes || 15) * 60000;

      // Overlap condition: startA < endB && endA > startB
      if (visitStart < targetEnd && visitEnd > targetStart) {
        return {
          available: false,
          conflictingVisit: v,
        };
      }
    }

    return { available: true };
  } catch (err: unknown) {
    console.error("[features/visits/scheduling] Slot availability error:", err);
    return { available: true };
  }
}

export type BookAppointmentResult =
  | { success: true; visitId: string }
  | {
      success: false;
      conflict?: boolean;
      isOffDuty?: boolean;
      isBlocked?: boolean;
      conflictingVisit?: Visit | null;
      error: string;
    };

/**
 * Books an appointment on the doctor's day timeline.
 * If slot is occupied or off-duty and `is_overbooked` is false, returns conflict details for confirmation dialog.
 */
export async function bookAppointment(
  input: BookAppointmentInput,
  clientOverride?: any,
  sessionOverride?: { userId: string; tenantId: string }
): Promise<BookAppointmentResult> {
  const parseResult = bookAppointmentSchema.safeParse(input);
  if (!parseResult.success) {
    return {
      success: false,
      error: parseResult.error.issues[0]?.message || "Invalid appointment details",
    };
  }

  const data = parseResult.data;

  // 1. Check slot availability (unless user explicitly confirmed overbook/override)
  if (!data.is_overbooked) {
    const slotCheck = await checkSlotAvailability(
      data.doctor_id,
      data.scheduled_at,
      data.estimated_duration_minutes,
      clientOverride,
      sessionOverride
    );

    if (!slotCheck.available) {
      if (slotCheck.isBlocked && !data.override_block) {
        return {
          success: false,
          conflict: true,
          isBlocked: true,
          error: `Doctor is unavailable / blocked: ${slotCheck.blockReason || "Time blocked"}`,
        };
      }
      if (slotCheck.isOffDuty && !data.override_off_duty) {
        return {
          success: false,
          conflict: true,
          isOffDuty: true,
          error: "Selected time is outside doctor shift hours. Confirmation required to book off-duty slot.",
        };
      }
      if (slotCheck.conflictingVisit) {
        return {
          success: false,
          conflict: true,
          conflictingVisit: slotCheck.conflictingVisit,
          error: "Slot is already booked. Confirmation is required to overbook this slot.",
        };
      }
    }
  }

  // 2. Create the visit
  const visitRes = await createVisit(
    {
      patient_id: data.patient_id,
      doctor_id: data.doctor_id,
      origin_type: "scheduled",
      scheduled_at: data.scheduled_at,
      estimated_duration_minutes: data.estimated_duration_minutes,
      reason_for_visit: data.reason_for_visit || null,
      is_overbooked: data.is_overbooked || data.override_off_duty,
    },
    clientOverride,
    sessionOverride
  );

  if (!visitRes.success) {
    return {
      success: false,
      error: visitRes.error,
    };
  }

  return {
    success: true,
    visitId: visitRes.visitId,
  };
}
