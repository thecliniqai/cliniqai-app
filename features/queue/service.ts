import "server-only";

import { assertPerm, hasPerm } from "@/lib/permissions";
import type { ServiceContext } from "@/lib/auth/context";
import { dayWindowUtc } from "@/lib/datetime";
import { getTenantTimeZone, getTenantToday } from "@/lib/datetime/server";
import type { QueuePriority } from "@/lib/db/types";
import { errorTag, log } from "@/lib/log";
import { getRequestId } from "@/lib/log/request-id";
import { clientErrorMessage } from "@/lib/errors/client-message";
import { callCommand } from "@/lib/commands/call-command";
import { clientRequestIdSchema } from "@/lib/commands/request-id";
import { appError, type AppError, type Result } from "@/lib/errors/app-error";
import type { DbErrorMessages } from "@/lib/db/errors";
import { z } from "zod";
import { patientSchema, newPatientPayload } from "@/features/patients/schema";
import { visitDurationSchema, DEFAULT_VISIT_DURATION_MINUTES } from "@/features/visits/duration";

// Queue use-cases (check-in, state transitions, day board). Tenant and actor come only from `ctx` (ADR-0005 D1);
// each use-case checks the permission its server action checked before the move.

/** Fixed, data-free texts by reason or code for `check_in_visit` (V2-07 07-01). The driver message never reaches the caller. */
export const CHECK_IN_COMMAND_MESSAGES = {
  NOT_FOUND: "Visit record not found.",
  FORBIDDEN: "You do not have permission to check in visits.",
  VALIDATION_FAILED: "Invalid check-in request.",
  VISIT_NOT_CHECKABLE: "This visit can no longer be checked in.",
  VISIT_NOT_TODAY: "This appointment is not for today. Reschedule it first.",
  LOCK_TIMEOUT: "The queue is busy. Try again.",
  IDEMPOTENCY_MISMATCH: "This was already submitted with different details. Refresh and try again.",
  INTERNAL: "Failed to generate queue token.",
} as const satisfies DbErrorMessages;

const checkInRpcResultSchema = z.object({
  visit_id: z.string().uuid(),
  queue_token_id: z.string().uuid(),
  token_number: z.number().int(),
  priority: z.string(),
  reused: z.boolean(),
  status_repaired: z.boolean(),
  replayed: z.boolean(),
});

export type CheckInResult =
  | { success: true; tokenNumber: number; queueTokenId: string; replayed: boolean }
  | { success: false; error: string; code?: AppError["code"]; reason?: string };

/**
 * Checks a visit in as one atomic command (`public.check_in_visit`, V2-07 07-01): the visit's queue token (its existing
 * one, or the next of the clinic-local day), the visit moved to `waiting` (a visit that already holds a token but was
 * left without the status is repaired) and the `queue.check_in` audit row, all in one transaction. The same
 * `client_request_id` replays the first result.
 */
