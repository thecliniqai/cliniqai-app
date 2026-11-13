/**
 * The request-path enqueue surface (V2-04 04-03a; P0-12, ADR-0005 D3 + proposed A2, rulings R-6 revised, R-24).
 *
 * A request never sends a message: it calls one SECURITY DEFINER RPC (migration 000035) that writes a
 * `communication_queue` row, and the row's AFTER INSERT trigger creates its `message.send` job. The runner
 * (`/api/jobs/run`, `lib/jobs/internal/handlers/message-send.ts`) sends it.
 *
 * - `enqueueMessage(ctx, input)`: `public.enqueue_message` on the caller's own user-JWT client (`ctx.db`). The tenant is
 *   derived in SQL from the subject (the visit, else the patient); `ctx.tenantId` (session-derived, never request
 *   input) is only a constraint the subject must match, together with a membership. A subject outside the active
 *   clinic reads as not found.
 * - `enqueueMessageAsSystem(db, input, actor)`: `public.enqueue_message_system` (service role only) for system modules,
 *   inbound webhooks and job handlers, on a client the caller was allowed to open; `actor` is a closed set.
 *
 * Webhook events (04-03b; R-19, R-26): `enqueueWebhookEvent(ctx, eventType, subjectId)` calls
 * `public.enqueue_webhook_event` on `ctx.db`; `enqueueWebhookEventAsSystem(db, eventType, subjectId, actor)` calls
 * `public.enqueue_webhook_event_system`. The event data is built in SQL from the subject row (no caller payload), the
 * subscriptions are read as definer (doctor and receptionist events are no longer dropped), one row per subscription is
 * written with the event key `<event>:<subject>` and the row's trigger creates its `webhook.deliver` job. The test ping
 * is `enqueueWebhookEvent(ctx, "ping", subscriptionId)` (owner/admin, 5 per clinic per minute).
 *
 * No provider import, no deliverer import, no system factory import (ESLint P1-34 and P0-12 zones). Errors are thrown
 * as {@link EnqueueError}: a fixed message, the mapped {@link AppError} and a code-shaped `code` for `errorTag`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ServiceContext } from "@/lib/auth/context";
import type { CommunicationChannel } from "@/lib/db/types";
import { mapDbError, type DbErrorLike } from "@/lib/db/errors";
import type { AppError } from "@/lib/errors/app-error";

export interface EnqueueMessageInput {
  patientId?: string | null;
  /** The visit the message is about (stored as `appointment_id`); the subject when given. */
  visitId?: string | null;
  channel: CommunicationChannel;
  messageType: string;
  templateId: string;
  templateParams?: Record<string, unknown>;
  /** Must be the patient's or the guardian's number (R-24); omitted → the patient's number. */
  recipientPhone?: string | null;
  recipientUserId?: string | null;
  metadata?: Record<string, unknown>;
  /** Send no earlier than this (the job's `run_at`). */
  runAt?: Date | string | null;
  /** Business dedupe key: the same key in the same clinic enqueues once (`deduped: true` the second time). */
  dedupeKey?: string | null;
}

/** What an enqueue returns: ids and status only (members cannot read payload columns, AR3-N1). */
export interface EnqueuedMessage {
  id: string;
  status: string;
  deduped: boolean;
}

/** The closed set of system actors `enqueue_message_system` / `enqueue_webhook_event_system` accept (same list in SQL). */
export type MessageSystemActor =
  | "system:messaging_webhook"
  | "system:patient_self_service_reschedule"
  | "system:api_v1"
  | "system:jobs";

const MESSAGES = {
  NOT_FOUND: "The patient or visit for this message was not found.",
  VALIDATION_FAILED: "This message cannot be sent to this recipient.",
  FORBIDDEN: "You do not have permission to send this message.",
  INTERNAL: "Failed to queue the message.",
};

