import "server-only";

import { assertPerm } from "@/lib/permissions";
import type { ServiceContext } from "@/lib/auth/context";
import { recordAudit } from "@/lib/audit/audit";
import { memberOfTenant } from "@/lib/auth/tenant-refs";
import { enqueueMessage } from "@/lib/messaging/dispatcher";
import { isDateOnly, isUuid } from "@/lib/utils/filter-values";
import { dayWindowUtc, ymdOf } from "@/lib/datetime";
import { getTenantTimeZone } from "@/lib/datetime/server";
import { formatDoctorDisplayName } from "@/features/staff/formatters";
import { Visit, DoctorWeeklySchedule, ScheduleBlock } from "@/lib/db/types";
import {
  bookAppointmentSchema,
  createScheduleBlockSchema,
  type BookAppointmentInput,
  type CreateScheduleBlockInput,
} from "./schema";
import { isSlotWithinShifts, getTimePartsFromISO } from "./scheduling-utils";
import { createVisit } from "./service";
import { errorTag, log } from "@/lib/log";
import { getRequestId } from "@/lib/log/request-id";

// Scheduling use-cases (blocks, slot checks, booking). Tenant and actor come only from `ctx` (ADR-0005 D1); each
// use-case checks the permission its server action checked before the move.

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
  /** Set when availability could not be verified (denied caller, bad doctor id, or any database error). Callers must
   * treat it as "do not book" (V2-01 F8: fail closed; a false "unavailable" beats a double booking). */
  checkFailed?: boolean;
}

/**
 * Creates a schedule block (leave, vacation, break, or clinic-wide closure).
 */
export async function createScheduleBlock(
  ctx: ServiceContext,
  input: CreateScheduleBlockInput
): Promise<CreateScheduleBlockResult> {
  const supabase = ctx.db;

  try {
    assertPerm(ctx.role, "appointments:edit");
    const session = ctx;

    const parseResult = createScheduleBlockSchema.safeParse(input);
    if (!parseResult.success) {
      return {
        success: false,
        error: parseResult.error.issues[0]?.message || "Invalid block details",
      };
    }
    const data = parseResult.data;

    // Doctor can block their own time; admins/owners can block any doctor or clinic-wide
    const isTargetingOther = data.doctor_id && data.doctor_id !== session.userId;
    const isClinicWide = !data.doctor_id;

    if (isTargetingOther || isClinicWide) {
      assertPerm(ctx.role, "clinic:manage");
    }
    // A targeted doctor must belong to the caller's clinic (P0-13: the FK and RLS do not check this).
    if (isTargetingOther && data.doctor_id && !(await memberOfTenant(ctx, data.doctor_id))) {
      return { success: false, error: "Doctor not found in this clinic." };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
      log.error({ event: "visits.schedule_block_insert.failed", code: errorTag(insertError), requestId: await getRequestId(), tenantId: ctx.tenantId });
      return { success: false, error: "Failed to create schedule block." };
    }

    await recordAudit(ctx, {
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
    });

    return { success: true, block: newBlock as ScheduleBlock };
  } catch (err: unknown) {
    log.error({ event: "visits.schedule_block_create.failed", code: errorTag(err), requestId: await getRequestId(), tenantId: ctx.tenantId });
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to create schedule block.",
    };
  }
}

/**
 * Deletes a schedule block. Doctors can delete their own blocks; deleting another doctor's block or a clinic-wide
 * block needs "clinic:manage" (the same rule as creating one).
 */
export async function deleteScheduleBlock(ctx: ServiceContext, blockId: string): Promise<DeleteScheduleBlockResult> {
  const supabase = ctx.db;

  try {
    assertPerm(ctx.role, "appointments:edit");
    const session = ctx;

    if (!blockId) {
      return { success: false, error: "Block ID is required." };
    }

    // Fetch block to verify ownership/permission
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: block, error: fetchErr } = await (supabase.from("schedule_blocks") as any)
      .select("*")
      .eq("id", blockId)
      .eq("tenant_id", session.tenantId)
      .single();

    if (fetchErr || !block) {
      return { success: false, error: "Schedule block not found or access denied." };
    }

    // Same rule as createScheduleBlock (V2-01 F7): only a doctor's own block needs no more than appointments:edit;
    // another doctor's block or a clinic-wide block needs clinic:manage.
    const isOtherDoctors = Boolean(block.doctor_id) && block.doctor_id !== session.userId;
    const isClinicWide = !block.doctor_id;
    if (isOtherDoctors || isClinicWide) {
      assertPerm(ctx.role, "clinic:manage");
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: delError } = await (supabase.from("schedule_blocks") as any)
      .delete()
      .eq("id", blockId)
      .eq("tenant_id", session.tenantId);

    if (delError) {
      log.error({ event: "visits.schedule_block_delete_query.failed", code: errorTag(delError), requestId: await getRequestId(), tenantId: ctx.tenantId });
      return { success: false, error: "Failed to delete schedule block." };
    }

    await recordAudit(ctx, {
      action: "schedule_block.delete",
      entityType: "schedule_block",
      entityId: blockId,
      metadata: {
        doctor_id: block.doctor_id,
        reason: block.reason,
      },
    });

    return { success: true };
  } catch (err: unknown) {
    log.error({ event: "visits.schedule_block_delete.failed", code: errorTag(err), requestId: await getRequestId(), tenantId: ctx.tenantId });
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to delete schedule block.",
    };
  }
}

