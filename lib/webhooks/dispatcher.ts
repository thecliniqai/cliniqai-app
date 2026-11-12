import type { WebhookDb } from "./outbox";
import { validateWebhookEndpoint, type HostResolver } from "./ssrf";
import { generateWebhookSignature } from "./signer";

export interface WebhookDispatchResult {
  success: boolean;
  status?: "delivered" | "pending" | "failed";
  responseStatus?: number | null;
  durationMs?: number;
  retryCount?: number;
  nextRetryAt?: string;
  error?: string;
}

export interface DispatchQueueSummary {
  processed: number;
  delivered: number;
  retried: number;
  failed: number;
}

/**
 * Explicit transport options (V2-03 03-10, P2-03): there is no test-environment branch. Production callers (the cron
 * route, the test-ping action, the outbox's immediate dispatch) pass nothing: https only, real DNS, real `fetch`.
 * Tests inject what they need.
 */
export interface WebhookDispatchOptions {
  /** Permit `http:` endpoints. */
  allowHttp?: boolean;
  /** Hostname resolver for the SSRF check (default: the system resolver). */
  resolve?: HostResolver;
  /** HTTP client (default: global `fetch`). */
  fetch?: typeof fetch;
}

/**
 * Calculates exponential retry backoff delays according to D-10:
 * 1st failure (retry 0 -> 1): 1 minute
 * 2nd failure (retry 1 -> 2): 5 minutes
 * 3rd failure (retry 2 -> 3): 15 minutes
 * 4th failure (retry 3 -> 4): 1 hour
 * 5th failure (retry 4 -> 5): 6 hours
 * Maximum retries: 5
 */
export function calculateWebhookBackoff(retryCount: number): number {
  if (retryCount <= 1) return 1 * 60 * 1000; // 1m
  if (retryCount === 2) return 5 * 60 * 1000; // 5m
  if (retryCount === 3) return 15 * 60 * 1000; // 15m
  if (retryCount === 4) return 60 * 60 * 1000; // 1h
  return 6 * 60 * 60 * 1000; // 6h (retryCount >= 5)
}

/**
 * Dispatches an individual webhook queue item:
 * 1. Verifies SSRF safety before fetching.
 * 2. Computes the HMAC-SHA256 signature using the subscription signing secret.
 * 3. Sends HTTP POST with a 5-second timeout and X-ClinicQ-Signature header.
 * 4. On 2xx HTTP response, marks status = 'delivered'.
 * 5. On failure, calculates exponential backoff or marks status = 'failed' if retries exhausted.
 */
