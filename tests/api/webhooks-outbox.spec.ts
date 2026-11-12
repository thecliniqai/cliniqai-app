import { describe, it, expect, beforeAll, vi } from "vitest";
import { validateWebhookEndpoint, isPrivateIp, type HostResolver } from "@/lib/webhooks/ssrf";
import { generateWebhookSignature, verifyWebhookSignature } from "@/lib/webhooks/signer";
import { enqueueWebhookEvent, type WebhookDb } from "@/lib/webhooks/outbox";
import { seedTenantWithOwner } from "../helpers/tenants";
import { getAdminClient } from "../helpers/supabase-admin";
import crypto from "crypto";

// V2-03 03-10: the SSRF check and the dispatcher have no test-environment branch; tests inject the resolver and the
// HTTP client explicitly (production callers pass nothing: https only, system DNS, global fetch).
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

  describe("Transactional Outbox Enqueueing (lib/webhooks/outbox.ts)", () => {
    let tenant: Awaited<ReturnType<typeof seedTenantWithOwner>>;
    let subA: { id: string; secret: string };
    let subB: { id: string; secret: string };
    let inactiveSub: { id: string };

    beforeAll(async () => {
      const admin = getAdminClient();
      tenant = await seedTenantWithOwner("Webhooks Outbox Test Clinic");

      // Subscription A: subscribed to appointment.*
      const secretA = "whsec_" + crypto.randomBytes(24).toString("hex");
      const { data: createdA } = await (admin.from("webhook_subscriptions") as any)
        .insert({
          tenant_id: tenant.tenantId,
          endpoint_url: "https://partner-a.example.com/webhooks",
          event_types: ["appointment.booked", "appointment.cancelled"],
          signing_secret: secretA,
          is_active: true,
          created_by: tenant.userId,
        })
        .select("id")
        .single();
      subA = { id: createdA.id, secret: secretA };

      // Subscription B: subscribed to visit.completed and prescription.issued
      const secretB = "whsec_" + crypto.randomBytes(24).toString("hex");
      const { data: createdB } = await (admin.from("webhook_subscriptions") as any)
        .insert({
          tenant_id: tenant.tenantId,
          endpoint_url: "https://partner-b.example.com/webhooks",
          event_types: ["visit.completed", "prescription.issued"],
          signing_secret: secretB,
          is_active: true,
          created_by: tenant.userId,
        })
        .select("id")
        .single();
      subB = { id: createdB.id, secret: secretB };

      // Inactive subscription: should never be enqueued
      const { data: createdInactive } = await (admin.from("webhook_subscriptions") as any)
        .insert({
          tenant_id: tenant.tenantId,
          endpoint_url: "https://partner-inactive.example.com/webhooks",
          event_types: ["appointment.booked"],
          signing_secret: "whsec_inactive",
          is_active: false,
          created_by: tenant.userId,
        })
        .select("id")
        .single();
      inactiveSub = { id: createdInactive.id };
    });

    it("enqueues queue items with exact raw TEXT payload for matching active subscriptions", async () => {
      const admin = getAdminClient();
      const payloadData = { appointment_id: "apt-test-999", patient_id: "pat-888" };

      const enqueued = await enqueueWebhookEvent(
        admin,
        tenant.tenantId,
        "appointment.booked",
        payloadData
      );

      expect(enqueued.length).toBe(1);
      expect(enqueued[0].subscription_id).toBe(subA.id);
      expect(enqueued[0].event_type).toBe("appointment.booked");
      expect(enqueued[0].status).toBe("pending");
      expect(enqueued[0].retry_count).toBe(0);
      expect(enqueued[0].max_retries).toBe(5);

      // Verify payload is stored as raw TEXT string
      expect(typeof enqueued[0].payload).toBe("string");
      const parsed = JSON.parse(enqueued[0].payload);
      expect(parsed.event).toBe("appointment.booked");
      expect(parsed.data).toEqual(payloadData);
      expect(parsed.id).toBeDefined();
    });

    it("does not enqueue events to unsubscribed or inactive subscriptions", async () => {
      const admin = getAdminClient();
      const enqueued = await enqueueWebhookEvent(
        admin,
        tenant.tenantId,
        "lab_result.ready", // Neither subA nor subB is subscribed to lab_result.ready
        { test: "no-subscribers" }
      );

      expect(enqueued.length).toBe(0);

      // Check database to ensure inactive subscription received 0 items
      const { data: inactiveQueue } = await (admin.from("webhook_delivery_queue") as any)
        .select("id")
        .eq("subscription_id", inactiveSub.id);
      expect(inactiveQueue?.length || 0).toBe(0);
    });

    it("enqueues to multiple subscriptions when more than one is subscribed to the same event", async () => {
      const admin = getAdminClient();

      // Add prescription.issued to subA as well
      await (admin.from("webhook_subscriptions") as any)
        .update({ event_types: ["appointment.booked", "appointment.cancelled", "prescription.issued"] })
        .eq("id", subA.id);

      const enqueued = await enqueueWebhookEvent(
        admin,
        tenant.tenantId,
        "prescription.issued",
        { prescription_id: "rx-multi-test" }
      );

      expect(enqueued.length).toBe(2);
      const subIds = enqueued.map((item) => item.subscription_id);
      expect(subIds).toContain(subA.id);
      expect(subIds).toContain(subB.id);
    });

    it("does not throw or fail calling context even if database error occurs", async () => {
      // Simulate broken client
      const brokenClient = {
        from: () => ({
          select: () => ({
            eq: () => ({
              eq: () => ({
                contains: async () => ({ data: null, error: new Error("Simulated DB Offline") }),
              }),
            }),
          }),
        }),
      };

      const result = await enqueueWebhookEvent(
        // Partial test double: only the query chain enqueueWebhookEvent walks before it sees the error.
        brokenClient as unknown as WebhookDb,
        "invalid-tenant-id",
        "appointment.booked",
        { dummy: "payload" }
      );

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(0);
    });
  });

  describe("Webhook Dispatcher & Exponential Backoff (Task 2)", () => {
    let tenant: Awaited<ReturnType<typeof seedTenantWithOwner>>;
    let sub: { id: string; secret: string; endpoint: string };

    beforeAll(async () => {
      const admin = getAdminClient();
      tenant = await seedTenantWithOwner("Dispatcher Test Clinic");

      const secret = "whsec_" + crypto.randomBytes(24).toString("hex");
      const { data: created } = await (admin.from("webhook_subscriptions") as any)
        .insert({
          tenant_id: tenant.tenantId,
          endpoint_url: "https://mock-partner.example.com/receiver",
          event_types: ["appointment.booked"],
          signing_secret: secret,
          is_active: true,
          created_by: tenant.userId,
        })
        .select("id")
        .single();
      sub = { id: created.id, secret, endpoint: "https://mock-partner.example.com/receiver" };
    });

    /**
     * A pending queue item inserted directly. `enqueueWebhookEvent` also starts a background dispatch of the same row
     * with the production transport (no injected fetch), which races the dispatch under test on the same row (two
     * writers, no claim; atomic claiming is V2-04). The dispatcher tests therefore insert the row themselves.
     */
    async function insertQueueItem(test: string, subscriptionId = sub.id) {
      const { data, error } = await getAdminClient()
        .from("webhook_delivery_queue")
        .insert({
          tenant_id: tenant.tenantId,
          subscription_id: subscriptionId,
          event_type: "appointment.booked",
          payload: JSON.stringify({ test }),
          status: "pending",
          retry_count: 0,
          max_retries: 5,
        })
        .select("id")
        .single();
      expect(error).toBeNull();
      return data as { id: string };
    }

    it("verifies exponential backoff delay calculation per D-10", async () => {
      const { calculateWebhookBackoff } = await import("@/lib/webhooks/dispatcher");
      expect(calculateWebhookBackoff(1)).toBe(60 * 1000); // 1 minute
      expect(calculateWebhookBackoff(2)).toBe(5 * 60 * 1000); // 5 minutes
      expect(calculateWebhookBackoff(3)).toBe(15 * 60 * 1000); // 15 minutes
      expect(calculateWebhookBackoff(4)).toBe(60 * 60 * 1000); // 1 hour
      expect(calculateWebhookBackoff(5)).toBe(6 * 60 * 60 * 1000); // 6 hours
    });

    it("marks queue item 'delivered' on HTTP 200 with response_status and latency", async () => {
      const admin = getAdminClient();
      const { dispatchWebhookQueueItem } = await import("@/lib/webhooks/dispatcher");

      const enqueued = await insertQueueItem("delivery-success");

      const send = fakeFetch(() => new Response(JSON.stringify({ received: true }), { status: 200, statusText: "OK" }));
      const result = await dispatchWebhookQueueItem(admin, enqueued.id, { resolve: publicDns, fetch: send });
      expect(send).toHaveBeenCalledTimes(1);
      const [url, init] = send.mock.calls[0];
      expect(url).toBe(sub.endpoint);
      expect(init?.headers).toHaveProperty("X-ClinicQ-Signature");
      expect(init?.headers).toHaveProperty("Content-Type", "application/json");
      expect(init?.redirect).toBe("manual");
      expect(result.success).toBe(true);
      expect(result.status).toBe("delivered");
      expect(result.responseStatus).toBe(200);
      expect(typeof result.durationMs).toBe("number");

      // Verify DB record
      const { data: updated } = await (admin.from("webhook_delivery_queue") as any)
        .select("*")
        .eq("id", enqueued.id)
        .single();
      expect(updated.status).toBe("delivered");
      expect(updated.response_status).toBe(200);
      expect(updated.delivered_at).toBeDefined();
    });

    it("increments retry_count and sets next_retry_at on HTTP 500 error", async () => {
      const admin = getAdminClient();
      const { dispatchWebhookQueueItem } = await import("@/lib/webhooks/dispatcher");

      const enqueued = await insertQueueItem("delivery-retry");

      const send = fakeFetch(() => new Response("Server error", { status: 500 }));
      const beforeDispatch = Date.now();
      const result = await dispatchWebhookQueueItem(admin, enqueued.id, { resolve: publicDns, fetch: send });
      expect(send).toHaveBeenCalledTimes(1);

      expect(result.success).toBe(false);
      expect(result.status).toBe("pending");
      expect(result.retryCount).toBe(1);
      expect(result.responseStatus).toBe(500);

      const { data: updated } = await (admin.from("webhook_delivery_queue") as any)
        .select("*")
        .eq("id", enqueued.id)
        .single();
      expect(updated.status).toBe("pending");
      expect(updated.retry_count).toBe(1);
      // next_retry_at should be ~1m in the future (backoff for retry 1)
      const nextRetryEpoch = new Date(updated.next_retry_at).getTime();
      expect(nextRetryEpoch).toBeGreaterThanOrEqual(beforeDispatch + 55000);
    });

    it("marks status as 'failed' after 5 unsuccessful retry attempts", async () => {
      const admin = getAdminClient();
      const { dispatchWebhookQueueItem } = await import("@/lib/webhooks/dispatcher");

      // Insert directly with retry_count: 4
      const { data: queueItem, error: insertErr } = await (admin.from("webhook_delivery_queue") as any)
        .insert({
          tenant_id: tenant.tenantId,
          subscription_id: sub.id,
          event_type: "appointment.booked",
          payload: JSON.stringify({ test: "exhaust-retries" }),
          status: "pending",
          retry_count: 4,
          max_retries: 5,
        })
        .select()
        .single();
      expect(insertErr).toBeNull();
      expect(queueItem).toBeDefined();

      const send = fakeFetch(() => {
        throw new Error("Network connection refused");
      });
      const result = await dispatchWebhookQueueItem(admin, queueItem.id, { resolve: publicDns, fetch: send });
      expect(send).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(false);
      expect(result.status).toBe("failed");
      expect(result.retryCount).toBe(5);

      const { data: updated } = await (admin.from("webhook_delivery_queue") as any)
        .select("*")
        .eq("id", queueItem.id)
        .single();
      expect(updated.status).toBe("failed");
      expect(updated.retry_count).toBe(5);
    });

    it("immediately fails items with SSRF violations without retrying", async () => {
      const admin = getAdminClient();
      const { dispatchWebhookQueueItem } = await import("@/lib/webhooks/dispatcher");

      // Create SSRF subscription targeting private subnet
      const { data: ssrfSub, error: ssrfErr } = await (admin.from("webhook_subscriptions") as any)
        .insert({
          tenant_id: tenant.tenantId,
          endpoint_url: "https://10.0.0.1/evil",
          event_types: ["appointment.booked"],
          signing_secret: "whsec_ssrf",
          is_active: true,
          created_by: tenant.userId,
        })
        .select("id")
        .single();
      expect(ssrfErr).toBeNull();
      expect(ssrfSub).toBeDefined();

      const enqueued = await insertQueueItem("ssrf-blocked", ssrfSub.id);

      const send = fakeFetch(() => new Response("ok", { status: 200 }));
      const result = await dispatchWebhookQueueItem(admin, enqueued.id, { resolve: publicDns, fetch: send });
      expect(send).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.status).toBe("failed");
      expect(result.responseStatus).toBe(400);

      const { data: updated } = await (admin.from("webhook_delivery_queue") as any)
        .select("*")
        .eq("id", enqueued.id)
        .single();
      expect(updated.status).toBe("failed");
      expect(updated.response_status).toBe(400);
    });
  });

  describe("Dispatcher transport options (V2-03 03-10: no test-environment branch)", () => {
    let tenant: Awaited<ReturnType<typeof seedTenantWithOwner>>;

    beforeAll(async () => {
      tenant = await seedTenantWithOwner("Dispatcher Options Clinic");
    });

    /** A pending queue item for its own subscription (inserted directly, so no other subscription is involved). */
    async function queueItemFor(endpoint: string): Promise<string> {
      const admin = getAdminClient();
      const { data: s, error: sErr } = await admin
        .from("webhook_subscriptions")
        .insert({
          tenant_id: tenant.tenantId,
          endpoint_url: endpoint,
          event_types: ["appointment.booked"],
          signing_secret: "whsec_" + crypto.randomBytes(16).toString("hex"),
          is_active: true,
          created_by: tenant.userId,
        })
        .select("id")
        .single();
      expect(sErr).toBeNull();
      const { data: q, error: qErr } = await admin
        .from("webhook_delivery_queue")
        .insert({
          tenant_id: tenant.tenantId,
          subscription_id: s!.id,
          event_type: "appointment.booked",
          payload: JSON.stringify({ test: "transport-options" }),
          status: "pending",
          retry_count: 0,
          max_retries: 5,
        })
        .select("id")
        .single();
      expect(qErr).toBeNull();
      return q!.id;
    }

    async function rowOf(id: string) {
      const { data } = await getAdminClient()
        .from("webhook_delivery_queue")
        .select("status, response_status, retry_count")
        .eq("id", id)
        .single();
      return data as { status: string; response_status: number | null; retry_count: number };
    }

    it("fails an http:// endpoint without allowHttp inside Vitest and never sends (before: allowed by the VITEST branch)", async () => {
      const { dispatchWebhookQueueItem } = await import("@/lib/webhooks/dispatcher");
      const id = await queueItemFor("http://plain-partner.example.test/hook");
      const send = fakeFetch(() => new Response("ok", { status: 200 }));

      const result = await dispatchWebhookQueueItem(getAdminClient(), id, { resolve: publicDns, fetch: send });

      expect(send).not.toHaveBeenCalled();
      expect(result).toMatchObject({ success: false, status: "failed", responseStatus: 400 });
      expect(result.error).toContain("HTTPS");
      expect(await rowOf(id)).toMatchObject({ status: "failed", response_status: 400 });
    });

    it("delivers to http:// only when the caller passes allowHttp", async () => {
      const { dispatchWebhookQueueItem } = await import("@/lib/webhooks/dispatcher");
      const id = await queueItemFor("http://plain-partner.example.test/hook");
      const send = fakeFetch(() => new Response("ok", { status: 200 }));

      const result = await dispatchWebhookQueueItem(getAdminClient(), id, {
        allowHttp: true,
        resolve: publicDns,
        fetch: send,
      });

      expect(send).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ success: true, status: "delivered", responseStatus: 200 });
    });

    it("fails a hostname that resolves to a private address and never sends (before: .test hosts skipped DNS)", async () => {
      const { dispatchWebhookQueueItem } = await import("@/lib/webhooks/dispatcher");
      const id = await queueItemFor("https://rebind.example.test/hook");
      const send = fakeFetch(() => new Response("ok", { status: 200 }));

      const result = await dispatchWebhookQueueItem(getAdminClient(), id, { resolve: privateDns, fetch: send });

      expect(send).not.toHaveBeenCalled();
      expect(result).toMatchObject({ success: false, status: "failed", responseStatus: 400 });
      expect(await rowOf(id)).toMatchObject({ status: "failed", response_status: 400 });
    });

    it("does not follow a redirect: a 302 to the metadata address is a failed attempt, not a delivery", async () => {
      const { dispatchWebhookQueueItem } = await import("@/lib/webhooks/dispatcher");
      const id = await queueItemFor("https://redirecting.example.test/hook");
      const send = fakeFetch(
        () => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } }),
      );

      const result = await dispatchWebhookQueueItem(getAdminClient(), id, { resolve: publicDns, fetch: send });

      expect(send).toHaveBeenCalledTimes(1);
      expect(send.mock.calls[0][1]?.redirect).toBe("manual");
      expect(result).toMatchObject({ success: false, status: "pending", responseStatus: 302, retryCount: 1 });
      expect(await rowOf(id)).toMatchObject({ status: "pending", response_status: 302, retry_count: 1 });
    });
  });

  describe("Webhook Cron Recovery Endpoint (Task 2)", () => {
    const originalCronSecret = process.env.CRON_SECRET;

    beforeAll(() => {
      process.env.CRON_SECRET = "test_cron_secret_777888";
    });

    afterAll(() => {
      process.env.CRON_SECRET = originalCronSecret;
    });

    it("rejects unauthorized calls missing CRON_SECRET with HTTP 401", async () => {
      const { GET: cronGet } = await import("@/app/api/cron/webhooks/route");
      const { NextRequest } = await import("next/server");

      const req = new NextRequest("http://localhost:3000/api/cron/webhooks");
      const res = await cronGet(req);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toContain("CRON_SECRET");
    });

    it("rejects unauthorized calls with invalid Bearer token with HTTP 401", async () => {
      const { POST: cronPost } = await import("@/app/api/cron/webhooks/route");
      const { NextRequest } = await import("next/server");

      const req = new NextRequest("http://localhost:3000/api/cron/webhooks", {
        method: "POST",
        headers: {
          authorization: "Bearer wrong_secret",
        },
      });
      const res = await cronPost(req);
      expect(res.status).toBe(401);
    });

    it("succeeds with valid CRON_SECRET Bearer token and returns summary with HTTP 200", async () => {
      const { GET: cronGet } = await import("@/app/api/cron/webhooks/route");
      const { NextRequest } = await import("next/server");

      const req = new NextRequest("http://localhost:3000/api/cron/webhooks", {
        headers: {
          authorization: `Bearer ${process.env.CRON_SECRET}`,
        },
      });
      const res = await cronGet(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.timestamp).toBeDefined();
      expect(typeof json.processed).toBe("number");
      expect(typeof json.delivered).toBe("number");
      expect(typeof json.retried).toBe("number");
      expect(typeof json.failed).toBe("number");
    });
  });
});
