/**
 * V2-03 03-13d: outbound webhook dispatch hardening (review E-1, E-2, E-7, E-8; triage M-XTENANT-WH, M-SSRF-DNS and
 * the 03-13d Lows). V2-04 04-03b (pitfall 9, assertions kept): every case now runs through the `webhook.deliver` job
 * handler (the only deliverer). Local stack only; every outbound attempt is either an injected transport or refused by
 * the test lane's socket guard (loopback only). All values are synthetic.
 *
 * - M-SSRF-DNS: a delivery resolves the endpoint once and connects to exactly the checked address (host = address,
 *   SNI and Host = the name). A rebinding resolver that answers public, then loopback, is consulted once.
 * - M-XTENANT-WH: tenant A's owner could insert a queue row naming tenant B's subscription before 000036 (RLS checked
 *   only the row's tenant); the insert is now refused (members cannot write the table), and a forged row written with
 *   the service role is still refused by the handler without sending (defence in depth until V2-05's composite FK).
 * - Retry cap: a row's `max_retries` cannot extend delivery attempts beyond 5 (`webhook_delivery_finish`).
 * - Test ping: at most TEST_PING_LIMIT per tenant per minute (now inside the enqueue RPC).
 * - Audit: the subscription audit row carries the endpoint's origin only, never its path or query.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { HostResolver } from "@/lib/webhooks/ssrf";
import { createWebhookSubscription, testPingWebhook, TEST_PING_LIMIT } from "@/features/webhooks/service";
import { seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { getAdminClient } from "../helpers/supabase-admin";
import { ctxFor } from "../helpers/context";
import {
  PUBLIC_IP,
  deliveryPayload,
  deliveryRow,
  insertDelivery,
  plantForgedDelivery,
  recordingRequest,
  runHandlerOnce,
  subscribe,
} from "../jobs/webhook-helpers";

/** Attempts per delivery row whatever its `max_retries` (03-13d MAX_WEBHOOK_RETRIES; now `least(max_retries, 5)`). */
const MAX_WEBHOOK_RETRIES = 5;

