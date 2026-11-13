import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import http from "node:http";
import https from "node:https";
import { validateWebhookEndpoint, isPrivateIp, type HostResolver } from "@/lib/webhooks/ssrf";
import { generateWebhookSignature, verifyWebhookSignature } from "@/lib/webhooks/signer";
import { enqueueWebhookEvent, EnqueueError } from "@/lib/jobs/enqueue";
import { testPingWebhook } from "@/features/webhooks/service";
import { seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { getAdminClient } from "../helpers/supabase-admin";
import { ctxFor } from "../helpers/context";
import { psql } from "../helpers/sql";
import { seedPatient } from "../jobs/message-helpers";
import { deliveriesFor, deliveryPayload, deliveryRow, insertDelivery, runHandlerOnce, subscribe, webhookJobsFor } from "../jobs/webhook-helpers";
import crypto from "crypto";

// V2-03 03-10: the SSRF check and the deliverer have no test-environment branch; tests inject the resolver and the
// HTTP client explicitly (production passes nothing: https only, system DNS, the pinned transport).
// V2-04 04-03b (pitfall 9, assertions kept): the request path only enqueues (`enqueue_webhook_event`, no POST, no
// background dispatch: the 03-10 second writer is gone); delivery runs in the `webhook.deliver` handler, whose SQL
// (`webhook_delivery_finish`) owns the backoff. The cron recovery route is deleted (the job runner replaces it).
const publicDns: HostResolver = async () => ["93.184.216.34"];
const privateDns: HostResolver = async () => ["10.0.0.5"];
type FetchArgs = Parameters<typeof fetch>;
const fakeFetch = (respond: (url: FetchArgs[0], init?: FetchArgs[1]) => Response | Promise<Response>) =>
  vi.fn(async (url: FetchArgs[0], init?: FetchArgs[1]) => respond(url, init));

describe("Webhook SSRF Protection & Signature Engine (Task 1)", () => {
  describe("SSRF Validator (lib/webhooks/ssrf.ts)", () => {
    it("identifies private and loopback IPv4 addresses correctly", () => {
      expect(isPrivateIp("127.0.0.1")).toBe(true);
      expect(isPrivateIp("127.1.2.3")).toBe(true);
      expect(isPrivateIp("10.0.0.1")).toBe(true);
      expect(isPrivateIp("10.254.12.34")).toBe(true);
      expect(isPrivateIp("172.16.0.1")).toBe(true);
      expect(isPrivateIp("172.31.255.254")).toBe(true);
      expect(isPrivateIp("192.168.1.1")).toBe(true);
      expect(isPrivateIp("169.254.169.254")).toBe(true); // AWS/cloud metadata
      expect(isPrivateIp("0.0.0.0")).toBe(true);
      expect(isPrivateIp("100.64.0.1")).toBe(true); // CGNAT
    });

    it("identifies private and loopback IPv6 addresses correctly", () => {
      expect(isPrivateIp("::1")).toBe(true);
      expect(isPrivateIp("::")).toBe(true);
      expect(isPrivateIp("fc00::1")).toBe(true);
      expect(isPrivateIp("fd12:3456:789a::1")).toBe(true);
      expect(isPrivateIp("fe80::1")).toBe(true);
      expect(isPrivateIp("::ffff:127.0.0.1")).toBe(true);
    });

    it("allows valid public IP addresses", () => {
      expect(isPrivateIp("8.8.8.8")).toBe(false);
      expect(isPrivateIp("1.1.1.1")).toBe(false);
      expect(isPrivateIp("93.184.216.34")).toBe(false);
    });

    it("blocks endpoints attempting SSRF targeting loopback, private subnets, or metadata", async () => {
      const loopbackResult = await validateWebhookEndpoint("https://127.0.0.1/webhook");
      expect(loopbackResult.valid).toBe(false);
      expect(loopbackResult.error).toContain("Private, loopback, or metadata");

      const metadataResult = await validateWebhookEndpoint("https://169.254.169.254/latest/meta-data");
      expect(metadataResult.valid).toBe(false);
      expect(metadataResult.error).toContain("Private, loopback, or metadata");

      const privateClassAResult = await validateWebhookEndpoint("https://10.0.0.1/notify");
      expect(privateClassAResult.valid).toBe(false);

      const privateClassBResult = await validateWebhookEndpoint("https://172.16.0.5/events");
      expect(privateClassBResult.valid).toBe(false);

      const privateClassCResult = await validateWebhookEndpoint("https://192.168.1.100/webhook");
      expect(privateClassCResult.valid).toBe(false);

      const localhostNameResult = await validateWebhookEndpoint("https://localhost/webhook");
      expect(localhostNameResult.valid).toBe(false);
    });

    it("enforces HTTPS protocol by default and rejects plain HTTP", async () => {
      const httpResult = await validateWebhookEndpoint("http://example.com/webhook");
      expect(httpResult.valid).toBe(false);
      expect(httpResult.error).toContain("must use the secure HTTPS protocol");

      const ftpResult = await validateWebhookEndpoint("ftp://example.com/webhook");
      expect(ftpResult.valid).toBe(false);
    });

    it("permits valid public HTTPS destinations", async () => {
      const validResult = await validateWebhookEndpoint("https://example.com/webhook/endpoint", { resolve: publicDns });
      expect(validResult.valid).toBe(true);
      expect(validResult.error).toBeUndefined();
    });
  });

  describe("HMAC Signer & Verifier (lib/webhooks/signer.ts)", () => {
    const testSecret = "whsec_test_secret_key_1234567890abcdef";
    const testPayload = JSON.stringify({ event: "appointment.booked", data: { id: "apt-123" } });
    const fixedTimestamp = 1762700000;

    it("generates correct Stripe-compatible header format t={timestamp},v1={hex_signature}", () => {
      const { header, signature, timestamp } = generateWebhookSignature(testPayload, testSecret, fixedTimestamp);

      expect(timestamp).toBe(fixedTimestamp);
      expect(header).toBe(`t=${fixedTimestamp},v1=${signature}`);

      // Verify HMAC matches independent calculation
      const expectedSigned = `${fixedTimestamp}.${testPayload}`;
      const expectedSig = crypto.createHmac("sha256", testSecret).update(expectedSigned).digest("hex");
      expect(signature).toBe(expectedSig);
    });

    it("verifies authentic signatures within tolerance window", () => {
      const currentTimestamp = Math.floor(Date.now() / 1000);
      const { header } = generateWebhookSignature(testPayload, testSecret, currentTimestamp);

      const verification = verifyWebhookSignature(testPayload, header, testSecret, 300);
      expect(verification.valid).toBe(true);
      expect(verification.error).toBeUndefined();
    });

    it("rejects tampered payloads", () => {
      const currentTimestamp = Math.floor(Date.now() / 1000);
      const { header } = generateWebhookSignature(testPayload, testSecret, currentTimestamp);

      const tamperedPayload = JSON.stringify({ event: "appointment.booked", data: { id: "apt-tampered" } });
      const verification = verifyWebhookSignature(tamperedPayload, header, testSecret, 300);
      expect(verification.valid).toBe(false);
      expect(verification.error).toBe("Signature mismatch.");
    });

    it("rejects wrong signing secrets", () => {
      const currentTimestamp = Math.floor(Date.now() / 1000);
      const { header } = generateWebhookSignature(testPayload, testSecret, currentTimestamp);

      const verification = verifyWebhookSignature(testPayload, header, "whsec_incorrect_secret", 300);
      expect(verification.valid).toBe(false);
      expect(verification.error).toBe("Signature mismatch.");
    });

    it("rejects expired timestamps (> 300s window)", () => {
      const oldTimestamp = Math.floor(Date.now() / 1000) - 400; // 400s ago
      const { header } = generateWebhookSignature(testPayload, testSecret, oldTimestamp);

      const verification = verifyWebhookSignature(testPayload, header, testSecret, 300);
      expect(verification.valid).toBe(false);
      expect(verification.error).toContain("tolerance window");
    });
  });

  describe("Webhook enqueue (04-03b: lib/jobs/enqueue → public.enqueue_webhook_event)", () => {
    let tenant: SeededTenant;
    let subA: { id: string };
    let subB: { id: string };
    let inactiveSub: { id: string };

    async function prescription(): Promise<string> {
      const p = await seedPatient(tenant.tenantId, tenant.userId);
      const { data, error } = await getAdminClient()
        .from("prescriptions")
        // Signed: a request raises prescription.issued only at signing (04-07a M-RXEVENT).
        .insert({ tenant_id: p.tenantId, visit_id: p.visitId, patient_id: p.patientId, doctor_id: tenant.userId, version: 1, status: "active", letterhead_mode: "blank_paper", signed_at: new Date().toISOString() })
        .select("id, patient_id, visit_id")
        .single();
      if (error || !data) throw new Error(`seed prescription failed: ${error?.code}`);
      return data.id;
    }

    /**
     * Every outbound path a background dispatch could take: the pinned transport's modules and global fetch. supabase-js
     * itself uses fetch for the local stack, so `fetch` counts only calls to a non-loopback host.
     */
    function outboundSpies() {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const outboundFetches = () =>
        fetchSpy.mock.calls
          .map(([input]) => new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url).hostname)
          .filter((host) => host !== "127.0.0.1" && host !== "localhost");
      return { requests: [vi.spyOn(https, "request"), vi.spyOn(http, "request")], outboundFetches };
    }

    beforeAll(async () => {
      tenant = await seedTenantWithOwner("Webhooks Outbox Test Clinic");
      subA = await subscribe(tenant.tenantId, tenant.userId, ["appointment.booked", "appointment.cancelled"]);
      subB = await subscribe(tenant.tenantId, tenant.userId, ["visit.completed", "prescription.issued"]);
      inactiveSub = await subscribe(tenant.tenantId, tenant.userId, ["appointment.booked", "lab_result.ready"], { active: false });
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("enqueues one raw-TEXT envelope per matching active subscription and performs no POST (before: fire-and-forget dispatch)", async () => {
      const spies = outboundSpies();
      const rx = await prescription();

      const enqueued = await enqueueWebhookEvent(ctxFor(tenant), "prescription.issued", rx);
      // Give a background dispatch (the pre-04-03b `import("./dispatcher").then(…)`) time to start.
      await new Promise((r) => setTimeout(r, 100));

      for (const spy of spies.requests) expect(spy).not.toHaveBeenCalled();
      expect(spies.outboundFetches()).toEqual([]);
      expect(enqueued).toEqual({ queued: 1, deliveryIds: [expect.any(String)] });
      const [row] = deliveriesFor(subB.id).filter((r) => r.id === enqueued.deliveryIds[0]);
      expect(row).toMatchObject({ status: "pending", retryCount: 0, responseStatus: null });
      expect(psql(`select max_retries from public.webhook_delivery_queue where id = '${row.id}'`)).toEqual(["5"]);
      const parsed = JSON.parse(deliveryPayload(row.id));
      expect(parsed.event).toBe("prescription.issued");
      expect(parsed.data).toMatchObject({ prescription_id: rx });
      expect(parsed.id).toBeDefined();
      // Delivery is the runner's: one webhook.deliver job, still pending.
      expect(webhookJobsFor(row.id)).toEqual([expect.objectContaining({ status: "pending" })]);
    });

    it("does not enqueue events to unsubscribed or inactive subscriptions", async () => {
      const [doc] = psql(
        `insert into public.patient_documents (tenant_id, patient_id, title, storage_path, original_filename, mime_type, ` +
          `file_size_bytes, uploaded_by) select '${tenant.tenantId}', p.id, 'Synthetic report', ` +
          `'tenants/${tenant.tenantId}/patients/' || p.id || '/labs/s.pdf', 's.pdf', 'application/pdf', 10, '${tenant.userId}' ` +
          `from public.patients p where p.tenant_id = '${tenant.tenantId}' limit 1 returning id`
      );
      const enqueued = await enqueueWebhookEvent(ctxFor(tenant), "lab_result.ready", doc);
      expect(enqueued).toEqual({ queued: 0, deliveryIds: [] });
      expect(deliveriesFor(inactiveSub.id)).toEqual([]);
    });

    it("enqueues to multiple subscriptions when more than one is subscribed to the same event", async () => {
      await getAdminClient()
        .from("webhook_subscriptions")
        .update({ event_types: ["appointment.booked", "appointment.cancelled", "prescription.issued"] })
        .eq("id", subA.id);
      const rx = await prescription();

      const enqueued = await enqueueWebhookEvent(ctxFor(tenant), "prescription.issued", rx);

      expect(enqueued.queued).toBe(2);
      const subIds = psql(
        `select subscription_id from public.webhook_delivery_queue where id in (${enqueued.deliveryIds.map((i) => `'${i}'`).join(",")}) order by 1`
      );
      expect(subIds.sort()).toEqual([subA.id, subB.id].sort());
    });

    it("a database failure surfaces as EnqueueError with a fixed message; the driver's text never reaches the caller", async () => {
      const broken = {
        rpc: async () => ({ data: null, error: { code: "XX000", message: "row (Synthetic Patient, +919000000001) failed" } }),
      };
      const err = await enqueueWebhookEvent(
        // Partial test double: only `rpc` is walked.
        { db: broken as never, tenantId: tenant.tenantId },
        "prescription.issued",
        crypto.randomUUID()
      ).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(EnqueueError);
      expect((err as EnqueueError).appError.code).toBe("INTERNAL");
      expect((err as Error).message).toBe("Failed to queue the webhook event.");
    });

    it("the test ping is queued (queued: true), creates one row for that subscription and sends nothing", async () => {
      const spies = outboundSpies();
      const result = await testPingWebhook(ctxFor(tenant), subA.id);
      await new Promise((r) => setTimeout(r, 100));
      for (const spy of spies.requests) expect(spy).not.toHaveBeenCalled();
      expect(spies.outboundFetches()).toEqual([]);
      expect(result).toEqual({ success: true, queued: true });
      const pings = psql(`select id from public.webhook_delivery_queue where subscription_id = '${subA.id}' and event_type = 'ping'`);
      expect(pings).toHaveLength(1);
      expect(deliveryRow(pings[0]).status).toBe("pending");
      expect(psql(`select count(*) from public.webhook_delivery_queue where subscription_id <> '${subA.id}' and tenant_id = '${tenant.tenantId}' and event_type = 'ping'`)).toEqual(["0"]);
    });
  });

  describe("Webhook delivery & exponential backoff (rewritten to the webhook.deliver handler)", () => {
    let tenant: SeededTenant;
    let sub: { id: string; secret: string; url: string };

    beforeAll(async () => {
      tenant = await seedTenantWithOwner("Dispatcher Test Clinic");
      sub = await subscribe(tenant.tenantId, tenant.userId, ["appointment.booked"], { host: "mock-partner.example.com", path: "/receiver" });
    });

    it("marks the row 'delivered' on HTTP 200 with response_status and latency (legacy fetch seam: headers, no redirect)", async () => {
      const id = await insertDelivery(tenant.tenantId, sub.id);
      const send = fakeFetch(() => new Response(JSON.stringify({ received: true }), { status: 200, statusText: "OK" }));

      expect(await runHandlerOnce(id, { resolve: publicDns, fetch: send })).toEqual({ outcome: "done" });
      expect(send).toHaveBeenCalledTimes(1);
      const [url, init] = send.mock.calls[0];
      expect(url).toBe(sub.url);
      expect(init?.headers).toHaveProperty("X-ClinicQ-Signature");
      expect(init?.headers).toHaveProperty("Content-Type", "application/json");
      expect(init?.redirect).toBe("manual");
      expect(init?.body).toBe(deliveryPayload(id));

      expect(deliveryRow(id)).toMatchObject({ status: "delivered", responseStatus: 200 });
      expect(psql(`select (delivered_at is not null) || '|' || (duration_ms >= 0) from public.webhook_delivery_queue where id = '${id}'`)).toEqual(["true|true"]);
    });

    it("increments retry_count and sets next_retry_at ~1 minute ahead on HTTP 500", async () => {
      const id = await insertDelivery(tenant.tenantId, sub.id);
      const send = fakeFetch(() => new Response("Server error", { status: 500 }));

      expect(await runHandlerOnce(id, { resolve: publicDns, fetch: send })).toMatchObject({ outcome: "retry", code: "http_500" });
      expect(send).toHaveBeenCalledTimes(1);
      const row = deliveryRow(id);
      expect(row).toMatchObject({ status: "pending", retryCount: 1, responseStatus: 500 });
      expect(row.dueInSeconds).toBeGreaterThanOrEqual(55);
    });

    it("marks status 'failed' after the fifth unsuccessful attempt", async () => {
      const id = await insertDelivery(tenant.tenantId, sub.id, { retry_count: 4 });
      const send = fakeFetch(() => {
        throw new Error("Network connection refused");
      });

      expect(await runHandlerOnce(id, { resolve: publicDns, fetch: send })).toMatchObject({ outcome: "dead" });
      expect(send).toHaveBeenCalledTimes(1);
      expect(deliveryRow(id)).toMatchObject({ status: "failed", retryCount: 5 });
    });

    it("immediately fails items with SSRF violations without retrying", async () => {
      const ssrfSub = await subscribe(tenant.tenantId, tenant.userId, ["appointment.booked"], { host: "10.0.0.1", path: "/evil" });
      const id = await insertDelivery(tenant.tenantId, ssrfSub.id);
      const send = fakeFetch(() => new Response("ok", { status: 200 }));

      expect(await runHandlerOnce(id, { resolve: publicDns, fetch: send })).toEqual({ outcome: "dead", code: "ssrf_blocked" });
      expect(send).not.toHaveBeenCalled();
      expect(deliveryRow(id)).toMatchObject({ status: "failed", responseStatus: 400 });
    });
  });

  describe("Deliverer transport options (V2-03 03-10: no test-environment branch)", () => {
    let tenant: SeededTenant;

    beforeAll(async () => {
      tenant = await seedTenantWithOwner("Dispatcher Options Clinic");
    });

    /** A pending delivery row for its own subscription. */
    async function queueItemFor(endpoint: string): Promise<string> {
      const url = new URL(endpoint);
      const s = await subscribe(tenant.tenantId, tenant.userId, ["appointment.booked"], { host: url.host, path: url.pathname });
      await getAdminClient().from("webhook_subscriptions").update({ endpoint_url: endpoint }).eq("id", s.id);
      return insertDelivery(tenant.tenantId, s.id);
    }

    it("fails an http:// endpoint without allowHttp inside Vitest and never sends (before: allowed by the VITEST branch)", async () => {
      const id = await queueItemFor("http://plain-partner.example.test/hook");
      const send = fakeFetch(() => new Response("ok", { status: 200 }));

      expect(await runHandlerOnce(id, { resolve: publicDns, fetch: send })).toEqual({ outcome: "dead", code: "ssrf_blocked" });

      expect(send).not.toHaveBeenCalled();
      expect(deliveryRow(id)).toMatchObject({ status: "failed", responseStatus: 400 });
    });

    it("delivers to http:// only when the caller passes allowHttp", async () => {
      const id = await queueItemFor("http://plain-partner.example.test/hook");
      const send = fakeFetch(() => new Response("ok", { status: 200 }));

      expect(await runHandlerOnce(id, { allowHttp: true, resolve: publicDns, fetch: send })).toEqual({ outcome: "done" });

      expect(send).toHaveBeenCalledTimes(1);
      expect(deliveryRow(id)).toMatchObject({ status: "delivered", responseStatus: 200 });
    });

    it("fails a hostname that resolves to a private address and never sends (before: .test hosts skipped DNS)", async () => {
      const id = await queueItemFor("https://rebind.example.test/hook");
      const send = fakeFetch(() => new Response("ok", { status: 200 }));

      expect(await runHandlerOnce(id, { resolve: privateDns, fetch: send })).toMatchObject({ outcome: "dead" });

      expect(send).not.toHaveBeenCalled();
      expect(deliveryRow(id)).toMatchObject({ status: "failed", responseStatus: 400 });
    });

    it("does not follow a redirect: a 302 to the metadata address is a failed attempt, not a delivery", async () => {
      const id = await queueItemFor("https://redirecting.example.test/hook");
      const send = fakeFetch(
        () => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } }),
      );

      expect(await runHandlerOnce(id, { resolve: publicDns, fetch: send })).toMatchObject({ outcome: "retry", code: "http_302" });

      expect(send).toHaveBeenCalledTimes(1);
      expect(send.mock.calls[0][1]?.redirect).toBe("manual");
      expect(deliveryRow(id)).toMatchObject({ status: "pending", responseStatus: 302, retryCount: 1 });
    });
  });
});
