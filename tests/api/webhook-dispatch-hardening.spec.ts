/**
 * V2-03 03-13d: outbound webhook dispatch hardening (review E-1, E-2, E-7, E-8; triage M-XTENANT-WH, M-SSRF-DNS and
 * the 03-13d Lows). Local stack only; every outbound attempt is either an injected transport or refused by the test
 * lane's socket guard (loopback only). All values are synthetic.
 *
 * - M-SSRF-DNS: a delivery resolves the endpoint once and connects to exactly the checked address (host = address,
 *   SNI and Host = the name). A rebinding resolver that answers public, then loopback, is consulted once.
 * - M-XTENANT-WH: tenant A's owner can insert a queue row naming tenant B's subscription (RLS checks only the row's
 *   tenant); the dispatcher refuses it and nothing is sent with B's secret.
 * - Retry cap: an owner-written `max_retries` cannot extend delivery attempts beyond MAX_WEBHOOK_RETRIES.
 * - Test ping: at most TEST_PING_LIMIT per tenant per minute.
 * - Audit: the subscription audit row carries the endpoint's origin only, never its path or query.
 */
import { EventEmitter } from "node:events";
import type http from "node:http";
import type https from "node:https";
import crypto from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { dispatchWebhookQueueItem, MAX_WEBHOOK_RETRIES } from "@/lib/webhooks/dispatcher";
import type { HostResolver } from "@/lib/webhooks/ssrf";
import type { RequestImpl } from "@/lib/webhooks/transport";
import { createWebhookSubscription, testPingWebhook, TEST_PING_LIMIT } from "@/features/webhooks/service";
import { seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { getAdminClient } from "../helpers/supabase-admin";
import { ctxFor } from "../helpers/context";

const PUBLIC_IP = "93.184.216.34";

/** A request stub that records its options and answers `status` without any socket. */
function recordingRequest(status = 200) {
  const calls: https.RequestOptions[] = [];
  const bodies: string[] = [];
  const impl: RequestImpl = (options, callback) => {
    calls.push(options);
    const req = new EventEmitter() as unknown as http.ClientRequest;
    (req as unknown as { end: (b: string) => void }).end = (body: string) => {
      bodies.push(body);
      setImmediate(() => callback({ statusCode: status, destroy() {} } as unknown as http.IncomingMessage));
    };
    return req;
  };
  return { impl, calls, bodies };
}

async function subscriptionFor(tenant: SeededTenant, endpoint: string): Promise<{ id: string; secret: string }> {
  const secret = "whsec_" + crypto.randomBytes(16).toString("hex");
  const { data, error } = await getAdminClient()
    .from("webhook_subscriptions")
    .insert({
      tenant_id: tenant.tenantId,
      endpoint_url: endpoint,
      event_types: ["appointment.booked"],
      signing_secret: secret,
      is_active: true,
      created_by: tenant.userId,
    })
    .select("id")
    .single();
  expect(error).toBeNull();
  return { id: data!.id, secret };
}

async function queueRow(tenantId: string, subscriptionId: string, extra: Record<string, unknown> = {}): Promise<string> {
  const { data, error } = await getAdminClient()
    .from("webhook_delivery_queue")
    .insert({
      tenant_id: tenantId,
      subscription_id: subscriptionId,
      event_type: "appointment.booked",
      payload: JSON.stringify({ synthetic: true }),
      status: "pending",
      retry_count: 0,
      max_retries: 5,
      ...extra,
    })
    .select("id")
    .single();
  expect(error).toBeNull();
  return data!.id;
}

async function rowOf(id: string) {
  const { data } = await getAdminClient()
    .from("webhook_delivery_queue")
    .select("status, response_status, retry_count")
    .eq("id", id)
    .single();
  return data as { status: string; response_status: number | null; retry_count: number };
}

describe("webhook dispatch hardening (03-13d)", () => {
  let a: SeededTenant;
  let b: SeededTenant;

  beforeAll(async () => {
    [a, b] = await Promise.all([seedTenantWithOwner("Webhook Harden A"), seedTenantWithOwner("Webhook Harden B")]);
  });

  describe("M-SSRF-DNS: the delivery connects to the checked address", () => {
    it("resolves once and pins host to the vetted address; SNI and Host stay the endpoint name", async () => {
      const sub = await subscriptionFor(a, "https://rebind-partner.example.test:8443/hooks/in?x=1");
      const id = await queueRow(a.tenantId, sub.id);
      // Rebinding resolver: public for the check, loopback for any later lookup.
      let lookups = 0;
      const resolve: HostResolver = vi.fn(async () => (lookups++ === 0 ? [PUBLIC_IP] : ["127.0.0.1"]));
      const transport = recordingRequest(200);

      const result = await dispatchWebhookQueueItem(getAdminClient(), id, { resolve, request: transport.impl });

      expect(resolve).toHaveBeenCalledTimes(1);
      expect(transport.calls).toHaveLength(1);
      expect(transport.calls[0]).toMatchObject({
        host: PUBLIC_IP,
        port: 8443,
        path: "/hooks/in?x=1",
        method: "POST",
        servername: "rebind-partner.example.test",
        headers: expect.objectContaining({ host: "rebind-partner.example.test:8443" }),
      });
      expect(transport.calls[0].signal).toBeInstanceOf(AbortSignal);
      expect(transport.bodies).toEqual([JSON.stringify({ synthetic: true })]);
      expect(result).toMatchObject({ success: true, status: "delivered", responseStatus: 200 });
    });

    it("with the real transport, the socket is opened to the vetted address, never to the name", async () => {
      const sub = await subscriptionFor(a, "https://rebind-real.example.test/hook");
      const id = await queueRow(a.tenantId, sub.id);
      const connect = vi.spyOn((await import("node:net")).Socket.prototype, "connect");

      const result = await dispatchWebhookQueueItem(getAdminClient(), id, { resolve: async () => [PUBLIC_IP] });

      // The lane's guard refuses the non-loopback connect; what matters is where it was aimed.
      const hosts = connect.mock.calls.map((args) => {
        const first = args[0] as unknown;
        return first && typeof first === "object" ? (first as { host?: string }).host : String(args[1]);
      });
      connect.mockRestore();
      expect(hosts).toContain(PUBLIC_IP);
      expect(hosts).not.toContain("rebind-real.example.test");
      expect(result).toMatchObject({ success: false, status: "pending", responseStatus: 500 });
    });
  });

  describe("M-XTENANT-WH: a queue row may only use its own tenant's subscription", () => {
    it("tenant A's owner can insert a row naming B's subscription, and the dispatcher refuses it without sending", async () => {
      const victim = await subscriptionFor(b, "https://victim-b.example.test/hook");
      // The PoC from review E-1, through A's owner session (RLS applies).
      const { data: forged, error } = await a.client
        .from("webhook_delivery_queue")
        .insert({
          tenant_id: a.tenantId,
          subscription_id: victim.id,
          event_type: "payment.recorded",
          payload: JSON.stringify({ forged: true }),
        })
        .select("id")
        .single();
      expect(error).toBeNull();
      const transport = recordingRequest(200);
      const send = vi.fn(async () => new Response("ok", { status: 200 }));

      const viaPinned = await dispatchWebhookQueueItem(getAdminClient(), forged!.id, {
        resolve: async () => [PUBLIC_IP],
        request: transport.impl,
      });

      expect(transport.calls).toHaveLength(0);
      expect(send).not.toHaveBeenCalled();
      expect(viaPinned).toMatchObject({ success: false, status: "failed", responseStatus: 403 });
      expect(await rowOf(forged!.id)).toMatchObject({ status: "failed", response_status: 403 });

      // The injected-fetch seam enforces the same rule.
      const again = await queueRow(a.tenantId, victim.id);
      const viaFetch = await dispatchWebhookQueueItem(getAdminClient(), again, { resolve: async () => [PUBLIC_IP], fetch: send });
      expect(send).not.toHaveBeenCalled();
      expect(viaFetch).toMatchObject({ status: "failed", responseStatus: 403 });
    });
  });

  describe("retry cap (review E-8)", () => {
    it("an owner-written max_retries cannot extend attempts beyond MAX_WEBHOOK_RETRIES", async () => {
      const sub = await subscriptionFor(a, "https://flaky.example.test/hook");
      const id = await queueRow(a.tenantId, sub.id, { max_retries: 1000, retry_count: MAX_WEBHOOK_RETRIES - 1 });
      const result = await dispatchWebhookQueueItem(getAdminClient(), id, {
        resolve: async () => [PUBLIC_IP],
        request: recordingRequest(503).impl,
      });
      expect(result).toMatchObject({ status: "failed", retryCount: MAX_WEBHOOK_RETRIES });
      expect(await rowOf(id)).toMatchObject({ status: "failed", retry_count: MAX_WEBHOOK_RETRIES });
    });

    it("a negative retry_count is treated as zero", async () => {
      const sub = await subscriptionFor(a, "https://flaky2.example.test/hook");
      const id = await queueRow(a.tenantId, sub.id, { retry_count: -1000 });
      const result = await dispatchWebhookQueueItem(getAdminClient(), id, {
        resolve: async () => [PUBLIC_IP],
        request: recordingRequest(503).impl,
      });
      expect(result).toMatchObject({ status: "pending", retryCount: 1 });
    });
  });

  describe("test ping and audit (03-13d Lows)", () => {
    it(`allows at most ${TEST_PING_LIMIT} test pings per tenant per minute`, async () => {
      const owner = await seedTenantWithOwner("Webhook Ping Limit");
      const sub = await subscriptionFor(owner, "https://ping-partner.example.test/hook");
      const ctx = ctxFor(owner);
      const outcomes = [];
      for (let i = 0; i < TEST_PING_LIMIT + 2; i++) outcomes.push(await testPingWebhook(ctx, sub.id));

      // The first pings are attempted (the lane refuses their DNS, so they fail); the rest are refused unsent.
      for (const o of outcomes.slice(0, TEST_PING_LIMIT)) expect(String(o.error)).not.toMatch(/Too many attempts/);
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
