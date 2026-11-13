/**
 * Job kind `message.send` (V2-04 04-03a; P0-12, R-7, R-20, R-23). One job per `communication_queue` row, created by the
 * row's AFTER INSERT trigger (migration 000035) with payload `{ queue_id }` and dedupe key `msg:<id>`. The delivery row
 * keeps its own retry schedule and terminal states (R-23); the job follows the row's `next_retry_at`.
 *
 * 1. `communication_queue_claim(queue_id)` on the system client (the claim is the UPDATE to `processing`, so two runners
 *    never send one row). No row: a terminal or missing row → done; `processing` (another sender, or a crash the
 *    delivery reaper will reclaim after 240 s) → retry in 60 s; `pending`/`failed` not yet due → retry at its time.
 * 2. Send with the provider, passing the runner's abort signal.
 * 3. Success → `communication_queue_finish(success)` + one `communication_sent` audit row (no phone) → done.
 *    `retryable: false` (the `disabled` provider, a synthetic recipient, an MSG91 4xx, no recipient) →
 *    `communication_queue_dead_letter` → dead, no SMS fallback (03-01 handover). A retryable failure →
 *    `communication_queue_finish(failure)`: `failed` → at most one SMS fallback (dedupe key `msg-fallback:<queue_id>`)
 *    and retry at the row's `next_retry_at`; `dead_letter` → dead. A dead job's trigger dead-letters a still-open row
 *    and adds the clinic's one "Message Delivery Failed" notification.
 *
 * At-least-once (R-7, A6): MSG91 has no idempotency key, so a crash between the provider call and the finish re-sends
 * after the reaper; normal operation sends exactly once (claim + job lease fencing). Results carry codes only.
 */
import { z } from "zod";
import { errorTag, log } from "@/lib/log";
import { getMessagingProvider } from "@/lib/messaging";
import type { InteractiveButton, MessagingProvider, MessagingSendResult } from "@/lib/messaging/types";
import { enqueueMessageAsSystem } from "@/lib/jobs/enqueue";
import type { HandlerResult, JobContext, JobHandler } from "../types";

export const MESSAGE_SEND_KIND = "message.send";

const PAYLOAD = z.object({ queue_id: z.string().uuid() }).strict();
type Payload = z.infer<typeof PAYLOAD>;

const TERMINAL = new Set(["sent", "delivered", "read", "dead_letter", "cancelled"]);
const IN_PROGRESS_RETRY_MS = 60_000;
const CLAIM_MISSED_RETRY_MS = 5_000;
const CODE = /^[A-Za-z0-9_.:-]{1,64}$/;

interface QueueRow {
  id: string;
  tenant_id: string;
  patient_id: string | null;
  appointment_id: string | null;
  channel: "whatsapp" | "sms" | "in_app";
  message_type: string;
  template_id: string;
  template_params: Record<string, unknown> | null;
  recipient_phone: string | null;
  metadata: Record<string, unknown> | null;
}

function firstRow<T>(data: unknown): T | null {
  if (Array.isArray(data)) return (data[0] as T) ?? null;
  return (data as T) ?? null;
}

/** A machine code for a failed send: the provider's code, a code-shaped error, or a fixed fallback. */
function failureCode(result: MessagingSendResult): string {
  if (result.code && CODE.test(result.code)) return result.code;
  if (result.error && CODE.test(result.error)) return result.error;
  return "provider_failed";
}

async function send(provider: MessagingProvider, row: QueueRow, signal: AbortSignal): Promise<MessagingSendResult> {
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(row.template_params ?? {})) params[k] = String(v);
  if (!params.clinic_name) params.clinic_name = "Clinic";

  if (row.channel === "in_app") {
    return { success: true, channelUsed: "whatsapp", externalMessageId: `in-app-${row.id}` };
  }
  if (!row.recipient_phone) {
    return { success: false, channelUsed: row.channel, error: "recipient_missing", code: "recipient_missing", retryable: false };
  }
  if (row.channel === "sms") return provider.sendSms(row.recipient_phone, row.template_id, params, { signal });
  const buttons = (row.metadata?.buttons as InteractiveButton[] | undefined) ?? [];
  return provider.sendWhatsApp(row.recipient_phone, row.template_id, params, buttons, { signal });
}

/** Retry at the row's own next attempt time (R-23). */
async function rowNextRetry(ctx: JobContext, queueId: string): Promise<Date | undefined> {
  const { data } = await ctx.db.from("communication_queue").select("next_retry_at").eq("id", queueId).maybeSingle();
  const at = (data as { next_retry_at?: string } | null)?.next_retry_at;
  return at ? new Date(at) : undefined;
}

