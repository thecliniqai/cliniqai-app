import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CommunicationChannel,
  CommunicationQueueItem,
  CommunicationStatus,
} from "@/lib/db/types";
import { getMessagingProvider } from "./index";
import { InteractiveButton, MessagingProvider } from "./types";
import { errorTag, log } from "@/lib/log";
import { clientErrorMessage } from "@/lib/errors/client-message";

export interface EnqueueMessageInput {
  tenantId: string;
  patientId?: string | null;
  appointmentId?: string | null;
  channel: CommunicationChannel;
  messageType: string;
  templateId: string;
  templateParams?: Record<string, unknown>;
  recipientPhone?: string | null;
  recipientUserId?: string | null;
  delayUntil?: Date | string | null;
  maxRetries?: number;
  metadata?: Record<string, unknown>;
}

export interface DispatchSummary {
  processed: number;
  succeeded: number;
  failed: number;
}

/** What an enqueue returns: the row id and status only. Members cannot read message payload columns (AR3-N1, 000024). */
export type EnqueuedMessage = Pick<CommunicationQueueItem, "id" | "status">;

/** Outcome of one dispatch attempt; "skipped" when the row could not be claimed (not due, not yours, or taken). */
export type DispatchOutcome = "sent" | "failed" | "dead_letter" | "skipped";

/**
 * The database client every outbox function runs on. It is a required argument (ADR-0005 register, V2-01 R13):
 * request-path callers pass their own user-JWT client (`ctx.db`), so RLS applies; only the register entry points
 * (`app/api/cron/**`, `/api/v1/**`, `app/api/webhooks/**`) build a service-role client and pass it in. There is no
 * default and no fallback.
 *
 * AR3-N1 (000024): members may INSERT queue rows and read their status columns only. Sending goes through
 * `communication_queue_claim` / `communication_queue_finish`: a member can claim only a row it enqueued itself (the
 * payload it just built); the service role can claim any due row. Link-bearing payload values are redacted by the
 * database once a row reaches a final status.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type MessagingDb = SupabaseClient<any, any, any>;

/**
 * Calculates exponential retry backoff in milliseconds:
 * 1st failure (retry 0 -> 1): 1 minute
 * 2nd failure (retry 1 -> 2): 5 minutes
 * 3rd failure (retry 2 -> 3): 15 minutes
 * (communication_queue_finish applies the same schedule in the database.)
 */
export function calculateBackoffDelay(retryCount: number): number {
  if (retryCount <= 1) return 1 * 60 * 1000;
  if (retryCount === 2) return 5 * 60 * 1000;
  return 15 * 60 * 1000;
}

/**
 * Inserts a transactional message into the communication_queue outbox, then tries to send that one row at once
 * (best effort; the cron dispatcher retries what is left).
 */
export async function enqueueMessage(
  db: MessagingDb,
  input: EnqueueMessageInput
): Promise<EnqueuedMessage> {
  const nextRetryAt = input.delayUntil
    ? typeof input.delayUntil === "string"
      ? input.delayUntil
      : input.delayUntil.toISOString()
    : new Date().toISOString();

  // Exactly the columns members may insert (000024); status, retry_count and created_by take their defaults.
  const insertData = {
    tenant_id: input.tenantId,
    patient_id: input.patientId || null,
    appointment_id: input.appointmentId || null,
    channel: input.channel,
    message_type: input.messageType,
    template_id: input.templateId,
    template_params: input.templateParams || {},
    recipient_phone: input.recipientPhone || null,
    recipient_user_id: input.recipientUserId || null,
    max_retries: input.maxRetries ?? 3,
    next_retry_at: nextRetryAt,
    metadata: input.metadata || {},
  };

  const { data, error } = await db
    .from("communication_queue")
    .insert(insertData)
    .select("id, status")
    .single();

  if (error || !data) {
    throw new Error("Failed to enqueue communication.", { cause: error });
  }

  const enqueued = data as EnqueuedMessage;

  // Opportunistic immediate dispatch of this row only, so messages fire without waiting for the background cron.
  if (!input.delayUntil) {
    try {
      await dispatchQueuedMessage(db, enqueued.id);
    } catch {
      // Best effort; the background cron recovers queued items.
    }
  }

  return enqueued;
}

type ClaimedItem = CommunicationQueueItem;
type SendResult = { success: boolean; externalMessageId?: string; error?: string; retryable?: boolean };

function firstRow<T>(data: unknown): T | null {
  if (Array.isArray(data)) return (data[0] as T) ?? null;
  return (data as T) ?? null;
}

async function sendClaimedItem(provider: MessagingProvider, item: ClaimedItem): Promise<SendResult> {
  const stringParams: Record<string, string> = {};
  if (item.template_params) {
    for (const [k, v] of Object.entries(item.template_params)) {
      stringParams[k] = String(v);
    }
  }
  if (!stringParams.clinic_name) {
    stringParams.clinic_name = "Clinic";
  }

  if (item.channel === "sms" && item.recipient_phone) {
    return provider.sendSms(item.recipient_phone, item.template_id, stringParams);
  }
  if (item.channel === "whatsapp" && item.recipient_phone) {
    const buttons = (item.metadata?.buttons as InteractiveButton[]) || [];
    return provider.sendWhatsApp(item.recipient_phone, item.template_id, stringParams, buttons);
  }
  if (item.channel === "in_app") {
    // In-app notifications do not go to SMS/WhatsApp providers
    return { success: true, externalMessageId: `in-app-${item.id}` };
  }
  return { success: false, error: "Missing recipient_phone for external messaging" };
}

