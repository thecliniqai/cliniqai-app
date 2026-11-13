import "server-only";

import crypto from "crypto";
import { assertPerm } from "@/lib/permissions";
import type { ServiceContext } from "@/lib/auth/context";
import { recordAudit } from "@/lib/audit/audit";
import { validateWebhookEndpoint } from "@/lib/webhooks/ssrf";
import { enqueueWebhookEvent } from "@/lib/webhooks/outbox";
import { dispatchWebhookQueueItem } from "@/lib/webhooks/dispatcher";

import type {
  WebhookSubscriptionItem,
  WebhookDeliveryLogItem,
  AllowedWebhookEvent,
} from "./constants";
import { errorTag, log } from "@/lib/log";
import { DEFAULT_APP_ERROR_MESSAGES } from "@/lib/errors/app-error";
import { getRequestId } from "@/lib/log/request-id";
import { clientErrorMessage } from "@/lib/errors/client-message";

export type {
  WebhookSubscriptionItem,
  WebhookDeliveryLogItem,
  AllowedWebhookEvent,
};

// Webhook subscription use-cases (clinic:manage, as before). Tenant and creator come only from `ctx` (ADR-0005 D1).

/** Test pings per tenant per {@link TEST_PING_WINDOW_MS} (03-13d; review E-8). */
export const TEST_PING_LIMIT = 5;
export const TEST_PING_WINDOW_MS = 60_000;

/**
 * Lists all active and inactive webhook subscriptions for the clinic tenant.
 * Enforces clinic:manage permission.
 */
