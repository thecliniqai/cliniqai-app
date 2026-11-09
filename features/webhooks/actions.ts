"use server";

import crypto from "crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/permissions/guards";
import { recordAudit } from "@/lib/audit/audit";
import { validateWebhookEndpoint } from "@/lib/webhooks/ssrf";
import { enqueueWebhookEvent } from "@/lib/webhooks/outbox";
import { dispatchWebhookQueueItem } from "@/lib/webhooks/dispatcher";

export interface WebhookSubscriptionItem {
  id: string;
  endpointUrl: string;
  eventTypes: string[];
  signingSecret: string;
  isActive: boolean;
  createdAt: string;
}

export interface WebhookDeliveryLogItem {
  id: string;
  subscriptionId: string;
  eventType: string;
  payload: string;
  status: "pending" | "delivered" | "failed" | "dead_letter";
  retryCount: number;
  maxRetries: number;
  responseStatus: number | null;
  durationMs: number | null;
  deliveredAt: string | null;
  createdAt: string;
}

export const ALLOWED_WEBHOOK_EVENTS = [
  "appointment.booked",
  "appointment.cancelled",
  "appointment.rescheduled",
  "visit.completed",
  "lab_result.ready",
  "prescription.issued",
] as const;

/**
 * Lists all active and inactive webhook subscriptions for the clinic tenant.
 * Enforces clinic:manage permission.
 */
export async function listWebhookSubscriptions(clientOverride?: unknown): Promise<{
  success: boolean;
  subscriptions: WebhookSubscriptionItem[];
  error?: string;
}> {
  try {
    const session = await requirePermission("clinic:manage");
    const supabase = (clientOverride as any) || (await createClient());

    const { data: rows, error: fetchErr } = await (supabase
      .from("webhook_subscriptions") as any)
      .select("id, endpoint_url, event_types, signing_secret, is_active, created_at")
      .eq("tenant_id", session.tenantId)
      .order("created_at", { ascending: false });

    if (fetchErr) {
      console.error("[listWebhookSubscriptions] Query error:", fetchErr);
      return { success: false, subscriptions: [], error: "Failed to load webhook subscriptions." };
    }

    const items: WebhookSubscriptionItem[] = (rows || []).map((r: any) => ({
      id: r.id,
      endpointUrl: r.endpoint_url,
      eventTypes: r.event_types || [],
      signingSecret: r.signing_secret,
      isActive: r.is_active,
      createdAt: r.created_at,
    }));

    return { success: true, subscriptions: items };
  } catch (err: unknown) {
    console.error("[listWebhookSubscriptions] Exception:", err);
    return {
      success: false,
      subscriptions: [],
      error: err instanceof Error ? err.message : "Access denied.",
    };
  }
}

/**
 * Registers a new HTTPS webhook subscription.
 * Performs SSRF validation and generates a cryptographic signing secret (whsec_...).
 */
export async function createWebhookSubscription(
  data: {
    endpointUrl: string;
    eventTypes: string[];
  },
  clientOverride?: unknown
): Promise<{ success: boolean; subscription?: WebhookSubscriptionItem; error?: string }> {
  try {
    const session = await requirePermission("clinic:manage");
    const supabase = (clientOverride as any) || (await createClient());

    const cleanUrl = (data.endpointUrl || "").trim();
    if (!cleanUrl) {
      return { success: false, error: "Endpoint URL is required." };
    }

    // SSRF Validation (must be HTTPS and not resolve to private/loopback/cloud metadata)
    const ssrfCheck = await validateWebhookEndpoint(cleanUrl);
    if (!ssrfCheck.valid) {
      return { success: false, error: ssrfCheck.error || "Invalid endpoint URL." };
    }

    if (!Array.isArray(data.eventTypes) || data.eventTypes.length === 0) {
      return { success: false, error: "Please select at least one webhook event to subscribe." };
    }

    // Generate signing secret
    const secret = "whsec_" + crypto.randomBytes(24).toString("hex");

    const { data: created, error: insertErr } = await (supabase
      .from("webhook_subscriptions") as any)
      .insert({
        tenant_id: session.tenantId,
        endpoint_url: cleanUrl,
        event_types: data.eventTypes,
        signing_secret: secret,
        is_active: true,
        created_by: session.userId,
      })
      .select("id, endpoint_url, event_types, signing_secret, is_active, created_at")
      .single();

    if (insertErr || !created) {
      console.error("[createWebhookSubscription] Insert error:", insertErr);
      return { success: false, error: "Failed to save webhook subscription." };
    }

    // Audit trail (D-08, AGENTS.md §10)
    try {
      await recordAudit(
        {
          action: "webhook.create",
          entityType: "webhook",
          entityId: created.id,
          metadata: {
            reason: `Webhook subscription registered for ${cleanUrl}`,
          },
        },
        clientOverride as any,
        session
      );
    } catch (auditErr) {
      console.warn("[createWebhookSubscription] Audit warning:", auditErr);
    }

    try {
      revalidatePath("/settings/developer");
    } catch {
      // Non-web contexts
    }

    return {
      success: true,
      subscription: {
        id: created.id,
        endpointUrl: created.endpoint_url,
        eventTypes: created.event_types,
        signingSecret: created.signing_secret,
        isActive: created.is_active,
        createdAt: created.created_at,
      },
    };
  } catch (err: unknown) {
    console.error("[createWebhookSubscription] Exception:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unable to register webhook endpoint.",
    };
  }
}

