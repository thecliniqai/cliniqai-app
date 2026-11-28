import "server-only";

import { z } from "zod";
import { assertPerm, hasPerm } from "@/lib/permissions";
import type { ServiceContext } from "@/lib/auth/context";
import { recordAudit } from "@/lib/audit/audit";
import { memberOfTenant } from "@/lib/auth/tenant-refs";
import { isDateOnly, isUuid } from "@/lib/utils/filter-values";
import { clockOf, dayWindowUtc, ymdOf } from "@/lib/datetime";
import { getTenantTimeZone } from "@/lib/datetime/server";
import { Visit, DoctorWeeklySchedule, ScheduleBlock } from "@/lib/db/types";
import {
  registerAndBookSchema,
  createScheduleBlockSchema,
  rescheduleVisitSchema,
  cancelVisitSchema,
  type RegisterAndBookInput,
  type CreateScheduleBlockInput,
  type RescheduleVisitInput,
  type CancelVisitInput,
} from "./schema";
import { isSlotWithinShifts, getTimePartsFromISO } from "./scheduling-utils";
import type { TimeBand } from "./suggest-slots";
import { errorTag, log } from "@/lib/log";
import { getRequestId } from "@/lib/log/request-id";
import { mapDbError, unaffectedRowsError, type DbErrorMessages } from "@/lib/db/errors";
import { callCommand } from "@/lib/commands/call-command";
import { clientRequestIdSchema } from "@/lib/commands/request-id";
import { patientSchema, newPatientPayload } from "@/features/patients/schema";
import { SLOT_TAKEN_MESSAGE } from "./service";
import { clientErrorMessage } from "@/lib/errors/client-message";
import { versionArg } from "@/lib/errors/row-changed";
import { appError, type Result } from "@/lib/errors/app-error";

// Scheduling use-cases (blocks, slot checks, booking). Tenant and actor come only from `ctx` (ADR-0005 D1); each
// use-case checks the permission its server action checked before the move.