export async function listWebhookSubscriptions(ctx: ServiceContext): Promise<{
  success: boolean;
  subscriptions: WebhookSubscriptionItem[];
  error?: string;
}> {
  try {
    assertPerm(ctx.role, "clinic:manage");
    const session = ctx;
    const supabase = ctx.db;

    const { data: rows, error: fetchErr } = await (
      supabase.from("webhook_subscriptions") as any
    )
      .select(
        "id, endpoint_url, event_types, signing_secret, is_active, created_at"
      )
      .eq("tenant_id", session.tenantId)
      .order("created_at", { ascending: false });

    if (fetchErr) {
      log.error({ event: "webhooks.subscriptions_list_query.failed", code: errorTag(fetchErr), requestId: await getRequestId(), tenantId: ctx.tenantId });
      return {
        success: false,
        subscriptions: [],
        error: "Failed to load webhook subscriptions.",
      };
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
    log.error({ event: "webhooks.subscriptions_list.failed", code: errorTag(err), requestId: await getRequestId(), tenantId: ctx.tenantId });
    return {
      success: false,
      subscriptions: [],
      error: clientErrorMessage(err, "Access denied."),
    };
  }
}

/**
 * Registers a new HTTPS webhook subscription.
 * Performs SSRF validation and generates a cryptographic signing secret (whsec_...).
 */
export async function createWebhookSubscription(
  ctx: ServiceContext,
  data: {
    endpointUrl: string;
    eventTypes: string[];
  }
): Promise<{
  success: boolean;
  subscription?: WebhookSubscriptionItem;
  error?: string;
}> {
  try {
    assertPerm(ctx.role, "clinic:manage");
    const session = ctx;
    const supabase = ctx.db;

    const cleanUrl = (data.endpointUrl || "").trim();
    if (!cleanUrl) {
      return { success: false, error: "Endpoint URL is required." };
    }

    // SSRF Validation (must be HTTPS and not resolve to private/loopback/cloud metadata)
    const ssrfCheck = await validateWebhookEndpoint(cleanUrl);
    if (!ssrfCheck.valid) {
      return {
        success: false,
        error: ssrfCheck.error || "Invalid endpoint URL.",
      };
    }

    if (!Array.isArray(data.eventTypes) || data.eventTypes.length === 0) {
      return {
        success: false,
        error: "Please select at least one webhook event to subscribe.",
      };
    }

    // Generate signing secret
    const secret = "whsec_" + crypto.randomBytes(24).toString("hex");

    const { data: created, error: insertErr } = await (
      supabase.from("webhook_subscriptions") as any
    )
      .insert({
        tenant_id: session.tenantId,
        endpoint_url: cleanUrl,
        event_types: data.eventTypes,
        signing_secret: secret,
        is_active: true,
        created_by: session.userId,
      })
      .select(
        "id, endpoint_url, event_types, signing_secret, is_active, created_at"
      )
      .single();

    if (insertErr || !created) {
      log.error({ event: "webhooks.subscription_insert.failed", code: errorTag(insertErr), requestId: await getRequestId(), tenantId: ctx.tenantId });
      return { success: false, error: "Failed to save webhook subscription." };
    }

    // Audit trail (D-08, AGENTS.md §10)
    try {
      await recordAudit(ctx, {
        action: "webhook.create",
        entityType: "webhook",
        entityId: created.id,
        metadata: {
          // Origin only (03-13d; review E-7): a receiver's path or query often carries its own token.
          reason: `Webhook subscription registered for ${new URL(cleanUrl).origin}`,
        },
      });
    } catch (auditErr) {
      log.warn({ event: "webhooks.subscription_create_audit.failed", code: errorTag(auditErr), requestId: await getRequestId(), tenantId: ctx.tenantId });
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
    log.error({ event: "webhooks.subscription_create.failed", code: errorTag(err), requestId: await getRequestId(), tenantId: ctx.tenantId });
    return {
      success: false,
      error:
        clientErrorMessage(err, "Unable to register webhook endpoint."),
    };
  }
}

/**
 * Deletes a webhook subscription and records audit trail.
 */
export async function deleteWebhookSubscription(
  ctx: ServiceContext,
  subscriptionId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    assertPerm(ctx.role, "clinic:manage");
    const session = ctx;
    const supabase = ctx.db;

    const { error: deleteErr } = await (
      supabase.from("webhook_subscriptions") as any
    )
      .delete()
      .eq("id", subscriptionId)
      .eq("tenant_id", session.tenantId);

    if (deleteErr) {
      log.error({ event: "webhooks.subscription_delete_query.failed", code: errorTag(deleteErr), requestId: await getRequestId(), tenantId: ctx.tenantId });
      return {
        success: false,
        error: "Failed to delete webhook subscription.",
      };
    }

    try {
      await recordAudit(ctx, {
        action: "webhook.delete",
        entityType: "webhook",
        entityId: subscriptionId,
        metadata: {
          reason: "Webhook endpoint deleted by clinic administrator",
        },
      });
    } catch (auditErr) {
      log.warn({ event: "webhooks.subscription_delete_audit.failed", code: errorTag(auditErr), requestId: await getRequestId(), tenantId: ctx.tenantId });
    }

    return { success: true };
  } catch (err: unknown) {
    log.error({ event: "webhooks.subscription_delete.failed", code: errorTag(err), requestId: await getRequestId(), tenantId: ctx.tenantId });
    return {
      success: false,
      error:
        clientErrorMessage(err, "Unable to delete webhook endpoint."),
    };
  }
}

/**
 * Sends an immediate synthetic test ping to an active webhook endpoint and returns result.
 */
export async function testPingWebhook(
  ctx: ServiceContext,
  subscriptionId: string
): Promise<{
  success: boolean;
  responseStatus?: number | null;
  durationMs?: number;
  error?: string;
}> {
  try {
    assertPerm(ctx.role, "clinic:manage");
    const session = ctx;
    const supabase = ctx.db;

    // Verify subscription ownership
    const { data: sub, error: subErr } = await (
      supabase.from("webhook_subscriptions") as any
    )
      .select("id, endpoint_url")
      .eq("id", subscriptionId)
      .eq("tenant_id", session.tenantId)
      .single();

    if (subErr || !sub) {
      return { success: false, error: "Webhook subscription not found." };
    }

    // Rate limit (03-13d M-SSRF-DNS; review E-8): each ping is a synchronous outbound connect whose status and timing
    // the caller sees. Counted from the tenant's own ping rows, so it holds across server instances.
    const since = new Date(Date.now() - TEST_PING_WINDOW_MS).toISOString();
    const { count: recentPings, error: countErr } = await (supabase.from("webhook_delivery_queue") as any)
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", session.tenantId)
      .eq("event_type", "ping")
      .gte("created_at", since);
    if (countErr) {
      log.error({ event: "webhooks.test_ping_count.failed", code: errorTag(countErr), requestId: await getRequestId(), tenantId: ctx.tenantId });
      return { success: false, error: "Test ping failed." };
    }
    if ((recentPings ?? 0) >= TEST_PING_LIMIT) {
      log.warn({ event: "webhooks.test_ping.rate_limited", requestId: await getRequestId(), tenantId: ctx.tenantId, count: recentPings ?? 0 });
      return { success: false, error: DEFAULT_APP_ERROR_MESSAGES.RATE_LIMITED };
    }

    // Enqueue ping item targeting this subscription
    const enqueued = await enqueueWebhookEvent(
      supabase,
      session.tenantId,
      "ping",
      {
        type: "test_ping",
        message: "Webhook verification ping from ClinicQ Developer Settings",
        timestamp: new Date().toISOString(),
      },
      { subscriptionId }
    );

    if (!enqueued || enqueued.length === 0) {
      return { success: false, error: "Failed to queue test ping event." };
    }

    // Immediately dispatch
    const result = await dispatchWebhookQueueItem(supabase, enqueued[0].id);

    return {
      success: result.success,
      responseStatus: result.responseStatus,
      durationMs: result.durationMs,
      error: result.error,
    };
  } catch (err: unknown) {
    log.error({ event: "webhooks.test_ping.failed", code: errorTag(err), requestId: await getRequestId(), tenantId: ctx.tenantId });
    return {
      success: false,
      error: clientErrorMessage(err, "Test ping failed."),
    };
  }
}

/**
 * Retrieves the latest 50 delivery queue logs for a specific webhook subscription.
 */
export async function listDeliveryLogs(
  ctx: ServiceContext,
  subscriptionId: string
): Promise<{
  success: boolean;
  logs: WebhookDeliveryLogItem[];
  error?: string;
}> {
  try {
    assertPerm(ctx.role, "clinic:manage");
    const session = ctx;
    const supabase = ctx.db;

    const { data: logs, error: fetchErr } = await (
      supabase.from("webhook_delivery_queue") as any
    )
      .select("*")
      .eq("subscription_id", subscriptionId)
      .eq("tenant_id", session.tenantId)
      .order("created_at", { ascending: false })
      .limit(50);

    if (fetchErr) {
      log.error({ event: "webhooks.delivery_logs_query.failed", code: errorTag(fetchErr), requestId: await getRequestId(), tenantId: ctx.tenantId });
      return {
        success: false,
        logs: [],
        error: "Failed to load delivery logs.",
      };
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
    log.error({ event: "webhooks.delivery_logs.failed", code: errorTag(err), requestId: await getRequestId(), tenantId: ctx.tenantId });
    return {
      success: false,
      logs: [],
      error: clientErrorMessage(err, "Access denied."),
    };
  }
}
