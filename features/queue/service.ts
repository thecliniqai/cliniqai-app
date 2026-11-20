import "server-only";

import { assertPerm, hasPerm } from "@/lib/permissions";
import type { ServiceContext } from "@/lib/auth/context";
import { recordAudit } from "@/lib/audit/audit";
import { isDateOnly } from "@/lib/utils/filter-values";
import { dayWindowUtc } from "@/lib/datetime";
import { getTenantTimeZone, getTenantToday } from "@/lib/datetime/server";
import { QueuePriority, QueueToken, Visit, Patient } from "@/lib/db/types";
import type { QueueItem } from "@/components/queue/queue-card";
import { clinicalNotesEmbed, embeddedClinicalNotes, CLINICAL_NOTES_EMBED_KEY } from "@/lib/db/clinical-notes";
import { getTenantDoctorMap } from "@/features/staff/service";
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

export type TransitionStateResult =
  | { success: true }
  | { success: false; error: string };

/** Visit statuses the queue may move forward (AR2-L2). */
const QUEUE_OPEN_STATUSES = ["booked", "confirmed", "waiting", "in_consultation"];

export const QUEUE_TRANSITION_REFUSED_MESSAGE =
  "This visit can no longer be moved in the queue. Signed or closed consultations change only through an amendment.";

type QueueTokenUpdate = {
  update: (vals: Record<string, unknown>) => {
    eq: (col: string, val: string) => {
      eq: (col: string, val: string) => Promise<{ error: unknown }>;
    };
  };
};

export async function transitionQueueState(
  ctx: ServiceContext,
  visitId: string,
  targetState: "in_consultation" | "completed"
): Promise<TransitionStateResult> {
  const supabase = ctx.db;

  try {
    assertPerm(ctx.role, "appointments:edit");
    const nowIso = new Date().toISOString();

    if (targetState !== "in_consultation" && targetState !== "completed") {
      return { success: false, error: QUEUE_TRANSITION_REFUSED_MESSAGE };
    }

    // AR2-L2: the queue moves only open, unsigned visits forward. A completed or cancelled visit never goes back to
    // in_consultation, and a signed visit (including one reopened for amendment) is never moved by the queue: only
    // the amendment flow (reopenVisitForAmendment / finalizeVisitAmendment) changes those. The precondition sits in
    // the UPDATE filter, so a concurrent sign-off cannot slip between a read and the write.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: moved, error: moveErr } = await (supabase.from("visits") as any)
      .update({ status: targetState, updated_at: nowIso })
      .eq("id", visitId)
      .eq("tenant_id", ctx.tenantId)
      .in("status", QUEUE_OPEN_STATUSES)
      .is("signed_at", null)
      .select("id");

    if (moveErr) {
      log.error({ event: "queue.transition.failed", code: errorTag(moveErr), requestId: await getRequestId(), tenantId: ctx.tenantId });
      return { success: false, error: "Failed to transition queue state." };
    }

    if (!moved || moved.length === 0) {
      // Completing an already-completed visit (checkout after sign-off) is a no-op, not an error.
      if (targetState === "completed") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: current } = await (supabase.from("visits") as any)
          .select("status")
          .eq("id", visitId)
          .eq("tenant_id", ctx.tenantId)
          .maybeSingle();
        if (current?.status === "completed") {
          await (supabase.from("queue_tokens") as unknown as QueueTokenUpdate)
            .update({ completed_at: nowIso })
            .eq("visit_id", visitId)
            .eq("tenant_id", ctx.tenantId);
          return { success: true };
        }
      }
      return { success: false, error: QUEUE_TRANSITION_REFUSED_MESSAGE };
    }

    await (supabase.from("queue_tokens") as unknown as QueueTokenUpdate)
      .update(targetState === "in_consultation" ? { called_at: nowIso } : { completed_at: nowIso })
      .eq("visit_id", visitId)
      .eq("tenant_id", ctx.tenantId);

    await recordAudit(ctx, {
      action: "queue.transition",
      entityType: "visit",
      entityId: visitId,
      metadata: {
        new_status: targetState,
      },
    });

    return { success: true };
  } catch (err: unknown) {
    return {
      success: false,
      error: clientErrorMessage(err, "Failed to transition queue state.", "queue.transition_queue_state.failed"),
    };
  }
}

interface QueueRow extends Visit {
  patients?: Patient | null;
  queue_tokens?: QueueToken | QueueToken[] | null;
  /** The visit's clinical_notes row (vitals only); null when RLS hides it (receptionist, admin; V2-05 05-02a). */
  [CLINICAL_NOTES_EMBED_KEY]?: unknown;
}

export type GetQueueResult = { success: true; items: QueueItem[] } | { success: false; error: string };