export async function dispatchWebhookQueueItem(
  db: WebhookDb,
  queueItemId: string,
  options?: WebhookDispatchOptions
): Promise<WebhookDispatchResult> {
  const supabase = db;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: item, error: fetchErr } = await (supabase
    .from("webhook_delivery_queue") as any)
    .select("*, subscription:webhook_subscriptions(id, endpoint_url, signing_secret, is_active)")
    .eq("id", queueItemId)
    .single();

  if (fetchErr || !item) {
    return { success: false, error: "Queue item not found" };
  }

  // Idempotency: if already delivered, do not re-send
  if (item.status === "delivered") {
    return {
      success: true,
      status: "delivered",
      responseStatus: item.response_status,
      durationMs: item.duration_ms,
    };
  }

  const subscription = item.subscription;
  if (!subscription || !subscription.is_active) {
    // Subscription deleted or deactivated; fail permanently
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from("webhook_delivery_queue") as any)
      .update({
        status: "failed",
        response_status: 410,
        updated_at: new Date().toISOString(),
      })
      .eq("id", queueItemId);

    return {
      success: false,
      status: "failed",
      error: "Subscription is inactive or deleted",
    };
  }

  // 1. SSRF Safety Check
  const ssrfCheck = await validateWebhookEndpoint(subscription.endpoint_url, {
    allowHttp: options?.allowHttp === true,
    resolve: options?.resolve,
  });

  if (!ssrfCheck.valid) {
    // Permanently fail SSRF violations to prevent malicious scanning
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from("webhook_delivery_queue") as any)
      .update({
        status: "failed",
        response_status: 400,
        duration_ms: 0,
        updated_at: new Date().toISOString(),
      })
      .eq("id", queueItemId);

    return {
      success: false,
      status: "failed",
      responseStatus: 400,
      durationMs: 0,
      error: ssrfCheck.error || "SSRF blocked",
    };
  }

  // 2. Sign the exact raw TEXT payload
  const { header: signatureHeader } = generateWebhookSignature(
    item.payload,
    subscription.signing_secret
  );

  // 3. Execute HTTP POST with 5s timeout
  const startTime = Date.now();
  let responseStatus: number | null = null;
  let isSuccess = false;
  let durationMs = 0;

  try {
    const send = options?.fetch ?? fetch;
    const res = await send(subscription.endpoint_url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-ClinicQ-Signature": signatureHeader,
        "User-Agent": "ClinicQ-Webhook/1.0",
      },
      body: item.payload,
      // Never follow a redirect: the SSRF check above covers only the configured URL, so a 3xx to a private or
      // metadata address would bypass it (T-03-11). A redirect counts as a failed delivery and is retried.
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
    });

    durationMs = Date.now() - startTime;
    responseStatus = res.status;
    isSuccess = res.ok;
  } catch (err: unknown) {
    durationMs = Date.now() - startTime;
    responseStatus = 500;
    isSuccess = false;
  }

  const nowIso = new Date().toISOString();

  // 4. Handle 2xx Delivery Success
  if (isSuccess) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from("webhook_delivery_queue") as any)
      .update({
        status: "delivered",
        response_status: responseStatus,
        duration_ms: durationMs,
        delivered_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", queueItemId);

    return {
      success: true,
      status: "delivered",
      responseStatus,
      durationMs,
    };
  }

  // 5. Handle Failure / Retry Scheduling
  const currentRetries = typeof item.retry_count === "number" ? item.retry_count : 0;
  const newRetryCount = currentRetries + 1;
  const maxRetries = item.max_retries ?? 5;

  if (newRetryCount >= maxRetries) {
    // Max retries reached; transition permanently to 'failed'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from("webhook_delivery_queue") as any)
      .update({
        status: "failed",
        retry_count: newRetryCount,
        response_status: responseStatus,
        duration_ms: durationMs,
        updated_at: nowIso,
      })
      .eq("id", queueItemId);

    return {
      success: false,
      status: "failed",
      retryCount: newRetryCount,
      responseStatus,
      durationMs,
    };
  }

  // Schedule exponential backoff retry
  const backoffMs = calculateWebhookBackoff(newRetryCount);
  const nextRetryAt = new Date(Date.now() + backoffMs).toISOString();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.from("webhook_delivery_queue") as any)
    .update({
      status: "pending",
      retry_count: newRetryCount,
      next_retry_at: nextRetryAt,
      response_status: responseStatus,
      duration_ms: durationMs,
      updated_at: nowIso,
    })
    .eq("id", queueItemId);

  return {
    success: false,
    status: "pending",
    retryCount: newRetryCount,
    nextRetryAt,
    responseStatus,
    durationMs,
  };
}

/**
 * Scans the webhook outbox queue for pending items due for delivery or retry,
 * and processes them sequentially with concurrency safety.
 */
export async function dispatchPendingWebhookQueue(
  db: WebhookDb,
  options?: {
    limit?: number;
  } & WebhookDispatchOptions
): Promise<DispatchQueueSummary> {
  const limit = options?.limit ?? 50;
  const supabase = db;
  const nowIso = new Date().toISOString();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: dueItems, error } = await (supabase
    .from("webhook_delivery_queue") as any)
    .select("id")
    .eq("status", "pending")
    .lte("next_retry_at", nowIso)
    .order("next_retry_at", { ascending: true })
    .limit(limit);

  if (error || !dueItems) {
    console.error("[dispatchPendingWebhookQueue] Query error:", error);
    return { processed: 0, delivered: 0, retried: 0, failed: 0 };
  }

  let delivered = 0;
  let retried = 0;
  let failed = 0;

  for (const item of dueItems) {
    try {
      const result = await dispatchWebhookQueueItem(db, item.id, {
        allowHttp: options?.allowHttp,
        resolve: options?.resolve,
        fetch: options?.fetch,
      });
      if (result.success) {
        delivered++;
      } else if (result.status === "failed") {
        failed++;
      } else {
        retried++;
      }
    } catch (itemErr) {
      console.error(`[dispatchPendingWebhookQueue] Error processing item ${item.id}:`, itemErr);
      failed++;
    }
  }

  return {
    processed: dueItems.length,
    delivered,
    retried,
    failed,
  };
}
