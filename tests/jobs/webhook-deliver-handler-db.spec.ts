/**
 * V2-04 04-03b (P0-12; R-7, R-23, R-26; T-04-07, T-04-19; V2-03 03-13d): the `webhook.deliver` handler on the live
 * local stack, with the pinned transport's `request` seam and the SSRF resolver injected (no socket to any receiver).
 *
 * - Tracer: a receptionist's `prescription.issued` → `enqueue_webhook_event` → delivery row → its job → `runJobs` →
 *   one POST to the resolved address with `servername`/`Host` = the endpoint name, whose signature verifies over the
 *   stored raw text → row `delivered`, job `done` (attempt 1).
 * - 500 → row `pending` (1 m), the job retries at the row's `next_retry_at`; a resolver answering `10.0.0.5` → `failed`
 *   (400), no POST, job dead; a 302 is a failed attempt (no redirect followed); `max_retries = 50` stops after 5 POSTs;
 *   a forged row naming another clinic's subscription → `failed`/403, no POST; an inactive subscription → 410.
 * - Concurrency: two handlers for one delivery → one POST; 8 parallel runners over 120 deliveries → 120 POSTs, each
 *   delivery once (the roadmap's "0 duplicate sends" for webhooks).
 * - At-least-once: a handler that died after the claim leaves `processing`; the reaper makes it `outcome_unknown` and the
 *   next run delivers it; a dead job fails its open row (`job_dead:<code>`).
 * - SSRF pinning through the job path with the real transport: the socket is aimed at the vetted address, never the name.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { verifyWebhookSignature } from "@/lib/webhooks/signer";
import { enqueueWebhookEvent } from "@/lib/jobs/enqueue";
import { getAdminClient } from "../helpers/supabase-admin";
import { ctxFor } from "../helpers/context";
import { addMemberToTenant, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { psql } from "../helpers/sql";
import { letters } from "./helpers";
import { seedPatient } from "./message-helpers";
import {
  PUBLIC_IP,
  deleteRunnerRuns,
  deliveriesFor,
  deliveryPayload,
  deliveryRow,
  insertDelivery,
  makeDeliveryDue,
  privateDns,
  recordingRequest,
  runHandlerOnce,
  runWebhooks,
  subscribe,
  webhookJobsFor,
  type Subscription,
} from "./webhook-helpers";

const WORKER = `spec-webhook-${letters(8)}`;
let ownerA: SeededTenant;
let receptionistA: SeededTenant;
let ownerB: SeededTenant;

beforeAll(async () => {
  ownerA = await seedTenantWithOwner(`Webhook Deliver A ${letters(6)}`);
  ownerB = await seedTenantWithOwner(`Webhook Deliver B ${letters(6)}`);
  receptionistA = await addMemberToTenant(ownerA.tenantId, "receptionist");
});

afterAll(() => {
  deleteRunnerRuns(WORKER);
});

async function prescription(): Promise<string> {
  const p = await seedPatient(ownerA.tenantId, ownerA.userId);
  const { data, error } = await getAdminClient()
    .from("prescriptions")
    // Signed: a request raises prescription.issued only at signing (04-07a M-RXEVENT).
    .insert({ tenant_id: p.tenantId, visit_id: p.visitId, patient_id: p.patientId, doctor_id: ownerA.userId, version: 1, status: "active", letterhead_mode: "blank_paper", signed_at: new Date().toISOString() })
    .select("id")
    .single();
  if (error || !data) throw new Error(`seed prescription failed: ${error?.code}`);
  return data.id;
}

describe("tracer: receptionist event → RPC → delivery row → job → runner → one signed, pinned POST", () => {
  it("delivers once to the vetted address with SNI/Host = the endpoint name; the signature verifies over the stored text", async () => {
    const sub = await subscribe(ownerA.tenantId, ownerA.userId, ["prescription.issued"], { host: `tracer-${letters(8)}.example.test:8443`, path: "/hooks/in?x=1" });
    const rx = await prescription();
    const { deliveryIds } = await enqueueWebhookEvent(ctxFor(receptionistA), "prescription.issued", rx);
    expect(deliveryIds).toHaveLength(1);
    const [id] = deliveryIds;
    const transport = recordingRequest(200);

    await runWebhooks({ request: transport.impl }, `${WORKER}-tracer`);

    const mine = transport.to(sub.host);
    expect(mine).toHaveLength(1);
    expect(mine[0].options).toMatchObject({
      host: PUBLIC_IP,
      port: 8443,
      path: "/hooks/in?x=1",
      method: "POST",
      servername: sub.host,
      headers: expect.objectContaining({ host: `${sub.host}:8443`, "Content-Type": "application/json" }),
    });
    expect(mine[0].options.signal).toBeInstanceOf(AbortSignal);
    const stored = deliveryPayload(id);
    expect(mine[0].body).toBe(stored);
    const header = String((mine[0].options.headers as Record<string, string>)["X-ClinicQ-Signature"]);
    expect(verifyWebhookSignature(stored, header, sub.secret, 300)).toEqual({ valid: true });
    expect(JSON.parse(stored)).toMatchObject({ event: "prescription.issued", data: { prescription_id: rx } });

    expect(deliveryRow(id)).toMatchObject({ status: "delivered", responseStatus: 200, lastError: null, retryCount: 0 });
    expect(psql(`select delivered_at is not null from public.webhook_delivery_queue where id = '${id}'`)).toEqual(["t"]);
    expect(webhookJobsFor(id)).toEqual([expect.objectContaining({ status: "done", attempts: 1 })]);

    // A second pass finds nothing to do for this row: delivered exactly once.
    await runWebhooks({ request: transport.impl }, `${WORKER}-tracer`);
    expect(transport.to(sub.host)).toHaveLength(1);
  });
});

describe("delivery outcomes", () => {
  let sub: Subscription;
  beforeAll(async () => {
    sub = await subscribe(ownerA.tenantId, ownerA.userId, ["prescription.issued"]);
  });

  it("500 → pending with the 1-minute backoff; the job retries at the row's next_retry_at", async () => {
    const id = await insertDelivery(ownerA.tenantId, sub.id);
    const transport = recordingRequest(500);
    expect(await runHandlerOnce(id, { request: transport.impl })).toMatchObject({ outcome: "retry", code: "http_500" });
    const row = deliveryRow(id);
    expect(row).toMatchObject({ status: "pending", retryCount: 1, responseStatus: 500, lastError: "http_500" });
    expect(row.dueInSeconds).toBeGreaterThanOrEqual(55);
    expect(row.dueInSeconds).toBeLessThanOrEqual(61);

    // Through the runner: the job's run_at follows the row (R-23).
    const id2 = await insertDelivery(ownerA.tenantId, sub.id);
    const other = recordingRequest(500);
    await runWebhooks({ request: other.impl }, `${WORKER}-retry`);
    expect(deliveryRow(id2)).toMatchObject({ status: "pending", retryCount: 1 });
    const [job] = webhookJobsFor(id2);
    expect(job).toMatchObject({ status: "pending", attempts: 1, lastError: "http_500" });
    expect(Math.abs(job.runVsRowSeconds)).toBeLessThanOrEqual(1);
  });

  it("successive failures follow 1 m, 5 m, 15 m, 1 h and the fifth is terminal (V2-03 curve, now in SQL)", async () => {
    const id = await insertDelivery(ownerA.tenantId, sub.id);
    const transport = recordingRequest(503);
    const dues: number[] = [];
    for (let i = 0; i < 4; i++) {
      makeDeliveryDue(id);
      await runHandlerOnce(id, { request: transport.impl });
      dues.push(deliveryRow(id).dueInSeconds);
    }
    expect(dues.map((d) => Math.round(d / 60))).toEqual([1, 5, 15, 60]);
    makeDeliveryDue(id);
    expect(await runHandlerOnce(id, { request: transport.impl })).toEqual({ outcome: "dead", code: "http_503" });
    expect(deliveryRow(id)).toMatchObject({ status: "failed", retryCount: 5 });
    expect(transport.calls).toHaveLength(5);
  });

  it("a resolver answering 10.0.0.5 → failed (400 ssrf_blocked) at once, no POST, job dead", async () => {
    const id = await insertDelivery(ownerA.tenantId, sub.id);
    const transport = recordingRequest(200);
    await runWebhooks({ request: transport.impl, resolve: privateDns }, `${WORKER}-ssrf`);
    expect(transport.to(sub.host)).toEqual([]);
    expect(deliveryRow(id)).toMatchObject({ status: "failed", responseStatus: 400, lastError: "ssrf_blocked", retryCount: 0 });
    expect(webhookJobsFor(id)).toEqual([expect.objectContaining({ status: "dead", attempts: 1, lastError: "ssrf_blocked" })]);
  });

  it("a 302 is a failed attempt: one request, the redirect is not followed, the row is not delivered", async () => {
    const id = await insertDelivery(ownerA.tenantId, sub.id);
    const transport = recordingRequest(302);
    expect(await runHandlerOnce(id, { request: transport.impl })).toMatchObject({ outcome: "retry", code: "http_302" });
    expect(transport.calls).toHaveLength(1);
    expect(deliveryRow(id)).toMatchObject({ status: "pending", responseStatus: 302, retryCount: 1 });
  });

  it("a row with max_retries = 50 stops after 5 attempts (03-13d cap, review E-8)", async () => {
    const id = await insertDelivery(ownerA.tenantId, sub.id, { max_retries: 50 });
    expect(webhookJobsFor(id)[0].maxAttempts).toBe(7);
    const transport = recordingRequest(503);
    for (let i = 0; i < 7; i++) {
      makeDeliveryDue(id);
      await runHandlerOnce(id, { request: transport.impl });
    }
    expect(transport.calls).toHaveLength(5);
    expect(deliveryRow(id)).toMatchObject({ status: "failed", retryCount: 5 });
  });

  it("a forged row naming another clinic's subscription → failed/403, no POST, a tenant-mismatch warning", async () => {
    const victim = await subscribe(ownerB.tenantId, ownerB.userId, ["payment.recorded"]);
    // Written with the service role: members can no longer insert rows (000036), so this is the only way to forge one.
    const id = await insertDelivery(ownerA.tenantId, victim.id, { event_type: "payment.recorded" });
    const transport = recordingRequest(200);
    const out: string[] = [];
    const capture = ((chunk: unknown) => {
      out.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    const spies = [vi.spyOn(process.stdout, "write").mockImplementation(capture), vi.spyOn(process.stderr, "write").mockImplementation(capture)];
    let result;
    try {
      result = await runHandlerOnce(id, { request: transport.impl });
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
    expect(result).toEqual({ outcome: "dead", code: "subscription_tenant_mismatch" });
    expect(transport.calls).toEqual([]);
    expect(deliveryRow(id)).toMatchObject({ status: "failed", responseStatus: 403 });
    const warning = out
      .flatMap((chunk) => chunk.split("\n").filter(Boolean))
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .find((l) => l.event === "webhooks.queue_item.tenant_mismatch");
    expect(warning).toMatchObject({ level: "warn", tenantId: ownerA.tenantId, reason: "subscription_tenant_mismatch" });
    expect(out.join("")).not.toContain(victim.secret);
  });

  it("an inactive subscription → failed/410, no POST", async () => {
    const inactive = await subscribe(ownerA.tenantId, ownerA.userId, ["prescription.issued"], { active: false });
    const id = await insertDelivery(ownerA.tenantId, inactive.id);
    const transport = recordingRequest(200);
    expect(await runHandlerOnce(id, { request: transport.impl })).toEqual({ outcome: "dead", code: "subscription_inactive" });
    expect(transport.calls).toEqual([]);
    expect(deliveryRow(id)).toMatchObject({ status: "failed", responseStatus: 410 });
  });

  it("a delivered or failed row is never claimed again (a stray job is done, no POST)", async () => {
    const id = await insertDelivery(ownerA.tenantId, sub.id);
    const ok = recordingRequest(200);
    await runHandlerOnce(id, { request: ok.impl });
    expect(await runHandlerOnce(id, { request: ok.impl })).toEqual({ outcome: "done" });
    const failed = await insertDelivery(ownerA.tenantId, sub.id);
    await runHandlerOnce(failed, { request: ok.impl, resolve: privateDns });
    makeDeliveryDue(failed);
    expect(await runHandlerOnce(failed, { request: ok.impl })).toEqual({ outcome: "done" });
    expect(ok.calls).toHaveLength(1);
  });
});

describe("concurrency (T-04-07)", () => {
  it("two concurrent handlers for one delivery → one POST", async () => {
    const sub = await subscribe(ownerA.tenantId, ownerA.userId, ["prescription.issued"]);
    const id = await insertDelivery(ownerA.tenantId, sub.id);
    const transport = recordingRequest(200, 50);
    const results = await Promise.all([runHandlerOnce(id, { request: transport.impl }), runHandlerOnce(id, { request: transport.impl })]);
    expect(transport.calls).toHaveLength(1);
    expect(results).toContainEqual({ outcome: "done" });
    expect(results).toContainEqual(expect.objectContaining({ outcome: "retry", code: "delivery_in_progress" }));
    expect(deliveryRow(id).status).toBe("delivered");
  });

  it("8 parallel runners over 120 deliveries → 120 POSTs, each delivery exactly once, every job done at attempt 1", async () => {
    const subs = await Promise.all([
      subscribe(ownerA.tenantId, ownerA.userId, ["prescription.issued"]),
      subscribe(ownerB.tenantId, ownerB.userId, ["prescription.issued"]),
    ]);
    const ids: string[] = [];
    for (const [i, s] of subs.entries()) {
      const tenant = i === 0 ? ownerA.tenantId : ownerB.tenantId;
      ids.push(
        ...psql(
          `insert into public.webhook_delivery_queue (tenant_id, subscription_id, event_type, payload, event_key) ` +
            `select '${tenant}', '${s.id}', 'prescription.issued', json_build_object('n', g, 's', '${s.id}')::text, ` +
            `'parallel:' || g from generate_series(1, 60) g returning id`
        ).filter((line) => /^[0-9a-f-]{36}$/.test(line))
      );
    }
    expect(ids).toHaveLength(120);
    const transport = recordingRequest(200);
    const runs = await Promise.all(
      Array.from({ length: 8 }, (_, n) => runWebhooks({ request: transport.impl }, `${WORKER}-par-${n}`, { batch: 10 }))
    );
    expect(runs.every((r) => r.ok)).toBe(true);

    const mine = transport.calls.filter((c) => subs.some((s) => c.host === s.host));
    expect(mine).toHaveLength(120);
    expect(new Set(mine.map((c) => c.body)).size).toBe(120);
    const states = psql(
      `select status || '|' || count(*) from public.webhook_delivery_queue where id in (${ids.map((i) => `'${i}'`).join(",")}) group by status`
    );
    expect(states).toEqual(["delivered|120"]);
    const jobs = psql(
      `select status || '|' || attempts || '|' || count(*) from ops.jobs where kind = 'webhook.deliver' and ` +
        `payload ->> 'delivery_id' in (${ids.map((i) => `'${i}'`).join(",")}) group by status, attempts`
    );
    expect(jobs).toEqual(["done|1|120"]);
  }, 60_000);
});

describe("at-least-once (R-7)", () => {
  it("a handler that died after the claim: the reaper marks the row outcome_unknown and the next run delivers it once", async () => {
    const sub = await subscribe(ownerA.tenantId, ownerA.userId, ["prescription.issued"]);
    const id = await insertDelivery(ownerA.tenantId, sub.id);
    // The crash: claimed (processing) five minutes ago, never finished.
    const { error } = await getAdminClient().rpc("webhook_delivery_claim", { p_id: id });
    expect(error).toBeNull();
    psql(`update public.webhook_delivery_queue set updated_at = now() - interval '5 minutes' where id = '${id}'`);
    const transport = recordingRequest(200);
    expect(await runHandlerOnce(id, { request: transport.impl })).toMatchObject({ outcome: "retry", code: "delivery_in_progress" });

    expect(Number(psql("select ops.reap_delivery_rows()")[0])).toBeGreaterThanOrEqual(1);
    expect(deliveryRow(id)).toMatchObject({ status: "failed", lastError: "outcome_unknown" });
    expect(await runHandlerOnce(id, { request: transport.impl })).toEqual({ outcome: "done" });
    expect(transport.calls).toHaveLength(1);
    expect(deliveryRow(id)).toMatchObject({ status: "delivered", lastError: null });
  });

  it("a processing row younger than 240 s is not reaped", async () => {
    const sub = await subscribe(ownerA.tenantId, ownerA.userId, ["prescription.issued"]);
    const id = await insertDelivery(ownerA.tenantId, sub.id);
    await getAdminClient().rpc("webhook_delivery_claim", { p_id: id });
    psql("select ops.reap_delivery_rows()");
    expect(deliveryRow(id).status).toBe("processing");
  });

  it("a dead job fails its open delivery row (job_dead:<code>)", async () => {
    const sub = await subscribe(ownerA.tenantId, ownerA.userId, ["prescription.issued"]);
    const id = await insertDelivery(ownerA.tenantId, sub.id);
    const [job] = webhookJobsFor(id);
    psql(`update ops.jobs set status = 'dead', last_error = 'lease_expired', finished_at = now() where id = '${job.id}'`);
    expect(deliveryRow(id)).toMatchObject({ status: "failed", lastError: "job_dead:lease_expired" });
  });
});

describe("SSRF pinning through the job path with the real transport (03-13d M-SSRF-DNS, T-04-19)", () => {
  it("the socket is aimed at the vetted address, never at the name; the lane's guard refuses it (retryable 500)", async () => {
    const sub = await subscribe(ownerA.tenantId, ownerA.userId, ["prescription.issued"], { host: `rebind-${letters(8)}.example.test` });
    const id = await insertDelivery(ownerA.tenantId, sub.id);
    let lookups = 0;
    const resolve = vi.fn(async () => (lookups++ === 0 ? [PUBLIC_IP] : ["127.0.0.1"]));
    const connect = vi.spyOn((await import("node:net")).Socket.prototype, "connect");
    let result;
    let hosts: Array<string | undefined>;
    try {
      result = await runHandlerOnce(id, { resolve });
      // Read before mockRestore (it clears the recorded calls).
      hosts = connect.mock.calls.map((args) => {
        const first = args[0] as unknown;
        return first && typeof first === "object" ? (first as { host?: string }).host : String(args[1]);
      });
    } finally {
      connect.mockRestore();
    }
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(hosts).toContain(PUBLIC_IP);
    expect(hosts).not.toContain(sub.host);
    expect(hosts).not.toContain("127.0.0.1");
    expect(result).toMatchObject({ outcome: "retry" });
    expect(deliveryRow(id)).toMatchObject({ status: "pending", responseStatus: 500, retryCount: 1 });
    expect(deliveriesFor(sub.id)).toHaveLength(1);
  });
});
