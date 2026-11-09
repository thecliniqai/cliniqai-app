import { describe, it, expect, beforeAll } from "vitest";
import { validateWebhookEndpoint, isPrivateIp } from "@/lib/webhooks/ssrf";
import { generateWebhookSignature, verifyWebhookSignature } from "@/lib/webhooks/signer";
import { enqueueWebhookEvent } from "@/lib/webhooks/outbox";
import { seedTenantWithOwner } from "../helpers/tenants";
import { getAdminClient } from "@/lib/supabase/admin";
import crypto from "crypto";

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
      const validResult = await validateWebhookEndpoint("https://example.com/webhook/endpoint");
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
        tenant.tenantId,
        "appointment.booked",
        payloadData,
        admin
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
        tenant.tenantId,
        "lab_result.ready", // Neither subA nor subB is subscribed to lab_result.ready
        { test: "no-subscribers" },
        admin
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
        tenant.tenantId,
        "prescription.issued",
        { prescription_id: "rx-multi-test" },
        admin
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
        "invalid-tenant-id",
        "appointment.booked",
        { dummy: "payload" },
        brokenClient
      );

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(0);
    });
  });
});