/**
 * Deletes a webhook subscription and records audit trail.
 */
export async function deleteWebhookSubscription(
  subscriptionId: string,
  clientOverride?: unknown
): Promise<{ success: boolean; error?: string }> {
  try {
    const session = await requirePermission("clinic:manage");
    const supabase = (clientOverride as any) || (await createClient());

    const { error: deleteErr } = await (supabase
      .from("webhook_subscriptions") as any)
      .delete()
      .eq("id", subscriptionId)
      .eq("tenant_id", session.tenantId);

    if (deleteErr) {
      console.error("[deleteWebhookSubscription] Delete error:", deleteErr);
      return { success: false, error: "Failed to delete webhook subscription." };
    }

    try {
      await recordAudit(
        {
          action: "webhook.delete",
          entityType: "webhook",
          entityId: subscriptionId,
          metadata: {
            reason: "Webhook endpoint deleted by clinic administrator",
          },
        },
        clientOverride as any,
        session
      );
    } catch (auditErr) {
      console.warn("[deleteWebhookSubscription] Audit warning:", auditErr);
    }

    try {
      revalidatePath("/settings/developer");
    } catch {
      // Non-web contexts
    }

    return { success: true };
  } catch (err: unknown) {
    console.error("[deleteWebhookSubscription] Exception:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unable to delete webhook endpoint.",
    };
  }
}

/**
 * Sends an immediate synthetic test ping to an active webhook endpoint and returns result.
 */
export async function testPingWebhook(
  subscriptionId: string,
  clientOverride?: unknown
): Promise<{
  success: boolean;
  responseStatus?: number | null;
  durationMs?: number;
  error?: string;
}> {
  try {
    const session = await requirePermission("clinic:manage");
    const supabase = (clientOverride as any) || (await createClient());

    // Verify subscription ownership
    const { data: sub, error: subErr } = await (supabase
      .from("webhook_subscriptions") as any)
      .select("id, endpoint_url")
      .eq("id", subscriptionId)
      .eq("tenant_id", session.tenantId)
      .single();

    if (subErr || !sub) {
      return { success: false, error: "Webhook subscription not found." };
    }

    // Enqueue ping item targeting this subscription
    const enqueued = await enqueueWebhookEvent(
      session.tenantId,
      "ping",
      {
        type: "test_ping",
        message: "Webhook verification ping from ClinicQ Developer Settings",
        timestamp: new Date().toISOString(),
      },
      {
        subscriptionId,
        clientOverride: supabase,
      }
    );

    if (!enqueued || enqueued.length === 0) {
      return { success: false, error: "Failed to queue test ping event." };
    }

    // Immediately dispatch
    const result = await dispatchWebhookQueueItem(enqueued[0].id, supabase);

    return {
      success: result.success,
      responseStatus: result.responseStatus,
      durationMs: result.durationMs,
      error: result.error,
    };
  } catch (err: unknown) {
    console.error("[testPingWebhook] Exception:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Test ping failed.",
    };
  }
}

/**
 * Retrieves the latest 50 delivery queue logs for a specific webhook subscription.
 */
export async function listDeliveryLogs(
  subscriptionId: string,
  clientOverride?: unknown
): Promise<{
  success: boolean;
  logs: WebhookDeliveryLogItem[];
  error?: string;
}> {
  try {
    const session = await requirePermission("clinic:manage");
    const supabase = (clientOverride as any) || (await createClient());

    const { data: logs, error: fetchErr } = await (supabase
      .from("webhook_delivery_queue") as any)
      .select("*")
      .eq("subscription_id", subscriptionId)
      .eq("tenant_id", session.tenantId)
      .order("created_at", { ascending: false })
      .limit(50);

    if (fetchErr) {
      console.error("[listDeliveryLogs] Query error:", fetchErr);
      return { success: false, logs: [], error: "Failed to load delivery logs." };
    }

    const items: WebhookDeliveryLogItem[] = (logs || []).map((l: any) => ({
      id: l.id,
      subscriptionId: l.subscription_id,
      eventType: l.event_type,
      payload: l.payload,
      status: l.status,
      retryCount: l.retry_count || 0,
      maxRetries: l.max_retries || 5,
      responseStatus: l.response_status,
      durationMs: l.duration_ms,
      deliveredAt: l.delivered_at,
      createdAt: l.created_at,
    }));

    return { success: true, logs: items };
  } catch (err: unknown) {
    console.error("[listDeliveryLogs] Exception:", err);
    return {
      success: false,
      logs: [],
      error: err instanceof Error ? err.message : "Access denied.",
    };
  }
}
