/**
 * Shared helpers for the 04-03b webhook specs (V2-04; P0-12). Synthetic data only. No socket is ever opened to a
 * receiver: the pinned transport's `request` seam is replaced by {@link recordingRequest}, the SSRF resolver by a fixed
 * answer, and the lane's socket guard refuses every non-loopback connect anyway.
 *
 * `webhook.deliver` is one kind shared by every spec, so a runner pass may also claim a job another spec left pending
 * (it is then "delivered" to the recording transport). Specs therefore assert on their own endpoints and rows.
 */
import { EventEmitter } from "node:events";
import { randomBytes } from "node:crypto";
import type http from "node:http";
import type https from "node:https";
import { runJobs, type RunJobsOptions } from "@/lib/jobs/internal/runner";
import {
  createWebhookDeliverHandler,
  WEBHOOK_DELIVER_KIND,
  type WebhookDeliverOptions,
} from "@/lib/jobs/internal/handlers/webhook-deliver";
import type { ClaimedJob, HandlerResult, JobContext, RunJobsResult } from "@/lib/jobs/internal/types";
import type { HostResolver } from "@/lib/webhooks/ssrf";
import type { RequestImpl } from "@/lib/webhooks/transport";
import { getAdminClient } from "../helpers/supabase-admin";
import { plantLegacyRow, psql } from "../helpers/sql";
import { letters } from "./helpers";