export async function checkInVisit(
  ctx: ServiceContext,
  visitId: string,
  priority: QueuePriority,
  clientRequestId: string
): Promise<CheckInResult> {
  try {
    assertPerm(ctx.role, "appointments:edit");
  } catch (err: unknown) {
    return {
      success: false,
      error: clientErrorMessage(err, "Failed to check in visit.", "queue.check_in_visit.failed"),
    };
  }

  const input = z
    .object({ visit: z.string().uuid(), priority: z.enum(["normal", "urgent", "vip"]), request: clientRequestIdSchema })
    .safeParse({ visit: visitId, priority, request: clientRequestId });
  if (!input.success) {
    return { success: false, error: CHECK_IN_COMMAND_MESSAGES.VALIDATION_FAILED, code: "VALIDATION_FAILED" };
  }

  const outcome = await callCommand(
    ctx,
    "check_in_visit",
    { p_visit_id: visitId, p_priority: priority, p_client_request_id: clientRequestId },
    checkInRpcResultSchema,
    CHECK_IN_COMMAND_MESSAGES,
    { event: "queue.check_in_visit.failed" }
  );
  if (!outcome.ok) {
    return { success: false, error: outcome.error.message, code: outcome.error.code, reason: outcome.error.reason };
  }
  return {
    success: true,
    tokenNumber: outcome.value.token_number,
    queueTokenId: outcome.value.queue_token_id,
    replayed: outcome.value.replayed,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Walk-in (V2-07 07-03). One atomic command (`public.enqueue_walk_in`, migration 000098): the patient (when new), the
// walk-in visit and its queue token commit together or not at all; the same `client_request_id` replays the first result.
// ---------------------------------------------------------------------------------------------------------------------

/** Fixed, data-free texts by reason or code for `enqueue_walk_in`. The driver message never reaches the caller. */
export const WALK_IN_COMMAND_MESSAGES = {
  NOT_FOUND: "Patient or doctor not found in this clinic.",
  FORBIDDEN: "You do not have permission to register walk-ins.",
  VALIDATION_FAILED: "Please check the patient and visit details.",
  VISIT_NOT_CHECKABLE: "This visit can no longer be checked in.",
  LOCK_TIMEOUT: "The queue is busy. Try again.",
  IDEMPOTENCY_MISMATCH: "This was already submitted with different details. Refresh and try again.",
  INTERNAL: "Failed to register walk-in.",
} as const satisfies DbErrorMessages;

const walkInInputSchema = z
  .object({
    /** An existing patient of the clinic; exactly one of this and `new_patient`. */
    patient_id: z.string().uuid("Invalid patient ID").nullable().optional(),
    /** A new patient (the patient form's fields); registered in the same transaction as the visit. */
    new_patient: z.unknown().nullable().optional(),
    doctor_id: z.string().uuid("Invalid doctor ID"),
    priority: z.enum(["normal", "urgent", "vip"]).default("normal"),
    reason_for_visit: z.string().trim().max(500).nullable().optional(),
    estimated_duration_minutes: visitDurationSchema.default(DEFAULT_VISIT_DURATION_MINUTES),
  })
  .refine((v) => (v.patient_id ? 1 : 0) + (v.new_patient ? 1 : 0) === 1, {
    message: "Choose an existing patient or register a new one.",
  });

export type EnqueueWalkInInput = z.input<typeof walkInInputSchema>;

const walkInRpcResultSchema = z.object({
  patient_id: z.string().uuid(),
  patient_created: z.boolean(),
  visit_id: z.string().uuid(),
  queue_token_id: z.string().uuid(),
  token_number: z.number().int(),
  priority: z.string(),
  replayed: z.boolean(),
});

export interface WalkInValue {
  patientId: string;
  patientCreated: boolean;
  visitId: string;
  queueTokenId: string;
  tokenNumber: number;
  priority: string;
  /** True when this client_request_id was already registered: nothing new was written. */
  replayed: boolean;
}

/**
 * Registers a walk-in as one atomic command (V2-07 07-03): [new patient] + walk-in visit (`waiting`) + queue token, with
 * the `patient.create`, `visit.create` and `queue.check_in` audit rows, in one transaction. A failure in any step leaves
 * no patient, no visit and no token behind. `appointments:edit`, plus `patients:edit` when a patient is registered.
 */
export async function enqueueWalkIn(
  ctx: ServiceContext,
  input: EnqueueWalkInInput,
  clientRequestId: string
): Promise<Result<WalkInValue>> {
  const parsed = walkInInputSchema.safeParse(input);
  const id = clientRequestIdSchema.safeParse(clientRequestId);
  if (!parsed.success || !id.success) {
    return {
      ok: false,
      error: appError("VALIDATION_FAILED", {
        message: parsed.success ? WALK_IN_COMMAND_MESSAGES.VALIDATION_FAILED : (parsed.error.issues[0]?.message ?? WALK_IN_COMMAND_MESSAGES.VALIDATION_FAILED),
      }),
    };
  }
  const data = parsed.data;

  if (!hasPerm(ctx.role, "appointments:edit") || (data.new_patient && !hasPerm(ctx.role, "patients:edit"))) {
    return { ok: false, error: appError("FORBIDDEN", { message: WALK_IN_COMMAND_MESSAGES.FORBIDDEN }) };
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
    "enqueue_walk_in",
    {
      p_patient_id: data.patient_id ?? null,
      p_new_patient: newPatient,
      p_doctor_id: data.doctor_id,
      p_priority: data.priority,
      p_client_request_id: clientRequestId,
      p_reason: data.reason_for_visit || null,
      p_duration_minutes: data.estimated_duration_minutes,
    },
    walkInRpcResultSchema,
    WALK_IN_COMMAND_MESSAGES,
    { event: "queue.enqueue_walk_in.failed" }
  );
  if (!outcome.ok) return outcome;
  const v = outcome.value;
  return {
    ok: true,
    value: {
      patientId: v.patient_id,
      patientCreated: v.patient_created,
      visitId: v.visit_id,
      queueTokenId: v.queue_token_id,
      tokenNumber: v.token_number,
      priority: v.priority,
      replayed: v.replayed,
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Start consultation and desk completion (V2-08 08-01b, R-1, R-7). Two atomic commands (`public.start_consultation`,
// `public.complete_visit`, migration 000100) replace the old open status setter: the visit state machine in the database
// (`visits_status_transition_guard`) refuses every other status change.
// ---------------------------------------------------------------------------------------------------------------------

/** Fixed, data-free texts by reason or code for `start_consultation`. The driver message never reaches the caller. */
export const START_CONSULTATION_MESSAGES = {
  NOT_FOUND: "Visit record not found.",
  FORBIDDEN: "You do not have permission to start consultations.",
  VALIDATION_FAILED: "Invalid request.",
  VISIT_NOT_CHECKABLE: "This visit can no longer be started.",
  VISIT_NOT_TODAY: "This appointment is not for today. Reschedule it first.",
  VISIT_TRANSITION_INVALID: "This visit can no longer be moved in the queue.",
  LOCK_TIMEOUT: "The queue is busy. Try again.",
  IDEMPOTENCY_MISMATCH: "This was already submitted with different details. Refresh and try again.",
  INTERNAL: "Failed to start the consultation.",
} as const satisfies DbErrorMessages;

const startConsultationResultSchema = z.object({
  visit_id: z.string().uuid(),
  token_number: z.number().int().nullable(),
  already_started: z.boolean(),
  replayed: z.boolean(),
});

export interface StartConsultationValue {
  visitId: string;
  tokenNumber: number | null;
  /** True when the visit was already in consultation: nothing was changed. */
  alreadyStarted: boolean;
  /** True when this client_request_id was already processed: nothing new was written. */
  replayed: boolean;
}

/**
 * "Start Consultation" as one atomic command (R-1): a booked, confirmed or no-show visit is checked in first (token,
 * `waiting`, `queue.check_in` audit row), then moved to `in_consultation` with the `visit.consultation_start` audit row, in
 * one transaction. `consultations:edit` and `appointments:edit` (owner and doctor).
 */
export async function startConsultation(
  ctx: ServiceContext,
  visitId: string,
  clientRequestId: string
): Promise<Result<StartConsultationValue>> {
  const input = z.object({ visit: z.string().uuid(), request: clientRequestIdSchema }).safeParse({ visit: visitId, request: clientRequestId });
  if (!input.success) {
    return { ok: false, error: appError("VALIDATION_FAILED", { message: START_CONSULTATION_MESSAGES.VALIDATION_FAILED }) };
  }
  if (!hasPerm(ctx.role, "consultations:edit") || !hasPerm(ctx.role, "appointments:edit")) {
    return { ok: false, error: appError("FORBIDDEN", { message: START_CONSULTATION_MESSAGES.FORBIDDEN }) };
  }
  const outcome = await callCommand(
    ctx,
    "start_consultation",
    { p_visit_id: visitId, p_client_request_id: clientRequestId },
    startConsultationResultSchema,
    START_CONSULTATION_MESSAGES,
    { event: "queue.start_consultation.failed" }
  );
  if (!outcome.ok) return outcome;
  const v = outcome.value;
  return { ok: true, value: { visitId: v.visit_id, tokenNumber: v.token_number, alreadyStarted: v.already_started, replayed: v.replayed } };
}

/** Fixed, data-free texts by reason or code for `complete_visit`. */
export const COMPLETE_VISIT_MESSAGES = {
  NOT_FOUND: "Visit record not found.",
  FORBIDDEN: "You do not have permission to complete visits.",
  VALIDATION_FAILED: "Invalid request.",
  VISIT_NOT_COMPLETABLE:
    "This visit can no longer be completed here. Signed or closed consultations change only through an amendment.",
  VISIT_TRANSITION_INVALID: "This visit can no longer be moved in the queue.",
  LOCK_TIMEOUT: "The queue is busy. Try again.",
  IDEMPOTENCY_MISMATCH: "This was already submitted with different details. Refresh and try again.",
  INTERNAL: "Failed to complete the visit.",
} as const satisfies DbErrorMessages;

const completeVisitResultSchema = z.object({
  visit_id: z.string().uuid(),
  already_completed: z.boolean(),
  replayed: z.boolean(),
});

export interface CompleteVisitValue {
  visitId: string;
  /** True when the visit was already completed (the checkout after a sign-off): only the token's completion time is stamped. */
  alreadyCompleted: boolean;
  replayed: boolean;
}

/**
 * Completes an unsigned waiting or in-consultation visit at the desk as one atomic command (`appointments:edit`); a visit
 * that is already completed answers `alreadyCompleted`. A signed visit changes only through the amendment commands.
 */
export async function completeVisit(
  ctx: ServiceContext,
  visitId: string,
  clientRequestId: string
): Promise<Result<CompleteVisitValue>> {
  const input = z.object({ visit: z.string().uuid(), request: clientRequestIdSchema }).safeParse({ visit: visitId, request: clientRequestId });
  if (!input.success) {
    return { ok: false, error: appError("VALIDATION_FAILED", { message: COMPLETE_VISIT_MESSAGES.VALIDATION_FAILED }) };
  }
  if (!hasPerm(ctx.role, "appointments:edit")) {
    return { ok: false, error: appError("FORBIDDEN", { message: COMPLETE_VISIT_MESSAGES.FORBIDDEN }) };
  }
  const outcome = await callCommand(
    ctx,
    "complete_visit",
    { p_visit_id: visitId, p_client_request_id: clientRequestId },
    completeVisitResultSchema,
    COMPLETE_VISIT_MESSAGES,
    { event: "queue.complete_visit.failed" }
  );
  if (!outcome.ok) return outcome;
  const v = outcome.value;
  return { ok: true, value: { visitId: v.visit_id, alreadyCompleted: v.already_completed, replayed: v.replayed } };
}

/**
 * The command palette's "Today queue" group (V2-06 06-04b; IA §3.7 "Today: queue matches by token, name or phone"):
 * today's visits in the caller's clinic (clinic date in its zone) whose token number, patient name or mobile number
 * matches `query`, projected to four fields. Cancelled visits are left out. The tenant comes from the session context.
 */
interface PaletteVisitRow {
  id: string;
  status: string;
  patients: { full_name: string; phone: string | null } | { full_name: string; phone: string | null }[] | null;
  queue_tokens: { token_number: number } | { token_number: number }[] | null;
}

interface PaletteVisitsQuery {
  select: (columns: string) => { eq: (column: string, value: string) => { or: (filter: string) => PromiseLike<unknown> } };
}

export interface PaletteQueueMatch {
  visitId: string;
  token: number | null;
  name: string;
  status: string;
}

export const PALETTE_QUEUE_KEYS = ["visitId", "token", "name", "status"] as const;
export const PALETTE_QUEUE_LIMIT = 5;

export async function searchTodayQueueForPalette(ctx: ServiceContext, query: string): Promise<PaletteQueueMatch[]> {
  assertPerm(ctx.role, "appointments:view");
  const q = typeof query === "string" ? query.trim().slice(0, 100) : "";
  if (!q) return [];
  // Today's visits, three columns of the patient and the token only (V2-08 08-03b: the v1 `select *` day list is gone). The
  // window is the board's: a booking belongs to the day of its appointment time, a walk-in to the day it was created.
  const { today } = await getTenantToday(ctx.db, ctx.tenantId);
  const { startIso, endIsoExclusive } = dayWindowUtc(today, await getTenantTimeZone(ctx.db, ctx.tenantId));
  const { data, error } = (await (ctx.db.from("visits") as unknown as PaletteVisitsQuery)
    .select("id, status, patients(full_name, phone), queue_tokens(token_number)")
    .eq("tenant_id", ctx.tenantId)
    .or(
      `and(scheduled_at.gte.${startIso},scheduled_at.lt.${endIsoExclusive}),` +
        `and(scheduled_at.is.null,created_at.gte.${startIso},created_at.lt.${endIsoExclusive})`
    )) as { data: PaletteVisitRow[] | null; error: { message: string } | null };
  if (error || !data) {
    log.error({ event: "queue.palette_list.failed", code: errorTag(error), requestId: await getRequestId(), tenantId: ctx.tenantId });
    return [];
  }
  const items = data.map((row) => {
    const patient = Array.isArray(row.patients) ? row.patients[0] : row.patients;
    const token = Array.isArray(row.queue_tokens) ? row.queue_tokens[0] : row.queue_tokens;
    return { visitId: row.id, status: row.status, name: patient?.full_name ?? "", phone: patient?.phone ?? "", token: token?.token_number ?? null };
  });

  const lower = q.toLowerCase();
  // "14", "#14", "T14", "token 14" → token 14; a longer digit run is a mobile number fragment.
  const tokenQuery = /^(?:#|t|token\s*)?(\d{1,4})$/i.exec(q)?.[1];
  const digits = q.replace(/\D/g, "");
  const matches: PaletteQueueMatch[] = [];
  for (const item of items) {
    if (item.status === "cancelled") continue;
    const { name, token } = item;
    const phone = item.phone.replace(/\D/g, "");
    const hit =
      (tokenQuery !== undefined && token !== null && token === Number(tokenQuery)) ||
      (name !== "" && name.toLowerCase().includes(lower)) ||
      (digits.length >= 4 && digits.length === q.replace(/[\s+()-]/g, "").length && phone.includes(digits.slice(-10)));
    if (!hit) continue;
    matches.push({ visitId: item.visitId, token, name, status: item.status });
    if (matches.length >= PALETTE_QUEUE_LIMIT) break;
  }
  return matches;
}