/**
 * Fetches active schedule blocks for a given date (YYYY-MM-DD), optionally for one doctor plus clinic-wide blocks.
 */
export async function getScheduleBlocksForDate(
  ctx: ServiceContext,
  dateStr: string,
  doctorId?: string
): Promise<ScheduleBlock[]> {
  const supabase = ctx.db;

  try {
    assertPerm(ctx.role, "appointments:view");
    const session = ctx;

    const filterByDoctor = Boolean(doctorId && doctorId !== "all");
    // The doctor id is interpolated into a PostgREST filter string below, so it must be a uuid.
    if (!isDateOnly(dateStr) || (filterByDoctor && !isUuid(doctorId))) {
      return [];
    }

    // Blocks that overlap the clinic day in the tenant's zone, half-open (V2-03 03-05).
    const { startIso: startOfDay, endIsoExclusive: endOfDay } = dayWindowUtc(
      dateStr,
      await getTenantTimeZone(supabase, session.tenantId)
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (supabase.from("schedule_blocks") as any)
      .select("*")
      .eq("tenant_id", session.tenantId)
      .lt("start_time", endOfDay)
      .gte("end_time", startOfDay);

    if (filterByDoctor) {
      // Return blocks for this doctor OR clinic-wide (doctor_id is null)
      query = query.or(`doctor_id.eq.${doctorId},doctor_id.is.null`);
    }

    const { data, error } = await query;
    if (error || !data) {
      log.error({ event: "visits.schedule_blocks_query.failed", code: errorTag(error), requestId: await getRequestId(), tenantId: ctx.tenantId });
      return [];
    }

    return data as ScheduleBlock[];
  } catch (err) {
    log.error({ event: "visits.schedule_blocks.failed", code: errorTag(err), requestId: await getRequestId(), tenantId: ctx.tenantId });
    return [];
  }
}

/**
 * Checks whether a requested doctor appointment slot is available:
 * 1. Checks doctor working shift hours (availability_schedule).
 * 2. Checks active schedule blocks (leaves/vacations/clinic closures).
 * 3. Checks existing non-cancelled booked/waiting/in_consultation visits.
 * A doctor id that is not a uuid is reported as unavailable.
 */
export async function checkSlotAvailability(
  ctx: ServiceContext,
  doctorId: string,
  scheduledAt: string,
  durationMinutes: number = 15
): Promise<CheckSlotResult> {
  const supabase = ctx.db;
  const session = ctx;

  // Fails closed (V2-01 F8): a denied caller, a doctor id that is not a uuid (it is interpolated into a PostgREST
  // filter string below) or any database error yields `available: false` with `checkFailed: true`.
  const failed: CheckSlotResult = { available: false, checkFailed: true };
  try {
    assertPerm(ctx.role, "appointments:view");
  } catch {
    return failed;
  }
  if (!isUuid(doctorId)) {
    return failed;
  }

  try {

    const targetStart = new Date(scheduledAt).getTime();
    const targetEnd = targetStart + durationMinutes * 60000;
    const targetStartISO = new Date(targetStart).toISOString();
    const targetEndISO = new Date(targetEnd).toISOString();

    // The slot's clinic day and wall-clock time in the tenant's zone (V2-03 03-05).
    const timeZone = await getTenantTimeZone(supabase, session.tenantId);
    const { startIso: startOfDay, endIsoExclusive: endOfDay } = dayWindowUtc(ymdOf(scheduledAt, timeZone), timeZone);

    // 1. Check Doctor Working Shifts (availability_schedule)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: member, error: memberErr } = await (supabase.from("memberships") as any)
      .select("availability_schedule")
      .eq("tenant_id", session.tenantId)
      .eq("user_id", doctorId)
      .maybeSingle();

    if (memberErr) {
      log.error({ event: "visits.availability_shifts.failed", code: errorTag(memberErr), requestId: await getRequestId(), tenantId: ctx.tenantId });
      return failed;
    }

    if (member?.availability_schedule) {
      const schedule = member.availability_schedule as DoctorWeeklySchedule;
      const { timeHHMM, dayOfWeek } = getTimePartsFromISO(scheduledAt, timeZone);
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: blocks, error: blocksErr } = await (supabase.from("schedule_blocks") as any)
      .select("*")
      .eq("tenant_id", session.tenantId)
      .or(`doctor_id.eq.${doctorId},doctor_id.is.null`)
      .lte("start_time", targetEndISO)
      .gte("end_time", targetStartISO);

    if (blocksErr) {
      log.error({ event: "visits.availability_blocks.failed", code: errorTag(blocksErr), requestId: await getRequestId(), tenantId: ctx.tenantId });
      return failed;
    }

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
                lt: (col: string, val: string) => {
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
      .lt("scheduled_at", endOfDay)
      .not("status", "in", '("cancelled")');

    if (error || !visits) {
      log.error({ event: "visits.availability_visits.failed", code: errorTag(error), requestId: await getRequestId(), tenantId: ctx.tenantId });
      return failed;
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
    log.error({ event: "visits.availability.failed", code: errorTag(err), requestId: await getRequestId(), tenantId: ctx.tenantId });
    return failed;
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
export async function bookAppointment(ctx: ServiceContext, input: BookAppointmentInput): Promise<BookAppointmentResult> {
  const supabase = ctx.db;
  const session = ctx;

  try {
    assertPerm(ctx.role, "appointments:edit");
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to book appointment." };
  }

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
      ctx,
      data.doctor_id,
      data.scheduled_at,
      data.estimated_duration_minutes
    );

    if (slotCheck.checkFailed) {
      // Fail closed (F8): never book a slot whose availability could not be verified
      return { success: false, error: "Could not verify slot availability. Please try again." };
    }

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

  // 2. Create the visit (same context, so createVisit's own permission check applies)
  const visitRes = await createVisit(ctx, {
    patient_id: data.patient_id,
    doctor_id: data.doctor_id,
    origin_type: "scheduled",
    scheduled_at: data.scheduled_at,
    estimated_duration_minutes: data.estimated_duration_minutes,
    reason_for_visit: data.reason_for_visit || null,
    is_overbooked: data.is_overbooked || data.override_off_duty,
  });

  if (!visitRes.success) {
    return {
      success: false,
      error: visitRes.error,
    };
  }

  // 3. Queue Event #1 (appointment_booked) outbox notification
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: patient } = await (supabase.from("patients") as any)
      .select("full_name, phone")
      .eq("id", data.patient_id)
      .eq("tenant_id", session.tenantId)
      .single();

    if (patient?.phone) {
      const formattedDateTime = new Date(data.scheduled_at).toLocaleString("en-IN", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Asia/Kolkata",
      });

      // Find doctor name if available
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: doctorMember } = await (supabase.from("memberships") as any)
        .select("full_name")
        .eq("user_id", data.doctor_id)
        .eq("tenant_id", session.tenantId)
        .maybeSingle();

      const doctorName = formatDoctorDisplayName(doctorMember?.full_name);

      await enqueueMessage(
        supabase,
        {
          tenantId: session.tenantId,
          patientId: data.patient_id,
          appointmentId: visitRes.visitId,
          channel: "whatsapp",
          messageType: "appointment_booked",
          templateId: "appointment_booked",
          templateParams: {
            patient_name: patient.full_name || "Patient",
            doctor_name: doctorName,
            date_time: formattedDateTime,
          },
          recipientPhone: patient.phone,
          metadata: {
            buttons: [
              { id: "btn_confirm", text: "Confirm" },
              { id: "btn_cancel", text: "Cancel" },
              { id: "btn_reschedule", text: "Reschedule" },
            ],
          },
        }
      );
    }
  } catch (commErr) {
    log.error({ event: "visits.booking_notification.failed", code: errorTag(commErr), requestId: await getRequestId(), tenantId: ctx.tenantId });
    // Booking itself still succeeded
  }

  return {
    success: true,
    visitId: visitRes.visitId,
  };
}
