import { createClient as createAdminClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import {
  CommunicationChannel,
  CommunicationQueueItem,
  CommunicationStatus,
} from "@/lib/db/types";
import { getMessagingProvider } from "./index";
import { InteractiveButton } from "./types";

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

export async function getDbClient(clientOverride?: unknown) {
  if (clientOverride) {
    return clientOverride as any;
  }
  if (env.SUPABASE_SERVICE_ROLE_KEY) {
    return createAdminClient(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false } }
    );
  }
  return await createClient();
}

/**
 * Calculates exponential retry backoff in milliseconds:
 * 1st failure (retry 0 -> 1): 1 minute
 * 2nd failure (retry 1 -> 2): 5 minutes
 * 3rd failure (retry 2 -> 3): 15 minutes
 */
export function calculateBackoffDelay(retryCount: number): number {
  if (retryCount <= 1) return 1 * 60 * 1000;
  if (retryCount === 2) return 5 * 60 * 1000;
  return 15 * 60 * 1000;
}

/**
 * Inserts a transactional message into the communication_queue outbox.
 */
export async function enqueueMessage(
  input: EnqueueMessageInput,
  clientOverride?: unknown
): Promise<CommunicationQueueItem> {
  const supabase = await getDbClient(clientOverride);

  const nextRetryAt = input.delayUntil
    ? typeof input.delayUntil === "string"
      ? input.delayUntil
      : input.delayUntil.toISOString()
    : new Date().toISOString();

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
    status: "pending" as CommunicationStatus,
    retry_count: 0,
    max_retries: input.maxRetries ?? 3,
    next_retry_at: nextRetryAt,
    metadata: input.metadata || {},
  };

  const { data, error } = await supabase
    .from("communication_queue")
    .insert(insertData)
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Failed to enqueue communication: ${error?.message || "Unknown error"}`);
  }

  return data as CommunicationQueueItem;
}

/**
 * Scans the outbox queue for pending/failed due items, attempts delivery via active provider,
 * and updates retry counts, backoff times, and audit logs.
 */
export async function dispatchPendingQueue(options?: {
  limit?: number;
  providerName?: string;
  clientOverride?: unknown;
}): Promise<DispatchSummary> {
  const limit = options?.limit ?? 20;
  const provider = getMessagingProvider(options?.providerName);
  const supabase = await getDbClient(options?.clientOverride);
  const nowIso = new Date().toISOString();

  // 1. Fetch pending rows or failed rows due for retry
  const { data: items, error: fetchError } = await supabase
    .from("communication_queue")
    .select("*")
    .in("status", ["pending", "failed"])
    .lte("next_retry_at", nowIso)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (fetchError || !items || items.length === 0) {
    return { processed: 0, succeeded: 0, failed: 0 };
  }

  let succeeded = 0;
  let failed = 0;

  for (const item of items as CommunicationQueueItem[]) {
    // 2. Mark item as processing
    await supabase
      .from("communication_queue")
      .update({ status: "processing", updated_at: new Date().toISOString() })
      .eq("id", item.id);

    try {
      const stringParams: Record<string, string> = {};
      if (item.template_params) {
        for (const [k, v] of Object.entries(item.template_params)) {
          stringParams[k] = String(v);
        }
      }

      let sendResult: { success: boolean; externalMessageId?: string; error?: string } = {
        success: false,
      };

      if (item.channel === "sms" && item.recipient_phone) {
        sendResult = await provider.sendSms(
          item.recipient_phone,
          item.template_id,
          stringParams
        );
      } else if (item.channel === "whatsapp" && item.recipient_phone) {
        const buttons = (item.metadata?.buttons as InteractiveButton[]) || [];
        sendResult = await provider.sendWhatsApp(
          item.recipient_phone,
          item.template_id,
          stringParams,
          buttons
        );
      } else if (item.channel === "in_app") {
        // In-app notifications do not go to SMS/WhatsApp providers
        sendResult = { success: true, externalMessageId: `in-app-${item.id}`, error: undefined };
      } else {
        sendResult = {
          success: false,
          externalMessageId: undefined,
          error: "Missing recipient_phone for external messaging",
        };
      }

      if (sendResult.success) {
        succeeded++;
        const sentAt = new Date().toISOString();

        // Update queue item to sent
        await supabase
          .from("communication_queue")
          .update({
            status: "sent",
            sent_at: sentAt,
            external_message_id: sendResult.externalMessageId || null,
            updated_at: sentAt,
          })
          .eq("id", item.id);

        // Record audit log
        try {
          await supabase.from("audit_logs").insert({
            tenant_id: item.tenant_id,
            actor_id: null,
            actor_role: "system",
            action: "communication_sent",
            entity_type: "communication_queue",
            entity_id: item.id,
            occurred_at: sentAt,
            metadata: {
              channel: item.channel,
              template_id: item.template_id,
              recipient_phone: item.recipient_phone,
              external_message_id: sendResult.externalMessageId,
            },
          });
        } catch (auditErr) {
          console.warn("[dispatchPendingQueue] Failed to record audit log:", auditErr);
        }
      } else {
        failed++;
        const nextRetryCount = (item.retry_count || 0) + 1;
        const maxRetries = item.max_retries || 3;

        if (nextRetryCount >= maxRetries) {
          // Dead letter status
          await supabase
            .from("communication_queue")
            .update({
              status: "dead_letter",
              retry_count: nextRetryCount,
              error_message: sendResult.error || "Max retries exceeded",
              updated_at: new Date().toISOString(),
            })
            .eq("id", item.id);

          // Event #23 In-App Outbox Failure Alert
          try {
            await supabase.from("in_app_notifications").insert({
              tenant_id: item.tenant_id,
              recipient_role: "admin",
              category: "system",
              event_type: "delivery_failure_alert",
              title: "Message Delivery Failed",
              message: `Outbox message to ${item.recipient_phone || "recipient"} failed permanently: ${sendResult.error || "Unknown error"}`,
              is_read: false,
              metadata: { queue_id: item.id, channel: item.channel },
            });
          } catch {
            // Ignore in-app notification insert errors
          }
        } else {
          // Failed with exponential backoff retry
          const backoffDelay = calculateBackoffDelay(nextRetryCount);
          const nextRetryAt = new Date(Date.now() + backoffDelay).toISOString();

          await supabase
            .from("communication_queue")
            .update({
              status: "failed",
              retry_count: nextRetryCount,
              next_retry_at: nextRetryAt,
              error_message: sendResult.error || "Delivery failed",
              updated_at: new Date().toISOString(),
            })
            .eq("id", item.id);

          // Conditional SMS Fallback: only appointment_booked and appointment_rescheduled (D-09)
          const isEligibleForSmsFallback =
            item.channel === "whatsapp" &&
            (item.message_type === "appointment_booked" ||
              item.message_type === "appointment_rescheduled") &&
            item.recipient_phone;

          if (isEligibleForSmsFallback && !item.metadata?.is_sms_fallback) {
            await enqueueMessage(
              {
                tenantId: item.tenant_id,
                patientId: item.patient_id,
                appointmentId: item.appointment_id,
                channel: "sms",
                messageType: item.message_type,
                templateId: `${item.message_type}_sms_fallback`,
                templateParams: item.template_params,
                recipientPhone: item.recipient_phone,
                metadata: { ...item.metadata, is_sms_fallback: true },
              },
              supabase
            );
          }
        }
      }
    } catch (err: unknown) {
      failed++;
      const errorMessage = err instanceof Error ? err.message : "Unexpected dispatcher error";
      await supabase
        .from("communication_queue")
        .update({
          status: "failed",
          retry_count: (item.retry_count || 0) + 1,
          next_retry_at: new Date(Date.now() + 60000).toISOString(),
          error_message: errorMessage,
          updated_at: new Date().toISOString(),
        })
        .eq("id", item.id);
    }
  }

  return {
    processed: items.length,
    succeeded,
    failed,
  };
}
