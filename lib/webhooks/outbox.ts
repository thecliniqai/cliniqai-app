import crypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { WebhookDeliveryItem } from "@/lib/db/types";

export interface EnqueueWebhookOptions {
  subscriptionId?: string;
}

/**
 * The database client every webhook outbox function runs on. Required, never defaulted (ADR-0005 register, V2-01
 * R13): request-path callers pass `ctx.db` (RLS applies), register entry points (`app/api/cron/**`, `/api/v1/**`)
 * pass the service-role client they build themselves.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WebhookDb = SupabaseClient<any, any, any>;

/**
 * Inserts an event payload into the public.webhook_delivery_queue outbox
 * for every active webhook subscription subscribed to `eventType`.
 *
 * Saves the payload as exact raw TEXT so that HMAC signatures remain
 * completely identical across retry attempts without JSONB key-reordering.
 *
 * Opportunistically triggers non-blocking delivery attempts without
 * ever blocking or throwing to the caller.
 */
export async function enqueueWebhookEvent(
  db: WebhookDb,
  tenantId: string,
  eventType: string,
  payload: Record<string, unknown>,
  options?: EnqueueWebhookOptions
): Promise<WebhookDeliveryItem[]> {
  try {
    const targetSubscriptionId = options?.subscriptionId;
    const supabase = db;

    // 1. Query active subscriptions
    let query = supabase
      .from("webhook_subscriptions")
      .select("id, endpoint_url, event_types, is_active")
      .eq("tenant_id", tenantId)
      .eq("is_active", true);

    if (targetSubscriptionId) {
      query = query.eq("id", targetSubscriptionId);
    } else {
      // Postgres array contains operator (@>)
      query = query.contains("event_types", [eventType]);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: subscriptions, error: subError } = await (query as any);

    if (subError) {
      console.error("[enqueueWebhookEvent] Error querying subscriptions:", subError);
      return [];
    }

    if (!subscriptions || subscriptions.length === 0) {
      return [];
    }

    // 2. Format standard envelope and serialize to exact raw TEXT
    const eventEnvelope = {
      id: crypto.randomUUID(),
      event: eventType,
      created_at: new Date().toISOString(),
      data: payload,
    };
    const rawPayload = JSON.stringify(eventEnvelope);

    const nowIso = new Date().toISOString();
    const queueRows = subscriptions.map((sub: { id: string }) => ({
      tenant_id: tenantId,
      subscription_id: sub.id,
      event_type: eventType,
      payload: rawPayload,
      status: "pending",
      retry_count: 0,
      max_retries: 5,
      next_retry_at: nowIso,
    }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: inserted, error: insertError } = await (supabase
      .from("webhook_delivery_queue") as any)
      .insert(queueRows)
      .select();

    if (insertError || !inserted) {
      console.error("[enqueueWebhookEvent] Error inserting into webhook_delivery_queue:", insertError);
      return [];
    }

    const createdItems = inserted as WebhookDeliveryItem[];

    // 3. Opportunistic non-blocking dispatch attempt
    try {
      import("./dispatcher")
        .then(({ dispatchWebhookQueueItem }) => {
          for (const item of createdItems) {
            dispatchWebhookQueueItem(db, item.id).catch((err) => {
              console.warn(`[enqueueWebhookEvent] Background dispatch error for ${item.id}:`, err);
            });
          }
        })
        .catch(() => {
          // Dispatcher might still be loading or unexported
        });
    } catch {
      // Never throw from background trigger
    }

    return createdItems;
  } catch (err) {
    console.error("[enqueueWebhookEvent] Unexpected exception:", err);
    return [];
  }
}