/** A refused or failed enqueue. `message` is fixed; `code` is the machine reason (or code) for `errorTag`. */
export class EnqueueError extends Error {
  readonly code: string;
  readonly appError: AppError;
  constructor(appError: AppError) {
    super(appError.message);
    this.name = "EnqueueError";
    this.appError = appError;
    this.code = appError.reason ?? appError.code;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any, any, any>;

function runAtIso(runAt: EnqueueMessageInput["runAt"]): string {
  if (!runAt) return new Date().toISOString();
  return typeof runAt === "string" ? runAt : runAt.toISOString();
}

function subjectArgs(input: EnqueueMessageInput) {
  return {
    p_patient_id: input.patientId ?? null,
    p_visit_id: input.visitId ?? null,
    p_channel: input.channel,
    p_message_type: input.messageType,
    p_template_id: input.templateId,
    p_template_params: input.templateParams ?? {},
    p_recipient_phone: input.recipientPhone ?? null,
    p_recipient_user_id: input.recipientUserId ?? null,
    p_metadata: input.metadata ?? {},
    p_run_at: runAtIso(input.runAt),
    p_dedupe_key: input.dedupeKey ?? null,
  };
}

function parseResult(data: unknown): EnqueuedMessage {
  const row = (data ?? {}) as { id?: unknown; status?: unknown; deduped?: unknown };
  if (typeof row.id !== "string" || typeof row.status !== "string") {
    throw new EnqueueError(mapDbError(null, MESSAGES));
  }
  return { id: row.id, status: row.status, deduped: row.deduped === true };
}

async function call(db: AnyDb, fn: string, args: Record<string, unknown>): Promise<EnqueuedMessage> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new EnqueueError(mapDbError(error as DbErrorLike, MESSAGES));
  return parseResult(data);
}

/** Queues a message for the caller's active clinic (`ctx.tenantId`) on the caller's own client. */
export async function enqueueMessage(
  ctx: Pick<ServiceContext, "db" | "tenantId">,
  input: EnqueueMessageInput
): Promise<EnqueuedMessage> {
  return call(ctx.db as AnyDb, "enqueue_message", { p_tenant_id: ctx.tenantId, ...subjectArgs(input) });
}

/** Queues a message on the system path (service-role client; the tenant comes from the subject row). */
export async function enqueueMessageAsSystem(
  db: AnyDb,
  input: EnqueueMessageInput,
  actor: MessageSystemActor
): Promise<EnqueuedMessage> {
  return call(db, "enqueue_message_system", { p_system_actor: actor, ...subjectArgs(input) });
}

/** The closed set of webhook events a request path may raise (same list in SQL, migration 000036). */
export type WebhookEventType =
  | "appointment.rescheduled"
  | "appointment.cancelled"
  | "visit.completed"
  | "prescription.issued"
  | "lab_result.ready";

/** What a webhook enqueue returns: how many deliveries were queued (0: no active subscriber, or already queued). */
export interface EnqueuedWebhookEvent {
  queued: number;
  deliveryIds: string[];
}

const WEBHOOK_MESSAGES = {
  NOT_FOUND: "The record for this webhook event was not found.",
  VALIDATION_FAILED: "This webhook event cannot be sent.",
  FORBIDDEN: "You do not have permission to send this webhook event.",
  INTERNAL: "Failed to queue the webhook event.",
};

function parseWebhookResult(data: unknown): EnqueuedWebhookEvent {
  const row = (data ?? {}) as { queued?: unknown; delivery_ids?: unknown };
  const ids = Array.isArray(row.delivery_ids) ? row.delivery_ids.filter((v): v is string => typeof v === "string") : null;
  if (typeof row.queued !== "number" || !ids) throw new EnqueueError(mapDbError(null, WEBHOOK_MESSAGES));
  return { queued: row.queued, deliveryIds: ids };
}

async function callWebhook(db: AnyDb, fn: string, args: Record<string, unknown>): Promise<EnqueuedWebhookEvent> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new EnqueueError(mapDbError(error as DbErrorLike, WEBHOOK_MESSAGES));
  return parseWebhookResult(data);
}

/**
 * Queues a webhook event about `subjectId` (the visit, prescription or patient document; the subscription for `ping`)
 * for the caller's active clinic (`ctx.tenantId`) on the caller's own client.
 */
export async function enqueueWebhookEvent(
  ctx: Pick<ServiceContext, "db" | "tenantId">,
  eventType: WebhookEventType | "ping",
  subjectId: string
): Promise<EnqueuedWebhookEvent> {
  return callWebhook(ctx.db as AnyDb, "enqueue_webhook_event", {
    p_tenant_id: ctx.tenantId,
    p_event_type: eventType,
    p_subject_id: subjectId,
    p_subscription_id: eventType === "ping" ? subjectId : null,
  });
}

/** Queues a webhook event on the system path (service-role client; the tenant comes from the subject row). */
export async function enqueueWebhookEventAsSystem(
  db: AnyDb,
  eventType: WebhookEventType,
  subjectId: string,
  actor: MessageSystemActor
): Promise<EnqueuedWebhookEvent> {
  return callWebhook(db, "enqueue_webhook_event_system", {
    p_system_actor: actor,
    p_event_type: eventType,
    p_subject_id: subjectId,
  });
}