/**
 * Claims one queue row (atomically, through communication_queue_claim), sends it and records the outcome through
 * communication_queue_finish. A member's client can dispatch only rows it enqueued; the service role any due row.
 */
export async function dispatchQueuedMessage(
  db: MessagingDb,
  queueId: string,
  options?: { providerName?: string; provider?: MessagingProvider }
): Promise<DispatchOutcome> {
  const { data: claimed, error: claimError } = await db.rpc("communication_queue_claim", { p_id: queueId });
  const item = claimError ? null : firstRow<ClaimedItem>(claimed);
  if (!item) return "skipped";

  const provider = options?.provider ?? getMessagingProvider(options?.providerName);

  let sendResult: SendResult;
  try {
    sendResult = await sendClaimedItem(provider, item);
  } catch (err: unknown) {
    sendResult = {
      success: false,
      error: clientErrorMessage(err, "Unexpected dispatcher error", "messaging.dispatch_queued_message.failed"),
    };
  }

  const { data: finished } = await db.rpc("communication_queue_finish", {
    p_id: item.id,
    p_success: sendResult.success,
    p_external_message_id: sendResult.externalMessageId ?? null,
    p_error: sendResult.success ? null : sendResult.error || "Delivery failed",
  });
  const finishRow = firstRow<{ new_status: CommunicationStatus }>(finished);
  const outcome: DispatchOutcome =
    finishRow?.new_status === "sent" || finishRow?.new_status === "dead_letter" || finishRow?.new_status === "failed"
      ? finishRow.new_status
      : sendResult.success
        ? "sent"
        : "failed";

  if (outcome === "sent") {
    try {
      await db.from("audit_logs").insert({
        tenant_id: item.tenant_id,
        actor_id: null,
        actor_role: "system",
        action: "communication_sent",
        entity_type: "communication_queue",
        entity_id: item.id,
        occurred_at: new Date().toISOString(),
        // No recipient phone (personal data) in the audit trail; the queue row id is entity_id.
        metadata: {
          queue_id: item.id,
          channel: item.channel,
          message_type: item.message_type,
          template_id: item.template_id,
          external_message_id: sendResult.externalMessageId,
        },
      });
    } catch (auditErr) {
      log.warn({ event: "messaging.dispatch_audit.failed", code: errorTag(auditErr), tenantId: item.tenant_id });
    }
    return outcome;
  }

  if (outcome === "dead_letter") {
    // Event #23 In-App Outbox Failure Alert
    try {
      await db.from("in_app_notifications").insert({
        tenant_id: item.tenant_id,
        recipient_role: "admin",
        category: "system",
        event_type: "delivery_failure_alert",
        title: "Message Delivery Failed",
        // No recipient phone (personal data) in the alert; the queue row id and message type identify the message.
        message: `A ${item.channel} message (${item.message_type}) failed permanently: ${sendResult.error || "Unknown error"}`,
        is_read: false,
        metadata: { queue_id: item.id, channel: item.channel, message_type: item.message_type },
      });
    } catch {
      // Ignore in-app notification insert errors
    }
    return outcome;
  }

  // Failed with a retry scheduled. Conditional SMS Fallback: only appointment_booked and appointment_rescheduled (D-09)
  const isEligibleForSmsFallback =
    item.channel === "whatsapp" &&
    (item.message_type === "appointment_booked" || item.message_type === "appointment_rescheduled") &&
    item.recipient_phone;

  // A non-retryable refusal (the `disabled` provider, R-16) would refuse the SMS too: no fallback row is queued.
  if (isEligibleForSmsFallback && !item.metadata?.is_sms_fallback && sendResult.retryable !== false) {
    await enqueueMessage(db, {
      tenantId: item.tenant_id,
      patientId: item.patient_id,
      appointmentId: item.appointment_id,
      channel: "sms",
      messageType: item.message_type,
      templateId: `${item.message_type}_sms_fallback`,
      templateParams: item.template_params,
      recipientPhone: item.recipient_phone,
      metadata: { ...item.metadata, is_sms_fallback: true },
    });
  }

  return outcome;
}

/**
 * Scans the outbox queue for pending/failed due items and dispatches each through dispatchQueuedMessage (claim, send,
 * finish). Runs on the system path (the cron route's service-role client): members cannot list other rows.
 */
export async function dispatchPendingQueue(
  db: MessagingDb,
  options?: {
    limit?: number;
    providerName?: string;
  }
): Promise<DispatchSummary> {
  const limit = options?.limit ?? 20;
  const provider = getMessagingProvider(options?.providerName);
  const nowIso = new Date().toISOString();

  const { data: items, error: fetchError } = await db
    .from("communication_queue")
    .select("id")
    .in("status", ["pending", "failed"])
    .lte("next_retry_at", nowIso)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (fetchError || !items || items.length === 0) {
    return { processed: 0, succeeded: 0, failed: 0 };
  }

  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  for (const row of items as Array<{ id: string }>) {
    const outcome = await dispatchQueuedMessage(db, row.id, { provider });
    if (outcome === "skipped") continue;
    processed++;
    if (outcome === "sent") succeeded++;
    else failed++;
  }

  return { processed, succeeded, failed };
}