describe("webhook dispatch hardening (03-13d), through the webhook.deliver handler (04-03b)", () => {
  let a: SeededTenant;
  let b: SeededTenant;

  beforeAll(async () => {
    [a, b] = await Promise.all([seedTenantWithOwner("Webhook Harden A"), seedTenantWithOwner("Webhook Harden B")]);
  });

  describe("M-SSRF-DNS: the delivery connects to the checked address", () => {
    it("resolves once and pins host to the vetted address; SNI and Host stay the endpoint name", async () => {
      const sub = await subscribe(a.tenantId, a.userId, ["appointment.booked"], { host: "rebind-partner.example.test:8443", path: "/hooks/in?x=1" });
      const id = await insertDelivery(a.tenantId, sub.id);
      // Rebinding resolver: public for the check, loopback for any later lookup.
      let lookups = 0;
      const resolve: HostResolver = vi.fn(async () => (lookups++ === 0 ? [PUBLIC_IP] : ["127.0.0.1"]));
      const transport = recordingRequest(200);

      const result = await runHandlerOnce(id, { resolve, request: transport.impl });

      expect(resolve).toHaveBeenCalledTimes(1);
      expect(transport.calls).toHaveLength(1);
      expect(transport.calls[0].options).toMatchObject({
        host: PUBLIC_IP,
        port: 8443,
        path: "/hooks/in?x=1",
        method: "POST",
        servername: "rebind-partner.example.test",
        headers: expect.objectContaining({ host: "rebind-partner.example.test:8443" }),
      });
      expect(transport.calls[0].options.signal).toBeInstanceOf(AbortSignal);
      expect(transport.calls[0].body).toBe(deliveryPayload(id));
      expect(result).toEqual({ outcome: "done" });
      expect(deliveryRow(id)).toMatchObject({ status: "delivered", responseStatus: 200 });
    });

    it("with the real transport, the socket is opened to the vetted address, never to the name", async () => {
      const sub = await subscribe(a.tenantId, a.userId, ["appointment.booked"], { host: "rebind-real.example.test", path: "/hook" });
      const id = await insertDelivery(a.tenantId, sub.id);
      const connect = vi.spyOn((await import("node:net")).Socket.prototype, "connect");

      let hosts: Array<string | undefined> = [];
      try {
        await runHandlerOnce(id, { resolve: async () => [PUBLIC_IP] });
        // The lane's guard refuses the non-loopback connect; what matters is where it was aimed.
        hosts = connect.mock.calls.map((args) => {
          const first = args[0] as unknown;
          return first && typeof first === "object" ? (first as { host?: string }).host : String(args[1]);
        });
      } finally {
        connect.mockRestore();
      }
      expect(hosts).toContain(PUBLIC_IP);
      expect(hosts).not.toContain("rebind-real.example.test");
      expect(deliveryRow(id)).toMatchObject({ status: "pending", responseStatus: 500, retryCount: 1 });
    });
  });

  describe("M-XTENANT-WH: a queue row may only use its own tenant's subscription", () => {
    it("tenant A's owner can no longer insert a row naming B's subscription (42501, before: inserted)", async () => {
      const victim = await subscribe(b.tenantId, b.userId, ["payment.recorded"], { host: "victim-b.example.test", path: "/hook" });
      // The PoC from review E-1, through A's owner session.
      const { data, error } = await a.client
        .from("webhook_delivery_queue")
        .insert({
          tenant_id: a.tenantId,
          subscription_id: victim.id,
          event_type: "payment.recorded",
          payload: JSON.stringify({ forged: true }),
        })
        .select("id");
      expect(error?.code).toBe("42501");
      expect(data).toBeNull();
    });

    it("since 05-03 even the service role cannot write a row naming B's subscription (composite FK, 23503)", async () => {
      const victim = await subscribe(b.tenantId, b.userId, ["payment.recorded"], { host: "victim-b3.example.test", path: "/hook" });
      await expect(insertDelivery(a.tenantId, victim.id, { event_type: "payment.recorded" })).rejects.toThrow("insert delivery failed: 23503");
    });

    it("a forged row from before 05-03 naming B's subscription is refused by the handler without sending (pinned and fetch seams)", async () => {
      const victim = await subscribe(b.tenantId, b.userId, ["payment.recorded"], { host: "victim-b2.example.test", path: "/hook" });
      const forged = plantForgedDelivery(a.tenantId, victim.id, "payment.recorded");
      const transport = recordingRequest(200);
      const send = vi.fn(async () => new Response("ok", { status: 200 }));

      const viaPinned = await runHandlerOnce(forged, { resolve: async () => [PUBLIC_IP], request: transport.impl });

      expect(transport.calls).toHaveLength(0);
      expect(viaPinned).toEqual({ outcome: "dead", code: "subscription_tenant_mismatch" });
      expect(deliveryRow(forged)).toMatchObject({ status: "failed", responseStatus: 403 });

      // The injected-fetch seam enforces the same rule.
      const again = plantForgedDelivery(a.tenantId, victim.id);
      const viaFetch = await runHandlerOnce(again, { resolve: async () => [PUBLIC_IP], fetch: send });
      expect(send).not.toHaveBeenCalled();
      expect(viaFetch).toMatchObject({ outcome: "dead" });
      expect(deliveryRow(again)).toMatchObject({ status: "failed", responseStatus: 403 });
    });
  });

  describe("retry cap (review E-8)", () => {
    it("a row's max_retries cannot extend attempts beyond MAX_WEBHOOK_RETRIES", async () => {
      const sub = await subscribe(a.tenantId, a.userId, ["appointment.booked"], { host: "flaky.example.test", path: "/hook" });
      const id = await insertDelivery(a.tenantId, sub.id, { max_retries: 1000, retry_count: MAX_WEBHOOK_RETRIES - 1 });
      const result = await runHandlerOnce(id, { resolve: async () => [PUBLIC_IP], request: recordingRequest(503).impl });
      expect(result).toEqual({ outcome: "dead", code: "http_503" });
      expect(deliveryRow(id)).toMatchObject({ status: "failed", retryCount: MAX_WEBHOOK_RETRIES });
    });

    it("a negative retry_count is treated as zero", async () => {
      const sub = await subscribe(a.tenantId, a.userId, ["appointment.booked"], { host: "flaky2.example.test", path: "/hook" });
      const id = await insertDelivery(a.tenantId, sub.id, { retry_count: -1000 });
      const result = await runHandlerOnce(id, { resolve: async () => [PUBLIC_IP], request: recordingRequest(503).impl });
      expect(result).toMatchObject({ outcome: "retry" });
      expect(deliveryRow(id)).toMatchObject({ status: "pending", retryCount: 1 });
    });
  });

  describe("test ping and audit (03-13d Lows)", () => {
    it(`allows at most ${TEST_PING_LIMIT} test pings per tenant per minute`, async () => {
      const owner = await seedTenantWithOwner("Webhook Ping Limit");
      const sub = await subscribe(owner.tenantId, owner.userId, ["appointment.booked"], { host: "ping-partner.example.test", path: "/hook" });
      const ctx = ctxFor(owner);
      const outcomes = [];
      for (let i = 0; i < TEST_PING_LIMIT + 2; i++) outcomes.push(await testPingWebhook(ctx, sub.id));

      // The first pings are queued (delivered later by the runner); the rest are refused and queue nothing.
      for (const o of outcomes.slice(0, TEST_PING_LIMIT)) expect(o).toEqual({ success: true, queued: true });
      for (const o of outcomes.slice(TEST_PING_LIMIT)) expect(o).toEqual({ success: false, error: expect.stringMatching(/Too many attempts/) });
      const { count } = await getAdminClient()
        .from("webhook_delivery_queue")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", owner.tenantId)
        .eq("event_type", "ping");
      expect(count).toBe(TEST_PING_LIMIT);
    });

    it("the subscription audit row records the endpoint origin, never its path or query", async () => {
      const owner = await seedTenantWithOwner("Webhook Audit Origin");
      const ctx = ctxFor(owner);
      const created = await createWebhookSubscription(ctx, {
        endpointUrl: `https://${PUBLIC_IP}/hooks/receiverPathSecret?token=receiverQuerySecret`,
        eventTypes: ["appointment.booked"],
      });
      expect(created.success).toBe(true);
      const { data: rows } = await getAdminClient()
        .from("audit_logs")
        .select("metadata")
        .eq("tenant_id", owner.tenantId)
        .eq("entity_id", created.subscription!.id);
      expect(rows).toHaveLength(1);
      const text = JSON.stringify(rows);
      expect(text).toContain(`https://${PUBLIC_IP}`);
      expect(text).not.toContain("receiverPathSecret");
      expect(text).not.toContain("receiverQuerySecret");
    });
  });
});