export type { RegisterAndBookInput, CreateScheduleBlockInput, RescheduleVisitInput, CancelVisitInput };

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
      error: clientErrorMessage(err, "Failed to create schedule block."),
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
    const { data: deleted, error: delError } = await (supabase.from("schedule_blocks") as any)
      .delete()
      .eq("id", blockId)
      .eq("tenant_id", session.tenantId)
      .select("id");

    if (delError) {
      log.error({ event: "visits.schedule_block_delete_query.failed", code: errorTag(delError), requestId: await getRequestId(), tenantId: ctx.tenantId });
      return { success: false, error: "Failed to delete schedule block." };
    }
    // RLS may filter the delete to 0 rows (V2-05 05-04): never report a block that is still there as deleted.
    const refused = unaffectedRowsError(deleted);
    if (refused) {
      log.warn({ event: "visits.schedule_block_delete.refused", reason: "row_not_affected", requestId: await getRequestId(), tenantId: ctx.tenantId });
      return { success: false, error: refused.message };
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
      error: clientErrorMessage(err, "Failed to delete schedule block."),
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
      // nosemgrep: postgrest-or-interpolation -- doctorId is isUuid-checked above
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
    const { data: blocks, error: blocksErr } = await (supabase.from("schedule_blocks") as any) // nosemgrep: postgrest-or-interpolation -- doctorId is isUuid-checked above
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

/** Fixed, data-free texts by reason or code for `register_and_book` (V2-07 07-03). The driver message never reaches the caller. */
export const BOOKING_COMMAND_MESSAGES = {
  NOT_FOUND: "Patient or doctor not found in this clinic.",
  FORBIDDEN: "You do not have permission to book appointments.",
  VALIDATION_FAILED: "Please check the patient and appointment details.",
  SLOT_TAKEN: SLOT_TAKEN_MESSAGE,
  SLOT_OFF_DUTY: "Selected time is outside doctor shift hours. Confirmation required to book off-duty slot.",
  SLOT_BLOCKED: "The doctor is unavailable at this time. Confirmation required to book a blocked slot.",
  LOCK_TIMEOUT: "The calendar is busy. Try again.",
  IDEMPOTENCY_MISMATCH: "This was already submitted with different details. Refresh and try again.",
  INTERNAL: "Failed to book appointment.",
} as const satisfies DbErrorMessages;

/** Fixed text when the booking message template is not configured for this clinic (a fault of ours, not of the form; G-5). */
export const BOOKING_MESSAGE_CONFIG_MESSAGE =
  "The appointment could not be booked because the booking message is not set up. Contact support.";

const registerAndBookRpcResultSchema = z.object({
  patient_id: z.string().uuid(),
  patient_created: z.boolean(),
  visit_id: z.string().uuid(),
  message_enqueued: z.boolean(),
  replayed: z.boolean(),
});

export interface RegisterAndBookValue {
  patientId: string;
  patientCreated: boolean;
  visitId: string;
  /** False when the patient has no usable mobile number (the booking stands, no message is queued). */
  messageEnqueued: boolean;
  /** True when this client_request_id was already booked: nothing new was written. */
  replayed: boolean;
}

/**
 * Registers a patient (when new) and books the appointment as one atomic command (`public.register_and_book`, V2-07
 * 07-03): the slot is checked against the doctor's shifts, schedule blocks and booked visits in the clinic's time zone
 * (unless overbooked), the visit is inserted under the `visits_no_double_booking` exclusion, and the `appointment_booked`
 * message is queued, all in one transaction. A slot refusal (`SLOT_TAKEN`, `SLOT_OFF_DUTY`, `SLOT_BLOCKED`, all
 * CONFLICT) writes nothing, so no orphan patient is left; the drawer then offers the overbooking confirmation.
 */
export async function registerAndBook(
  ctx: ServiceContext,
  input: RegisterAndBookInput,
  clientRequestId: string
): Promise<Result<RegisterAndBookValue>> {
  const parsed = registerAndBookSchema.safeParse(input);
  const id = clientRequestIdSchema.safeParse(clientRequestId);
  if (!parsed.success || !id.success) {
    return {
      ok: false,
      error: appError("VALIDATION_FAILED", {
        message: parsed.success ? BOOKING_COMMAND_MESSAGES.VALIDATION_FAILED : (parsed.error.issues[0]?.message ?? BOOKING_COMMAND_MESSAGES.VALIDATION_FAILED),
      }),
    };
  }
  const data = parsed.data;

  if (!hasPerm(ctx.role, "appointments:edit") || (data.new_patient && !hasPerm(ctx.role, "patients:edit"))) {
    return { ok: false, error: appError("FORBIDDEN", { message: BOOKING_COMMAND_MESSAGES.FORBIDDEN }) };
  }

  let newPatient: Record<string, unknown> | null = null;
  if (data.new_patient) {
    const patient = patientSchema.safeParse(data.new_patient);
    if (!patient.success) {
      const fieldErrors: Record<string, string[]> = {};
      for (const issue of patient.error.issues) {
        const field = issue.path[0]?.toString() || "form";
        (fieldErrors[field] ||= []).push(issue.message);
      }
      return {
        ok: false,
        error: appError("VALIDATION_FAILED", { message: patient.error.issues[0]?.message ?? "Please correct the highlighted errors.", fieldErrors }),
      };
    }
    newPatient = newPatientPayload(patient.data);
  }

  const outcome = await callCommand(
    ctx,
    "register_and_book",
    {
      p_patient_id: data.patient_id ?? null,
      p_new_patient: newPatient,
      p_doctor_id: data.doctor_id,
      p_scheduled_at: data.scheduled_at,
      p_duration_minutes: data.estimated_duration_minutes,
      p_overbook: data.is_overbooked,
      p_client_request_id: clientRequestId,
      p_reason: data.reason_for_visit || null,
      p_override_off_duty: data.override_off_duty,
      p_override_block: data.override_block,
    },
    registerAndBookRpcResultSchema,
    BOOKING_COMMAND_MESSAGES,
    { event: "visits.register_and_book.failed" }
  );
  if (!outcome.ok) {
    // The booking message's template is not request-callable (ops.message_templates): a configuration fault, not an input
    // problem ("check the details" would send the user in circles). The booking rolled back; the fault is logged by tag
    // only (V2-07 07-04a G-5).
    if (outcome.error.reason === "TEMPLATE_NOT_ALLOWED") {
      log.error({
        event: "visits.register_and_book.template_not_allowed",
        code: "TEMPLATE_NOT_ALLOWED",
        requestId: await getRequestId(),
        tenantId: ctx.tenantId,
      });
      return { ok: false, error: appError("INTERNAL", { message: BOOKING_MESSAGE_CONFIG_MESSAGE, reason: "TEMPLATE_NOT_ALLOWED" }) };
    }
    return outcome;
  }
  const v = outcome.value;
  return {
    ok: true,
    value: {
      patientId: v.patient_id,
      patientCreated: v.patient_created,
      visitId: v.visit_id,
      messageEnqueued: v.message_enqueued,
      replayed: v.replayed,
    },
  };
}

/** Fixed texts for the slot list (a read: no client_request_id). */
export const AVAILABLE_SLOTS_MESSAGES = {
  FORBIDDEN: "You do not have permission to view appointment slots.",
  VALIDATION_FAILED: "Pick a doctor and a date.",
  INTERNAL: "Failed to load available slots.",
} as const satisfies DbErrorMessages;

export interface AvailableSlot {
  /** ISO instants; the slot is the half-open interval [start, end). */
  start: string;
  end: string;
}

const availableSlotRowsSchema = z.array(z.object({ slot_start: z.string(), slot_end: z.string() }));

/**
 * The doctor's free slots on a clinic-local date (V2-07 07-03, R-8, PR-7): `public.available_slots`, computed in the
 * database in the clinic's time zone from the weekly shifts, the schedule blocks and the booked, non-overbooked
 * visits (a NULL schedule reads as the default hours, V2-08 08-04a). The Schedule screen's booking and reschedule sheets use
 * it (08-04b); `excludeVisitId` lists a visit's own slot again. `appointments:view`.
 */
export async function getAvailableSlots(
  ctx: ServiceContext,
  doctorId: string,
  date: string,
  /** The visit being rescheduled: its own slot is listed again (V2-08 08-04a). */
  excludeVisitId?: string
): Promise<Result<AvailableSlot[]>> {
  if (!hasPerm(ctx.role, "appointments:view")) {
    return { ok: false, error: appError("FORBIDDEN", { message: AVAILABLE_SLOTS_MESSAGES.FORBIDDEN }) };
  }
  if (!isUuid(doctorId) || !isDateOnly(date) || (excludeVisitId !== undefined && !isUuid(excludeVisitId))) {
    return { ok: false, error: appError("VALIDATION_FAILED", { message: AVAILABLE_SLOTS_MESSAGES.VALIDATION_FAILED }) };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (ctx.db as any).rpc("available_slots", {
    p_doctor_id: doctorId,
    p_date: date,
    ...(excludeVisitId ? { p_exclude_visit_id: excludeVisitId } : {}),
  });
  if (error) {
    const mapped = mapDbError(error, AVAILABLE_SLOTS_MESSAGES);
    if (mapped.code === "INTERNAL") {
      log.error({ event: "visits.available_slots.failed", code: errorTag(error), requestId: await getRequestId(), tenantId: ctx.tenantId });
    }
    return { ok: false, error: mapped };
  }
  const rows = availableSlotRowsSchema.safeParse(data ?? []);
  if (!rows.success) {
    log.error({ event: "visits.available_slots.failed", code: "result_shape", requestId: await getRequestId(), tenantId: ctx.tenantId });
    return { ok: false, error: appError("INTERNAL", { message: AVAILABLE_SLOTS_MESSAGES.INTERNAL }) };
  }
  return {
    ok: true,
    value: rows.data.map((r) => ({ start: new Date(r.slot_start).toISOString(), end: new Date(r.slot_end).toISOString() })),
  };
}

/**
 * What the booking sheet's Smart Assist needs to rank free slots (V2-08 08-05, AI-13): `entitled` is the clinic's
 * `assist.slots` entitlement (decided by the caller; false means the basic earliest-slot rule). Counts and a band only.
 */
export interface SlotAssist {
  entitled: boolean;
  avgConsultMinutes: number | null;
  preferredBand: TimeBand | null;
}

const slotContextRowsSchema = z.array(
  z.object({
    avg_consult_minutes: z.number().nullable(),
    consult_samples: z.number(),
    preferred_band: z.enum(["morning", "afternoon", "evening"]).nullable(),
  })
);

/**
 * The inputs of the slot suggestions (`public.slot_suggestion_context`, 000105): the doctor's average consult minutes (null under
 * five samples) and the patient's preferred band (null without history, or for a patient being registered). `appointments:view`.
 * A failed read answers the plain "no assist" value, never an error: the booking sheet then keeps the earliest free slot.
 */
export async function getSlotSuggestionContext(
  ctx: ServiceContext,
  doctorId: string,
  patientId: string | null
): Promise<Result<SlotAssist>> {
  if (!hasPerm(ctx.role, "appointments:view")) {
    return { ok: false, error: appError("FORBIDDEN", { message: AVAILABLE_SLOTS_MESSAGES.FORBIDDEN }) };
  }
  if (!isUuid(doctorId) || (patientId !== null && !isUuid(patientId))) {
    return { ok: false, error: appError("VALIDATION_FAILED", { message: AVAILABLE_SLOTS_MESSAGES.VALIDATION_FAILED }) };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (ctx.db as any).rpc("slot_suggestion_context", { p_doctor_id: doctorId, p_patient_id: patientId });
  const rows = error ? null : slotContextRowsSchema.safeParse(data ?? []);
  if (error || !rows?.success) {
    log.error({ event: "visits.slot_context.failed", code: error ? errorTag(error) : "result_shape", requestId: await getRequestId(), tenantId: ctx.tenantId });
    return { ok: true, value: { entitled: true, avgConsultMinutes: null, preferredBand: null } };
  }
  const row = rows.data[0];
  return { ok: true, value: { entitled: true, avgConsultMinutes: row?.avg_consult_minutes ?? null, preferredBand: row?.preferred_band ?? null } };
}

/** What the reschedule sheet shows of the visit it moves (V2-08 08-04b): the patient's name, the doctor and the current slot. */
export interface RescheduleTarget {
  visitId: string;
  patientName: string;
  doctorId: string;
  /** Clinic date `YYYY-MM-DD` and wall-clock `HH:mm` of the current appointment. */
  date: string;
  time: string;
  durationMinutes: number;
  status: Visit["status"];
  /** The visit's `row_version` as read now: the sheet sends it with the move (09E-07, R-19). */
  rowVersion: number;
}

export const RESCHEDULE_TARGET_MESSAGES = {
  FORBIDDEN: "You do not have permission to view appointments.",
  NOT_FOUND: "Appointment not found.",
  VALIDATION_FAILED: "Appointment not found.",
  INTERNAL: "Failed to load the appointment.",
} as const satisfies DbErrorMessages;

/**
 * The booked appointment the reschedule sheet (`?reschedule=<visitId>`) moves: explicit columns (no `select *`), read on the
 * caller's own session so RLS decides, `appointments:view`. A visit with no appointment time (a walk-in) is not found here.
 */
export async function getRescheduleTarget(ctx: ServiceContext, visitId: string): Promise<Result<RescheduleTarget>> {
  if (!hasPerm(ctx.role, "appointments:view")) {
    return { ok: false, error: appError("FORBIDDEN", { message: RESCHEDULE_TARGET_MESSAGES.FORBIDDEN }) };
  }
  if (!isUuid(visitId)) return { ok: false, error: appError("NOT_FOUND", { message: RESCHEDULE_TARGET_MESSAGES.NOT_FOUND }) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (ctx.db.from("visits") as any)
    .select("id, doctor_id, status, scheduled_at, estimated_duration_minutes, row_version, patients(full_name)")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", visitId)
    .not("scheduled_at", "is", null)
    .maybeSingle();
  if (error) {
    log.error({ event: "visits.reschedule_target.failed", code: errorTag(error), requestId: await getRequestId(), tenantId: ctx.tenantId });
    return { ok: false, error: appError("INTERNAL", { message: RESCHEDULE_TARGET_MESSAGES.INTERNAL }) };
  }
  if (!data) return { ok: false, error: appError("NOT_FOUND", { message: RESCHEDULE_TARGET_MESSAGES.NOT_FOUND }) };
  const timeZone = await getTenantTimeZone(ctx.db, ctx.tenantId);
  const clock = clockOf(data.scheduled_at as string, timeZone);
  const patient = Array.isArray(data.patients) ? data.patients[0] : data.patients;
  return {
    ok: true,
    value: {
      visitId: data.id as string,
      patientName: (patient?.full_name as string | undefined) ?? "Patient",
      doctorId: data.doctor_id as string,
      date: ymdOf(data.scheduled_at as string, timeZone),
      time: `${String(clock.hour).padStart(2, "0")}:${String(clock.minute).padStart(2, "0")}`,
      durationMinutes: (data.estimated_duration_minutes as number | null) ?? 15,
      status: data.status as Visit["status"],
      rowVersion: data.row_version as number,
    },
  };
}

/** Fixed, data-free texts by reason or code for the staff scheduling commands (V2-08 08-04a). The driver message never reaches the caller. */
export const SCHEDULING_COMMAND_MESSAGES = {
  NOT_FOUND: "Appointment not found.",
  FORBIDDEN: "You do not have permission to change appointments.",
  VALIDATION_FAILED: "Please check the appointment details.",
  SLOT_TAKEN: SLOT_TAKEN_MESSAGE,
  SLOT_OFF_DUTY: "Selected time is outside doctor shift hours. Confirmation required to book off-duty slot.",
  SLOT_BLOCKED: "The doctor is unavailable at this time. Confirmation required to book a blocked slot.",
  SLOT_IN_PAST: "Pick a time that has not passed.",
  VISIT_NOT_RESCHEDULABLE: "Only a booked, confirmed or missed appointment can be moved.",
  VISIT_NOT_CANCELLABLE: "This appointment can no longer be cancelled.",
  VISIT_NOT_MARKABLE: "Only a booked or confirmed appointment can be marked as missed.",
  VISIT_NOT_CONFIRMABLE: "Only a booked appointment can be confirmed.",
  NO_SHOW_TOO_EARLY: "The appointment time has not passed yet.",
  VISIT_TRANSITION_INVALID: "This appointment can no longer be changed this way.",
  LOCK_TIMEOUT: "The calendar is busy. Try again.",
  IDEMPOTENCY_MISMATCH: "This was already submitted with different details. Refresh and try again.",
  INTERNAL: "Failed to update the appointment.",
} as const satisfies DbErrorMessages;

const rescheduleResultSchema = z.object({
  visit_id: z.string().uuid(),
  is_overbooked: z.boolean(),
  message_enqueued: z.boolean(),
  replayed: z.boolean(),
  /** 09E-07: the visit's new `row_version` (absent in a result stored before migration 000126). */
  row_version: z.number().int().optional(),
});

export interface RescheduleVisitValue {
  visitId: string;
  isOverbooked: boolean;
  messageEnqueued: boolean;
  replayed: boolean;
  /** The visit's new `row_version` (09E-07). */
  rowVersion?: number;
}

function invalidInput(error: z.ZodError): Result<never> {
  return { ok: false, error: appError("VALIDATION_FAILED", { message: error.issues[0]?.message ?? SCHEDULING_COMMAND_MESSAGES.VALIDATION_FAILED }) };
}

/**
 * Moves a booked, confirmed or missed appointment to a new time as one atomic command (`public.reschedule_visit`, V2-08
 * 08-04a): the slot is checked in the clinic's time zone as a booking is (SLOT_TAKEN, SLOT_OFF_DUTY, SLOT_BLOCKED unless
 * overbooked or overridden), the visit goes back to `booked`, and the patient message and webhook event are queued in the
 * same transaction. `appointments:edit`.
 */
export async function rescheduleVisit(
  ctx: ServiceContext,
  input: RescheduleVisitInput,
  clientRequestId: string
): Promise<Result<RescheduleVisitValue>> {
  const parsed = rescheduleVisitSchema.safeParse(input);
  const id = clientRequestIdSchema.safeParse(clientRequestId);
  if (!parsed.success) return invalidInput(parsed.error);
  if (!id.success) return { ok: false, error: appError("VALIDATION_FAILED", { message: SCHEDULING_COMMAND_MESSAGES.VALIDATION_FAILED }) };
  if (!hasPerm(ctx.role, "appointments:edit")) {
    return { ok: false, error: appError("FORBIDDEN", { message: SCHEDULING_COMMAND_MESSAGES.FORBIDDEN }) };
  }
  const data = parsed.data;
  const outcome = await callCommand(
    ctx,
    "reschedule_visit",
    {
      p_visit_id: data.visit_id,
      p_new_scheduled_at: data.new_scheduled_at,
      p_client_request_id: clientRequestId,
      p_doctor_id: data.doctor_id ?? null,
      p_duration_minutes: data.estimated_duration_minutes ?? null,
      p_overbook: data.is_overbooked,
      p_override_off_duty: data.override_off_duty,
      p_override_block: data.override_block,
      p_notify: data.notify,
      ...versionArg("p_expected_version", data.expected_version),
    },
    rescheduleResultSchema,
    SCHEDULING_COMMAND_MESSAGES,
    { event: "visits.reschedule_visit.failed" }
  );
  if (!outcome.ok) return outcome;
  const v = outcome.value;
  return {
    ok: true,
    value: { visitId: v.visit_id, isOverbooked: v.is_overbooked, messageEnqueued: v.message_enqueued, replayed: v.replayed, rowVersion: v.row_version },
  };
}

const cancelResultSchema = z.object({
  visit_id: z.string().uuid(),
  promoted: z.boolean(),
  replacement_visit_id: z.string().uuid().nullable(),
  promoted_patient_id: z.string().uuid().nullable(),
  message_enqueued: z.boolean(),
  replayed: z.boolean(),
  row_version: z.number().int().optional(),
});

export interface CancelVisitValue {
  visitId: string;
  /** A waitlisted patient was booked into the vacated slot (D-08). */
  autoPromoted: boolean;
  replacementVisitId: string | null;
  promotedPatientId: string | null;
  messageEnqueued: boolean;
  replayed: boolean;
  /** The visit's new `row_version` (09E-07). */
  rowVersion?: number;
}

/**
 * Cancels a booked, confirmed or waiting appointment as one atomic command (`public.cancel_visit`, V2-08 08-04a): the
 * status, the reason (a closed code plus an optional note), the audit row, the waitlist promotion into the vacated slot
 * (D-08), the optional patient message and the webhook event commit together. `appointments:edit`.
 */
export async function cancelVisit(
  ctx: ServiceContext,
  input: CancelVisitInput,
  clientRequestId: string
): Promise<Result<CancelVisitValue>> {
  const parsed = cancelVisitSchema.safeParse(input);
  const id = clientRequestIdSchema.safeParse(clientRequestId);
  if (!parsed.success) return invalidInput(parsed.error);
  if (!id.success) return { ok: false, error: appError("VALIDATION_FAILED", { message: SCHEDULING_COMMAND_MESSAGES.VALIDATION_FAILED }) };
  if (!hasPerm(ctx.role, "appointments:edit")) {
    return { ok: false, error: appError("FORBIDDEN", { message: SCHEDULING_COMMAND_MESSAGES.FORBIDDEN }) };
  }
  const data = parsed.data;
  const outcome = await callCommand(
    ctx,
    "cancel_visit",
    {
      p_visit_id: data.visit_id,
      p_reason_code: data.reason_code,
      p_client_request_id: clientRequestId,
      p_reason_note: data.reason_note ?? null,
      p_notify: data.notify,
      p_promote_waitlist: data.promote_waitlist,
      ...versionArg("p_expected_version", data.expected_version),
    },
    cancelResultSchema,
    SCHEDULING_COMMAND_MESSAGES,
    { event: "visits.cancel_visit.failed" }
  );
  if (!outcome.ok) return outcome;
  const v = outcome.value;
  return {
    ok: true,
    value: {
      visitId: v.visit_id,
      autoPromoted: v.promoted,
      replacementVisitId: v.replacement_visit_id,
      promotedPatientId: v.promoted_patient_id,
      messageEnqueued: v.message_enqueued,
      replayed: v.replayed,
      rowVersion: v.row_version,
    },
  };
}

const markNoShowResultSchema = z.object({ visit_id: z.string().uuid(), replayed: z.boolean(), row_version: z.number().int().optional() });

export interface MarkNoShowValue {
  visitId: string;
  replayed: boolean;
  /** The visit's new `row_version` (09E-07). */
  rowVersion?: number;
}

/** Marks a booked or confirmed appointment whose time has passed as a no-show (`public.mark_no_show`, V2-08 08-04a). `appointments:edit`. */
export async function markNoShow(
  ctx: ServiceContext,
  visitId: string,
  clientRequestId: string,
  expectedVersion?: number | null
): Promise<Result<MarkNoShowValue>> {
  const input = z.object({ visit: z.string().uuid(), request: clientRequestIdSchema }).safeParse({ visit: visitId, request: clientRequestId });
  if (!input.success) return { ok: false, error: appError("VALIDATION_FAILED", { message: SCHEDULING_COMMAND_MESSAGES.VALIDATION_FAILED }) };
  if (!hasPerm(ctx.role, "appointments:edit")) {
    return { ok: false, error: appError("FORBIDDEN", { message: SCHEDULING_COMMAND_MESSAGES.FORBIDDEN }) };
  }
  const outcome = await callCommand(
    ctx,
    "mark_no_show",
    { p_visit_id: visitId, p_client_request_id: clientRequestId, ...versionArg("p_expected_version", expectedVersion) },
    markNoShowResultSchema,
    SCHEDULING_COMMAND_MESSAGES,
    { event: "visits.mark_no_show.failed" }
  );
  if (!outcome.ok) return outcome;
  return { ok: true, value: { visitId: outcome.value.visit_id, replayed: outcome.value.replayed, rowVersion: outcome.value.row_version } };
}

const confirmResultSchema = z.object({
  visit_id: z.string().uuid(),
  already_confirmed: z.boolean(),
  replayed: z.boolean(),
  row_version: z.number().int().optional(),
});

export interface ConfirmAppointmentValue {
  visitId: string;
  /** True when the visit was already confirmed: nothing was changed. */
  alreadyConfirmed: boolean;
  replayed: boolean;
  /** The visit's new `row_version` (09E-07). */
  rowVersion?: number;
}

/** Confirms a booked appointment (`public.confirm_appointment`, V2-08 08-04a). `appointments:edit`. */
export async function confirmAppointment(
  ctx: ServiceContext,
  visitId: string,
  clientRequestId: string,
  expectedVersion?: number | null
): Promise<Result<ConfirmAppointmentValue>> {
  const input = z.object({ visit: z.string().uuid(), request: clientRequestIdSchema }).safeParse({ visit: visitId, request: clientRequestId });
  if (!input.success) return { ok: false, error: appError("VALIDATION_FAILED", { message: SCHEDULING_COMMAND_MESSAGES.VALIDATION_FAILED }) };
  if (!hasPerm(ctx.role, "appointments:edit")) {
    return { ok: false, error: appError("FORBIDDEN", { message: SCHEDULING_COMMAND_MESSAGES.FORBIDDEN }) };
  }
  const outcome = await callCommand(
    ctx,
    "confirm_appointment",
    { p_visit_id: visitId, p_client_request_id: clientRequestId, ...versionArg("p_expected_version", expectedVersion) },
    confirmResultSchema,
    SCHEDULING_COMMAND_MESSAGES,
    { event: "visits.confirm_appointment.failed" }
  );
  if (!outcome.ok) return outcome;
  const v = outcome.value;
  return { ok: true, value: { visitId: v.visit_id, alreadyConfirmed: v.already_confirmed, replayed: v.replayed, rowVersion: v.row_version } };
}
