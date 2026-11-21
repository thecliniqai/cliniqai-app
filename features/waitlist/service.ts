import "server-only";

import { z } from "zod";
import { assertPerm, hasPerm } from "@/lib/permissions";
import type { ServiceContext } from "@/lib/auth/context";
import { Patient, WaitlistEntry } from "@/lib/db/types";
import { visitDurationSchema, DEFAULT_VISIT_DURATION_MINUTES } from "@/features/visits/duration";
import { callCommand } from "@/lib/commands/call-command";
import { clientRequestIdSchema } from "@/lib/commands/request-id";
import { appError, type Result } from "@/lib/errors/app-error";
import type { DbErrorMessages } from "@/lib/db/errors";
import { errorTag, log } from "@/lib/log";
import { getRequestId } from "@/lib/log/request-id";
import { clientErrorMessage } from "@/lib/errors/client-message";

// Waitlist use-cases. Tenant and actor come only from `ctx` (ADR-0005 D1); each use-case checks the permission its
// server action checked before the move. The two writes (add, promote) are atomic commands (V2-08 08-04a).

const addToWaitlistSchema = z.object({
  patient_id: z.string().uuid("Invalid patient ID"),
  doctor_id: z.string().uuid("Invalid doctor ID").nullable().optional(),
  target_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Target date must be in YYYY-MM-DD format"),
  time_window: z.string().max(100).nullable().optional(),
  priority: z.number().int().min(0).max(10).default(0),
  notes: z.string().max(500).nullable().optional(),
});

export type AddToWaitlistInput = z.input<typeof addToWaitlistSchema>;

/** Fixed, data-free texts by reason or code for the waitlist commands (V2-08 08-04a). The driver message never reaches the caller. */
export const WAITLIST_COMMAND_MESSAGES = {
  NOT_FOUND: "Patient, doctor or waitlist entry not found in this clinic.",
  FORBIDDEN: "You do not have permission to change the waitlist.",
  VALIDATION_FAILED: "Please check the waitlist details.",
  SLOT_TAKEN: "This slot was just booked for the doctor. Pick another time, or confirm the overbooking.",
  SLOT_OFF_DUTY: "Selected time is outside doctor shift hours. Confirmation required to book off-duty slot.",
  SLOT_BLOCKED: "The doctor is unavailable at this time. Confirmation required to book a blocked slot.",
  SLOT_IN_PAST: "Pick a time that has not passed.",
  WAITLIST_ENTRY_CLOSED: "This waitlist entry is no longer waiting.",
  LOCK_TIMEOUT: "The calendar is busy. Try again.",
  IDEMPOTENCY_MISMATCH: "This was already submitted with different details. Refresh and try again.",
  INTERNAL: "Failed to update the waitlist.",
} as const satisfies DbErrorMessages;

const addToWaitlistResultSchema = z.object({ entry_id: z.string().uuid(), replayed: z.boolean() });

export interface AddToWaitlistValue {
  entryId: string;
  replayed: boolean;
}

/**
 * Adds a patient to the clinic's appointment waitlist (D-08) as one atomic command (`public.add_to_waitlist`, V2-08
 * 08-04a): the entry and its audit row commit together; the patient and the doctor must belong to the clinic.
 * `appointments:edit`.
 */
export async function addToWaitlist(
  ctx: ServiceContext,
  input: AddToWaitlistInput,
  clientRequestId: string
): Promise<Result<AddToWaitlistValue>> {
  const parsed = addToWaitlistSchema.safeParse(input);
  const id = clientRequestIdSchema.safeParse(clientRequestId);
  if (!parsed.success) {
    return { ok: false, error: appError("VALIDATION_FAILED", { message: parsed.error.issues[0]?.message ?? WAITLIST_COMMAND_MESSAGES.VALIDATION_FAILED }) };
  }
  if (!id.success) return { ok: false, error: appError("VALIDATION_FAILED", { message: WAITLIST_COMMAND_MESSAGES.VALIDATION_FAILED }) };
  if (!hasPerm(ctx.role, "appointments:edit")) {
    return { ok: false, error: appError("FORBIDDEN", { message: WAITLIST_COMMAND_MESSAGES.FORBIDDEN }) };
  }
  const data = parsed.data;
  const outcome = await callCommand(
    ctx,
    "add_to_waitlist",
    {
      p_patient_id: data.patient_id,
      p_target_date: data.target_date,
      p_client_request_id: clientRequestId,
      p_doctor_id: data.doctor_id || null,
      p_time_window: data.time_window || null,
      p_priority: data.priority,
      p_notes: data.notes || null,
    },
    addToWaitlistResultSchema,
    WAITLIST_COMMAND_MESSAGES,
    { event: "waitlist.add_to_waitlist.failed" }
  );
  if (!outcome.ok) return outcome;
  return { ok: true, value: { entryId: outcome.value.entry_id, replayed: outcome.value.replayed } };
}

export interface WaitlistEntryWithPatient extends WaitlistEntry {
  patient?: Patient | null;
}

export type GetWaitlistResult =
  | { success: true; entries: WaitlistEntryWithPatient[] }
  | { success: false; error: string };