/** A public documentation-free address the SSRF check accepts (never connected to: the request is recorded). */
export const PUBLIC_IP = "93.184.216.34";
export const publicDns: HostResolver = async () => [PUBLIC_IP];
export const privateDns: HostResolver = async () => ["10.0.0.5"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function uuid(value: string): string {
  if (!UUID.test(value)) throw new Error("webhook-helpers: not a uuid");
  return value;
}

/** A synthetic signing secret built at run time (never a secret-shaped literal in source). */
export function syntheticSecret(): string {
  return ["whsec", randomBytes(16).toString("hex")].join("_");
}

/** A receiver name unique to this run (`partner-<letters>.example.test`). */
export function endpointHost(word = "partner"): string {
  return `${word}-${letters(8)}.example.test`;
}

export interface RecordedRequest {
  options: https.RequestOptions;
  body: string;
  /** `Host` header (the endpoint's name, port included when not default). */
  host: string;
}

/**
 * A pinned-transport `request` that records options and body and answers `status(call, n)` without any socket. `delayMs`
 * holds the response so concurrent handlers overlap.
 */
export function recordingRequest(
  status: number | ((call: RecordedRequest, n: number) => number) = 200,
  delayMs = 0
): { impl: RequestImpl; calls: RecordedRequest[]; to(host: string): RecordedRequest[] } {
  const calls: RecordedRequest[] = [];
  const impl: RequestImpl = (options, callback) => {
    const req = new EventEmitter() as unknown as http.ClientRequest;
    (req as unknown as { end: (b: string) => void }).end = (body: string) => {
      const headers = (options.headers ?? {}) as Record<string, string>;
      const call: RecordedRequest = { options, body, host: String(headers.host ?? "") };
      calls.push(call);
      const code = typeof status === "function" ? status(call, calls.length) : status;
      setTimeout(() => callback({ statusCode: code, destroy() {} } as unknown as http.IncomingMessage), delayMs);
    };
    return req;
  };
  return { impl, calls, to: (host) => calls.filter((c) => c.host === host || c.host.startsWith(`${host}:`)) };
}

export interface Subscription {
  id: string;
  secret: string;
  host: string;
  url: string;
}

/** A webhook subscription of `tenantId` (inserted with the service-role client, as the developer settings would). */
export async function subscribe(
  tenantId: string,
  createdBy: string,
  eventTypes: string[],
  opts: { active?: boolean; host?: string; path?: string } = {}
): Promise<Subscription> {
  const host = opts.host ?? endpointHost();
  const url = `https://${host}${opts.path ?? "/hooks/in"}`;
  const secret = syntheticSecret();
  const { data, error } = await getAdminClient()
    .from("webhook_subscriptions")
    .insert({
      tenant_id: tenantId,
      endpoint_url: url,
      event_types: eventTypes,
      signing_secret: secret,
      is_active: opts.active ?? true,
      created_by: createdBy,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`subscribe failed: ${error?.code}`);
  return { id: data.id, secret, host: host.split(":")[0], url };
}

/** A delivery row written directly with the service-role client (members can no longer write the table). */
export async function insertDelivery(
  tenantId: string,
  subscriptionId: string,
  extra: Record<string, unknown> = {}
): Promise<string> {
  const { data, error } = await getAdminClient()
    .from("webhook_delivery_queue")
    .insert({
      tenant_id: tenantId,
      subscription_id: subscriptionId,
      event_type: "appointment.booked",
      payload: JSON.stringify({ synthetic: true, n: letters(6) }),
      status: "pending",
      retry_count: 0,
      max_retries: 5,
      ...extra,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`insert delivery failed: ${error?.code}`);
  return data.id;
}

/**
 * A delivery row of `tenantId` naming ANOTHER clinic's subscription, as one could exist before V2-05 05-03 (review
 * E-1 / M-XTENANT-WH). The composite FK `webhook_delivery_queue_tenant_subscription_fkey` now refuses it for every
 * writer (service role included), so it is planted with FK triggers off (`plantLegacyRow`) to prove the handler's
 * tenant check still holds as defence in depth.
 */
export function plantForgedDelivery(tenantId: string, foreignSubscriptionId: string, eventType = "appointment.booked"): string {
  if (!/^[a-z0-9._]+$/.test(eventType)) throw new Error("webhook-helpers: bad event type");
  const [id] = plantLegacyRow(
    `insert into public.webhook_delivery_queue (tenant_id, subscription_id, event_type, payload, status, retry_count, max_retries) ` +
      `values ('${uuid(tenantId)}', '${uuid(foreignSubscriptionId)}', '${eventType}', '{"synthetic":true}', 'pending', 0, 5) returning id`
  );
  if (!id) throw new Error("webhook-helpers: planting the forged delivery returned no id");
  return id;
}

export interface DeliveryRow {
  id: string;
  status: string;
  retryCount: number;
  responseStatus: number | null;
  lastError: string | null;
  eventKey: string | null;
  dueInSeconds: number;
}

function toRow(line: string): DeliveryRow {
  const [id, status, retry, response, lastError, eventKey, due] = line.split("|");
  return {
    id,
    status,
    retryCount: Number(retry),
    responseStatus: response === "" ? null : Number(response),
    lastError: lastError || null,
    eventKey: eventKey || null,
    dueInSeconds: Number(due),
  };
}

const ROW_SQL =
  `id || '|' || status || '|' || retry_count || '|' || coalesce(response_status::text, '') || '|' || ` +
  `coalesce(last_error, '') || '|' || coalesce(event_key, '') || '|' || round(extract(epoch from next_retry_at - now()))::int`;

export function deliveryRow(id: string): DeliveryRow {
  const [line] = psql(`select ${ROW_SQL} from public.webhook_delivery_queue where id = '${uuid(id)}'`);
  if (!line) throw new Error("webhook-helpers: no such delivery row");
  return toRow(line);
}

export function deliveriesFor(subscriptionId: string): DeliveryRow[] {
  return psql(
    `select ${ROW_SQL} from public.webhook_delivery_queue where subscription_id = '${uuid(subscriptionId)}' order by created_at, id`
  ).map(toRow);
}

export function deliveryPayload(id: string): string {
  const { 0: line } = psql(`select payload from public.webhook_delivery_queue where id = '${uuid(id)}'`);
  return line;
}

export interface WebhookJob {
  id: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  tenantId: string;
  dedupeKey: string;
  /** run_at minus the row's next_retry_at, in seconds. */
  runVsRowSeconds: number;
}

/** The `webhook.deliver` job(s) of a delivery row (exactly one by the dedupe key `wh:<id>`). */
export function webhookJobsFor(deliveryId: string): WebhookJob[] {
  const id = uuid(deliveryId);
  return psql(
    `select j.id || '|' || j.status || '|' || j.attempts || '|' || j.max_attempts || '|' || coalesce(j.last_error, '') || '|' || ` +
      `coalesce(j.tenant_id::text, '') || '|' || j.dedupe_key || '|' || ` +
      `round(extract(epoch from j.run_at - w.next_retry_at))::int from ops.jobs j ` +
      `join public.webhook_delivery_queue w on w.id = '${id}' ` +
      `where j.kind = 'webhook.deliver' and j.payload ->> 'delivery_id' = '${id}' order by j.created_at`
  ).map((line) => {
    const [jid, status, attempts, maxAttempts, lastError, tenantId, dedupeKey, runVsRow] = line.split("|");
    return {
      id: jid,
      status,
      attempts: Number(attempts),
      maxAttempts: Number(maxAttempts),
      lastError: lastError || null,
      tenantId,
      dedupeKey,
      runVsRowSeconds: Number(runVsRow),
    };
  });
}

/** Makes a delivery row and its job due now (time moves by SQL, never by sleeping). */
export function makeDeliveryDue(deliveryId: string): void {
  const id = uuid(deliveryId);
  psql(
    `update public.webhook_delivery_queue set next_retry_at = now() - interval '1 second' where id = '${id}'; ` +
      `update ops.jobs set run_at = now() - interval '1 second' where kind = 'webhook.deliver' and payload ->> 'delivery_id' = '${id}' and status = 'pending'`
  );
}

/** One runner pass over `webhook.deliver` with the real handler and the given test seams. */
export function runWebhooks(
  options: WebhookDeliverOptions,
  worker: string,
  overrides: Partial<RunJobsOptions> = {}
): Promise<RunJobsResult> {
  return runJobs({
    db: getAdminClient(),
    budgetMs: 20_000,
    batch: 25,
    leaseSeconds: 120,
    perTenant: 100,
    worker,
    source: "test",
    kinds: [WEBHOOK_DELIVER_KIND],
    handlers: { [WEBHOOK_DELIVER_KIND]: createWebhookDeliverHandler({ resolve: publicDns, ...options }) as never },
    ...overrides,
  });
}

/** Runs the handler once for a delivery row, outside the runner (no job claim): what one handler does with the row. */
export function runHandlerOnce(deliveryId: string, options: WebhookDeliverOptions): Promise<HandlerResult> {
  const handler = createWebhookDeliverHandler({ resolve: publicDns, ...options });
  const job: ClaimedJob = {
    id: "00000000-0000-4000-8000-000000000000",
    kind: WEBHOOK_DELIVER_KIND,
    tenantId: null,
    payload: { delivery_id: deliveryId },
    attempts: 1,
    maxAttempts: 7,
    leaseToken: "00000000-0000-4000-8000-000000000001",
    runAt: new Date().toISOString(),
  };
  const ctx: JobContext = { db: getAdminClient(), signal: AbortSignal.timeout(8_000), now: () => new Date() };
  return handler.run(job, { delivery_id: deliveryId }, ctx);
}

export function deleteRunnerRuns(workerPrefix: string): void {
  if (!/^[a-z0-9-]+$/.test(workerPrefix)) throw new Error("webhook-helpers: bad worker prefix");
  psql(`delete from ops.job_runner_runs where worker like '${workerPrefix}%'`);
}