/** When the row could not be claimed: what state is it in? */
async function unclaimed(ctx: JobContext, queueId: string): Promise<HandlerResult> {
  const { data, error } = await ctx.db
    .from("communication_queue")
    .select("status, next_retry_at")
    .eq("id", queueId)
    .maybeSingle();
  if (error) throw error;
  const row = data as { status: string; next_retry_at: string } | null;
  if (!row || TERMINAL.has(row.status)) return { outcome: "done" };
  if (row.status === "processing") {
    return { outcome: "retry", code: "delivery_in_progress", retryAt: new Date(ctx.now().getTime() + IN_PROGRESS_RETRY_MS) };
  }
  const due = new Date(row.next_retry_at);
  if (due.getTime() > ctx.now().getTime()) return { outcome: "retry", code: "not_due", retryAt: due };
  return { outcome: "retry", code: "claim_missed", retryAt: new Date(ctx.now().getTime() + CLAIM_MISSED_RETRY_MS) };
}

async function auditSent(ctx: JobContext, row: QueueRow, externalMessageId: string | undefined): Promise<void> {
  try {
    const { error } = await ctx.db.from("audit_logs").insert({
      tenant_id: row.tenant_id,
      actor_id: null,
      actor_role: "system",
      action: "communication_sent",
      entity_type: "communication_queue",
      entity_id: row.id,
      occurred_at: ctx.now().toISOString(),
      // No recipient phone (personal data) in the audit trail; the queue row id is entity_id.
      metadata: {
        queue_id: row.id,
        channel: row.channel,
        message_type: row.message_type,
        template_id: row.template_id,
        external_message_id: externalMessageId ?? null,
      },
    });
    if (error) throw error;
  } catch (err) {
    log.warn({ event: "messaging.dispatch_audit.failed", code: errorTag(err), tenantId: row.tenant_id });
  }
}

/** D-09: a failed WhatsApp booking/reschedule message gets one SMS fallback, even across retries. */
async function smsFallback(ctx: JobContext, row: QueueRow): Promise<void> {
  const eligible =
    row.channel === "whatsapp" &&
    (row.message_type === "appointment_booked" || row.message_type === "appointment_rescheduled") &&
    !!row.recipient_phone &&
    !!row.patient_id &&
    !row.metadata?.is_sms_fallback;
  if (!eligible) return;
  try {
    await enqueueMessageAsSystem(
      ctx.db,
      {
        patientId: row.patient_id,
        visitId: row.appointment_id,
        channel: "sms",
        messageType: row.message_type,
        templateId: `${row.message_type}_sms_fallback`,
        templateParams: row.template_params ?? {},
        recipientPhone: row.recipient_phone,
        metadata: { is_sms_fallback: true, fallback_of: row.id },
        dedupeKey: `msg-fallback:${row.id}`,
      },
      "system:jobs"
    );
  } catch (err) {
    log.warn({ event: "jobs.enqueue.failed", code: errorTag(err), tenantId: row.tenant_id });
  }
}

export function createMessageSendHandler(
  options: { provider?: () => MessagingProvider } = {}
): JobHandler<Payload> {
  const providerFor = options.provider ?? (() => getMessagingProvider());
  return {
    schema: PAYLOAD,
    // Provider calls are bounded at 10 s (MESSAGING_PROVIDER_TIMEOUT_MS) and also abort on this signal.
    maxDurationMs: 12_000,
    async run(_job, payload, ctx): Promise<HandlerResult> {
      const { data: claimed, error: claimError } = await ctx.db.rpc("communication_queue_claim", { p_id: payload.queue_id });
      if (claimError) throw claimError;
      const row = firstRow<QueueRow>(claimed);
      if (!row) return unclaimed(ctx, payload.queue_id);

      let result: MessagingSendResult;
      try {
        result = await send(providerFor(), row, ctx.signal);
      } catch (err) {
        result = { success: false, channelUsed: "whatsapp", code: `send_threw:${errorTag(err)}`.slice(0, 64), retryable: true };
      }

      if (!result.success && result.retryable === false) {
        const code = failureCode(result);
        const { error } = await ctx.db.rpc("communication_queue_dead_letter", { p_id: row.id, p_error_code: code });
        if (error) throw error;
        return { outcome: "dead", code };
      }

      const code = result.success ? null : failureCode(result);
      const { data: finished, error: finishError } = await ctx.db.rpc("communication_queue_finish", {
        p_id: row.id,
        p_success: result.success,
        // Both are nullable in SQL (the generated types say string): NULL keeps the column unset.
        p_external_message_id: result.externalMessageId ?? (null as unknown as string),
        p_error: code ?? (null as unknown as string),
      });
      if (finishError) throw finishError;
      const status = firstRow<{ new_status: string }>(finished)?.new_status;
      // The row left `processing` under us (the reaper reclaimed it): keep the job so the row is not orphaned.
      if (!status) return { outcome: "retry", code: "finish_lost", retryAt: new Date(ctx.now().getTime() + CLAIM_MISSED_RETRY_MS) };

      if (status === "sent") {
        await auditSent(ctx, row, result.externalMessageId);
        return { outcome: "done" };
      }
      if (status === "dead_letter") return { outcome: "dead", code: code ?? "provider_failed" };

      await smsFallback(ctx, row);
      return { outcome: "retry", code: code ?? "provider_failed", retryAt: await rowNextRetry(ctx, row.id) };
    },
  };
}

export const MESSAGE_SEND_HANDLERS = {
  [MESSAGE_SEND_KIND]: createMessageSendHandler() as JobHandler<unknown>,
};