/**
 * Retrieves active waitlist entries for a specified date and optional doctor.
 */
export async function getWaitlistForDate(
  ctx: ServiceContext,
  targetDate: string,
  doctorId?: string
): Promise<GetWaitlistResult> {
  const supabase = ctx.db;

  try {
    assertPerm(ctx.role, "appointments:view");
    const session = ctx;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    type Rows = Promise<{ data: any[] | null; error: { message: string } | null }>;
    const query = (supabase.from("waitlist_entries") as unknown as {
      select: (cols: string) => {
        eq: (col: string, val: string) => {
          eq: (col: string, val: string) => {
            eq: (col: string, val: string) => {
              order: (c1: string, o1: Record<string, unknown>) => {
                order: (c2: string, o2: Record<string, unknown>) => Rows;
                eq: (col: string, val: string) => {
                  order: (c2: string, o2: Record<string, unknown>) => Rows;
                };
              };
            };
          };
        };
      };
    })
      .select("*, patients(*)")
      .eq("tenant_id", session.tenantId)
      .eq("target_date", targetDate)
      .eq("status", "waiting");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let entriesData: any[] | null = null;
    let entriesError: { message: string } | null = null;

    if (doctorId && doctorId !== "all") {
      const res = await query.order("priority", { ascending: false }).eq("doctor_id", doctorId).order("created_at", { ascending: true });
      entriesData = res.data;
      entriesError = res.error;
    } else {
      const res = await query.order("priority", { ascending: false }).order("created_at", { ascending: true });
      entriesData = res.data;
      entriesError = res.error;
    }

    if (entriesError) {
      log.error({ event: "waitlist.list_query.failed", code: errorTag(entriesError), requestId: await getRequestId(), tenantId: ctx.tenantId });
      return { success: false, error: "Failed to load waitlist entries." };
    }

    const entries: WaitlistEntryWithPatient[] = (entriesData || []).map((row) => {
      const { patients, ...entryData } = row;
      return {
        ...entryData,
        patient: patients || null,
      };
    });

    return { success: true, entries };
  } catch (err: unknown) {
    return {
      success: false,
      error: clientErrorMessage(err, "Failed to fetch waitlist.", "waitlist.get_waitlist_for_date.failed"),
    };
  }
}

const promoteWaitlistInputSchema = z.object({
  entry_id: z.string().uuid("Invalid waitlist entry ID"),
  scheduled_at: z.string().datetime({ offset: true }),
  doctor_id: z.string().uuid("Invalid doctor ID").nullable().optional(),
  estimated_duration_minutes: visitDurationSchema.default(DEFAULT_VISIT_DURATION_MINUTES),
  is_overbooked: z.boolean().default(false),
});

export type PromoteWaitlistInput = z.input<typeof promoteWaitlistInputSchema>;

const promoteWaitlistResultSchema = z.object({ entry_id: z.string().uuid(), visit_id: z.string().uuid(), replayed: z.boolean() });

export interface PromoteWaitlistValue {
  entryId: string;
  visitId: string;
  replayed: boolean;
}

/**
 * Explicitly promotes a waiting waitlist entry into a chosen future slot as one atomic command
 * (`public.promote_waitlist_entry`, V2-08 08-04a): the slot is checked like a booking, the visit, the entry's new status and
 * the audit rows commit together. `appointments:edit`.
 */
export async function promoteWaitlistEntry(
  ctx: ServiceContext,
  input: PromoteWaitlistInput,
  clientRequestId: string
): Promise<Result<PromoteWaitlistValue>> {
  const parsed = promoteWaitlistInputSchema.safeParse(input);
  const id = clientRequestIdSchema.safeParse(clientRequestId);
  if (!parsed.success) {
    return { ok: false, error: appError("VALIDATION_FAILED", { message: parsed.error.issues[0]?.message ?? WAITLIST_COMMAND_MESSAGES.VALIDATION_FAILED }) };
  }
  if (!id.success) return { ok: false, error: appError("VALIDATION_FAILED", { message: WAITLIST_COMMAND_MESSAGES.VALIDATION_FAILED }) };
  if (!hasPerm(ctx.role, "appointments:edit")) {
    return { ok: false, error: appError("FORBIDDEN", { message: WAITLIST_COMMAND_MESSAGES.FORBIDDEN }) };
  }
  const data = parsed.data;
  const outcome = await callCommand(
    ctx,
    "promote_waitlist_entry",
    {
      p_entry_id: data.entry_id,
      p_scheduled_at: data.scheduled_at,
      p_client_request_id: clientRequestId,
      p_doctor_id: data.doctor_id ?? null,
      p_duration_minutes: data.estimated_duration_minutes,
      p_overbook: data.is_overbooked,
    },
    promoteWaitlistResultSchema,
    WAITLIST_COMMAND_MESSAGES,
    { event: "waitlist.promote_waitlist_entry.failed" }
  );
  if (!outcome.ok) return outcome;
  const v = outcome.value;
  return { ok: true, value: { entryId: v.entry_id, visitId: v.visit_id, replayed: v.replayed } };
}