export async function getQueueForDate(
  ctx: ServiceContext,
  dateStr: string,
  doctorId?: string
): Promise<GetQueueResult> {
  const supabase = ctx.db;

  try {
    assertPerm(ctx.role, "appointments:view");
    const session = ctx;

    // The date is interpolated into PostgREST filter strings below, so only YYYY-MM-DD is accepted.
    if (!isDateOnly(dateStr)) {
      return { success: false, error: "Failed to load queue for date." };
    }

    // The clinic day in the tenant's zone, half-open (V2-03 03-05).
    const { startIso: startOfDay, endIsoExclusive: endOfDay } = dayWindowUtc(
      dateStr,
      await getTenantTimeZone(supabase, session.tenantId)
    );

    const query = (supabase.from("visits") as unknown as {
      select: (cols: string) => {
        eq: (col: string, val: string) => {
          or: (f1: string) => {
            or: (f2: string) => Promise<{ data: QueueRow[] | null; error: { message: string } | null }> & {
              eq: (col: string, val: string) => Promise<{ data: QueueRow[] | null; error: { message: string } | null }>;
            };
          };
        };
      };
    })
      .select(`*, patients(*), queue_tokens(*), ${clinicalNotesEmbed(["vitals"])}`)
      .eq("tenant_id", session.tenantId)
      .or(`scheduled_at.gte.${startOfDay},created_at.gte.${startOfDay}`)
      .or(`scheduled_at.lt.${endOfDay},created_at.lt.${endOfDay}`);

    let data: QueueRow[] | null = null;
    let error: { message: string } | null = null;

    if (doctorId && doctorId !== "all") {
      const res = await query.eq("doctor_id", doctorId);
      data = res.data;
      error = res.error;
    } else {
      const res = await query;
      data = res.data;
      error = res.error;
    }

    if (error) {
      log.error({ event: "queue.list.failed", code: errorTag(error), requestId: await getRequestId(), tenantId: ctx.tenantId });
      return { success: false, error: "Failed to load queue for date." };
    }

    const doctorMap = await getTenantDoctorMap(ctx);

    const items: QueueItem[] = (data || []).map((row) => {
      const queueToken = Array.isArray(row.queue_tokens)
        ? row.queue_tokens[0] || null
        : row.queue_tokens || null;

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { patients, queue_tokens: _qt, [CLINICAL_NOTES_EMBED_KEY]: _notes, ...visitData } = row;
      const resolvedDocName = row.doctor_id ? doctorMap[row.doctor_id] : null;

      return {
        // Triage vitals come from clinical_notes (05-02a): null for a role that may not read them.
        visit: { ...(visitData as Visit), vitals: embeddedClinicalNotes(row)?.vitals ?? null },
        patient: patients || null,
        queueToken: queueToken || null,
        doctorName: resolvedDocName || (row.doctor_id ? "Doctor" : "Clinic"),
      };
    });

    const statusOrder: Record<string, number> = {
      in_consultation: 1,
      waiting: 2,
      booked: 3,
      confirmed: 3,
      completed: 4,
      cancelled: 5,
      no_show: 6,
    };

    items.sort((a, b) => {
      const orderA = statusOrder[a.visit.status] ?? 99;
      const orderB = statusOrder[b.visit.status] ?? 99;
      if (orderA !== orderB) return orderA - orderB;

      if (a.visit.status === "waiting" && b.visit.status === "waiting") {
        const tokenA = a.queueToken?.token_number ?? 999999;
        const tokenB = b.queueToken?.token_number ?? 999999;
        return tokenA - tokenB;
      }

      if (a.visit.scheduled_at && b.visit.scheduled_at) {
        return new Date(a.visit.scheduled_at).getTime() - new Date(b.visit.scheduled_at).getTime();
      }

      return new Date(a.visit.created_at).getTime() - new Date(b.visit.created_at).getTime();
    });

    return { success: true, items };
  } catch (err: unknown) {
    return {
      success: false,
      error: clientErrorMessage(err, "Failed to fetch queue.", "queue.get_queue_for_date.failed"),
    };
  }
}

/**
 * The command palette's "Today queue" group (V2-06 06-04b; IA §3.7 "Today: queue matches by token, name or phone"):
 * today's visits in the caller's clinic (clinic date in its zone) whose token number, patient name or mobile number
 * matches `query`, projected to four fields. Cancelled visits are left out. The tenant comes from the session context.
 */
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
  const { today } = await getTenantToday(ctx.db, ctx.tenantId);
  const result = await getQueueForDate(ctx, today);
  if (!result.success) return [];

  const lower = q.toLowerCase();
  // "14", "#14", "T14", "token 14" → token 14; a longer digit run is a mobile number fragment.
  const tokenQuery = /^(?:#|t|token\s*)?(\d{1,4})$/i.exec(q)?.[1];
  const digits = q.replace(/\D/g, "");
  const matches: PaletteQueueMatch[] = [];
  for (const item of result.items) {
    if (item.visit.status === "cancelled") continue;
    const name = item.patient?.full_name ?? "";
    const token = item.queueToken?.token_number ?? null;
    const phone = (item.patient?.phone ?? "").replace(/\D/g, "");
    const hit =
      (tokenQuery !== undefined && token !== null && token === Number(tokenQuery)) ||
      (name !== "" && name.toLowerCase().includes(lower)) ||
      (digits.length >= 4 && digits.length === q.replace(/[\s+()-]/g, "").length && phone.includes(digits.slice(-10)));
    if (!hit) continue;
    matches.push({ visitId: item.visit.id, token, name, status: item.visit.status });
    if (matches.length >= PALETTE_QUEUE_LIMIT) break;
  }
  return matches;
}
