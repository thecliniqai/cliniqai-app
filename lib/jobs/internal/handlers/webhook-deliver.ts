/**
 * Job kind `webhook.deliver` (V2-04 04-03b; P0-12, R-7, R-23, R-26; V2-03 03-13d). One job per `webhook_delivery_queue`
 * row, created by the row's AFTER INSERT trigger (migration 000036) with payload `{ delivery_id }` and dedupe key
 * `wh:<id>`. The delivery row keeps its own backoff and terminal states (R-23, `webhook_delivery_finish`); the job
 * follows the row's `next_retry_at`.
 *
 * 1. `webhook_delivery_claim(delivery_id)` on the system client: the claim is the UPDATE to `processing`, so two
 *    handlers never POST one row (the 03-10 double dispatch). No row: a terminal or missing row → done; `processing`
 *    (another handler, or a crash the delivery reaper turns into `outcome_unknown` after 240 s) → retry in 60 s; not
 *    yet due → retry at its time.
 * 2. Subscription inactive or gone → finish non-retryable (410) → dead. Subscription of another clinic than the row
 *    (03-13d M-XTENANT-WH, kept as defence in depth until V2-05's composite FK) → finish non-retryable (403), a
 *    `webhooks.queue_item.tenant_mismatch` warning, no POST → dead.
 * 3. `deliverWebhook`: SSRF check, signature over the stored raw body, POST pinned to the checked address, no redirect,
 *    5 s bound and the runner's signal. `webhook_delivery_finish`: delivered → done; pending → retry at the row's
 *    `next_retry_at`; failed → dead.
 *
 * At-least-once (R-7): a crash between the POST and the finish re-sends after the reaper; receivers dedupe on the
 * envelope id. Results carry codes only.
 */
import { z } from "zod";
import { log } from "@/lib/log";
import { deliverWebhook, type DeliverWebhookInput } from "@/lib/webhooks/dispatcher";
import type { HandlerResult, JobContext, JobHandler } from "../types";

export const WEBHOOK_DELIVER_KIND = "webhook.deliver";

const PAYLOAD = z.object({ delivery_id: z.string().uuid() }).strict();
type Payload = z.infer<typeof PAYLOAD>;

const IN_PROGRESS_RETRY_MS = 60_000;
const CLAIM_MISSED_RETRY_MS = 5_000;

interface ClaimedDelivery {
  id: string;
  tenant_id: string;
  subscription_id: string;
  event_type: string;
  payload: string;
  subscription_tenant_id: string | null;
  endpoint_url: string | null;
  signing_secret: string | null;
  is_active: boolean | null;
}

/** Test seams of {@link deliverWebhook}; production passes none (real DNS, https only, pinned transport). */
export type WebhookDeliverOptions = Pick<DeliverWebhookInput, "allowHttp" | "resolve" | "request" | "fetch">;

function firstRow<T>(data: unknown): T | null {
  if (Array.isArray(data)) return (data[0] as T) ?? null;
  return (data as T) ?? null;
}

/** When the row could not be claimed: what state is it in? */
async function unclaimed(ctx: JobContext, deliveryId: string): Promise<HandlerResult> {
  const { data, error } = await ctx.db
    .from("webhook_delivery_queue")
    .select("status, next_retry_at, last_error")
    .eq("id", deliveryId)
    .maybeSingle();
  if (error) throw error;
  const row = data as { status: string; next_retry_at: string; last_error: string | null } | null;
  const reclaimable = row?.status === "pending" || (row?.status === "failed" && row.last_error === "outcome_unknown");
  if (!row || (!reclaimable && row.status !== "processing")) return { outcome: "done" };
  if (row.status === "processing") {
    return { outcome: "retry", code: "delivery_in_progress", retryAt: new Date(ctx.now().getTime() + IN_PROGRESS_RETRY_MS) };
  }
  const due = new Date(row.next_retry_at);
  if (due.getTime() > ctx.now().getTime()) return { outcome: "retry", code: "not_due", retryAt: due };
  return { outcome: "retry", code: "claim_missed", retryAt: new Date(ctx.now().getTime() + CLAIM_MISSED_RETRY_MS) };
}

interface Attempt {
  success: boolean;
  statusCode: number;
  errorCode: string | null;
  durationMs: number;
  retryable: boolean;
}

async function finish(ctx: JobContext, id: string, attempt: Attempt): Promise<HandlerResult> {
  const { data, error } = await ctx.db.rpc("webhook_delivery_finish", {
    p_id: id,
    p_success: attempt.success,
    p_status_code: attempt.statusCode,
    // Nullable in SQL (the generated types say string): NULL on success.
    p_error_code: attempt.errorCode ?? (null as unknown as string),
    p_duration_ms: attempt.durationMs,
    p_retryable: attempt.retryable,
  });
  if (error) throw error;
  const row = firstRow<{ new_status: string; next_retry_at: string }>(data);
  const code = attempt.errorCode ?? "delivery_failed";
  // The row left `processing` under us (the reaper reclaimed it): keep the job so the row is not orphaned.
  if (!row) return { outcome: "retry", code: "finish_lost", retryAt: new Date(ctx.now().getTime() + CLAIM_MISSED_RETRY_MS) };
  if (row.new_status === "delivered") return { outcome: "done" };
  if (row.new_status === "pending") return { outcome: "retry", code, retryAt: new Date(row.next_retry_at) };
  return { outcome: "dead", code };
}

export function createWebhookDeliverHandler(options: WebhookDeliverOptions = {}): JobHandler<Payload> {
  return {
    schema: PAYLOAD,
    // One attempt is bounded at 5 s (WEBHOOK_TIMEOUT_MS) plus the DNS lookup; the runner's signal also aborts it.
    maxDurationMs: 8_000,
    async run(_job, payload, ctx): Promise<HandlerResult> {
      const { data: claimed, error: claimError } = await ctx.db.rpc("webhook_delivery_claim", { p_id: payload.delivery_id });
      if (claimError) throw claimError;
      const row = firstRow<ClaimedDelivery>(claimed);
      if (!row) return unclaimed(ctx, payload.delivery_id);

      if (!row.is_active || !row.endpoint_url || !row.signing_secret) {
        return finish(ctx, row.id, { success: false, statusCode: 410, errorCode: "subscription_inactive", durationMs: 0, retryable: false });
      }
      // 03-13d M-XTENANT-WH: a row may only use a subscription of its own clinic (never another clinic's secret/URL).
      if (row.subscription_tenant_id !== row.tenant_id) {
        log.warn({ event: "webhooks.queue_item.tenant_mismatch", tenantId: row.tenant_id, reason: "subscription_tenant_mismatch" });
        return finish(ctx, row.id, { success: false, statusCode: 403, errorCode: "subscription_tenant_mismatch", durationMs: 0, retryable: false });
      }

      const result = await deliverWebhook({
        endpointUrl: row.endpoint_url,
        signingSecret: row.signing_secret,
        rawBody: row.payload,
        signal: ctx.signal,
        ...options,
      });
      return finish(ctx, row.id, {
        success: result.ok,
        statusCode: result.status,
        errorCode: result.errorCode,
        durationMs: result.durationMs,
        retryable: result.retryable,
      });
    },
  };
}

export const WEBHOOK_DELIVER_HANDLERS = {
  [WEBHOOK_DELIVER_KIND]: createWebhookDeliverHandler() as JobHandler<unknown>,
};
