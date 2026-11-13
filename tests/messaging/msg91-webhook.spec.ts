import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { POST } from "@/app/api/webhooks/messaging/[provider]/route";
import {
  inboundDedupeKey,
  verifyMsg91WebhookSecret,
  parseInboundAction,
  parseMsg91Payload,
} from "@/lib/messaging/webhook-helpers";
import * as appointmentsActions from "@/features/appointments/system";
import * as systemDb from "@/lib/supabase/system";
import * as messagingModule from "@/lib/messaging";
import { NextRequest } from "next/server";
import { getAdminClient } from "../helpers/supabase-admin";
import {
  auditCount,
  botReplies,
  buttonReply,
  deleteInboundEvents,
  keyFor,
  messageJobCount,
  postMsg91,
  seedConversation,
  seedSentMessage,
  senderOf,
  useWebhookSecret,
  visitStatus,
} from "./inbound-helpers";
import { psql } from "../helpers/sql";

// MSG91 webhook (REQ-reminders-notifications, D-04, D-05, D-06). Section 1 (secret) and section 6 (parsers) are pure
// unit tests. V2-04 04-03c (P0-12, R-25): sections 2-5 run against the local stack through the real route, because the
// route now claims each callback in the inbound dedupe store, applies delivery reports in one RPC and QUEUES every bot
// reply (`communication_queue` rows with a `message.send` job) instead of sending it: the assertions read the rows
// back and the provider factory is never called by a request (before 04-03c: `sendDirectWhatsApp` spies). The DB-backed
// P0-03 regression suite (cross-tenant replies, filter injection, 404/401 with no DB access) lives in
// tests/security/webhook-lockdown.spec.ts; idempotency in tests/messaging/inbound-dedupe-db.spec.ts.
//
// P0-03 (V2-01, plan 01-03): the webhook secret is accepted only from the `x-webhook-secret` header (no `?secret=`, no
// MSG91 auth key, no dev bypass when unset); replies resolve only via `replyMsgId` (the phone-number fallback is
// deleted); every response body is `{ ok: true }` / `{ ok: false }`.

const TEST_SECRET = "msg91-unit-test-secret";
const SECRET_HEADERS = { "content-type": "application/json", "x-webhook-secret": TEST_SECRET };
const MSG91_PARAMS = { params: Promise.resolve({ provider: "msg91" }) };
const OK = { status: 200, text: JSON.stringify({ ok: true }) };

function msg91Request(payload: unknown, headers: Record<string, string> = SECRET_HEADERS) {
  return new NextRequest("http://localhost:3000/api/webhooks/messaging/msg91", {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
}

const keys: string[] = [];
function track<T>(body: T): T {
  const raw = JSON.stringify(body);
  const key = inboundDedupeKey(parseMsg91Payload(raw), raw);
  if (key) keys.push(key);
  return body;
}

afterAll(() => {
  deleteInboundEvents(keys);
});

describe("MSG91 Inbound Webhook & DLR Engine (REQ-reminders-notifications, D-04, D-05, D-06)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv, MSG91_WEBHOOK_SECRET: TEST_SECRET };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe("1. Webhook secret authentication (P0-03, SEC-19)", () => {
    it("accepts the x-webhook-secret header matching MSG91_WEBHOOK_SECRET", () => {
      expect(verifyMsg91WebhookSecret(new Headers({ "x-webhook-secret": TEST_SECRET }))).toBe(true);
    });

    it("rejects the MSG91 API auth key as a webhook credential", () => {
      process.env.MSG91_AUTH_KEY = "valid-auth-key-123";
      expect(verifyMsg91WebhookSecret(new Headers({ authkey: "valid-auth-key-123" }))).toBe(false);
      expect(
        verifyMsg91WebhookSecret(new Headers({ "x-webhook-secret": "valid-auth-key-123" }))
      ).toBe(false);
    });

    it("rejects a wrong or differently sized secret without throwing", () => {
      expect(verifyMsg91WebhookSecret(new Headers({ "x-webhook-secret": "wrong" }))).toBe(false);
      expect(
        verifyMsg91WebhookSecret(new Headers({ "x-webhook-secret": `${TEST_SECRET}-and-more` }))
      ).toBe(false);
      expect(verifyMsg91WebhookSecret(new Headers())).toBe(false);
    });

    it.each(["test", "development", "production"])(
      "rejects every request when MSG91_WEBHOOK_SECRET is unset (NODE_ENV=%s)",
      (nodeEnv) => {
        delete process.env.MSG91_WEBHOOK_SECRET;
        process.env.MSG91_AUTH_KEY = "auth-key";
        (process.env as Record<string, string>).NODE_ENV = nodeEnv;
        expect(verifyMsg91WebhookSecret(new Headers())).toBe(false);
        expect(verifyMsg91WebhookSecret(new Headers({ "x-webhook-secret": "" }))).toBe(false);
        expect(verifyMsg91WebhookSecret(new Headers({ "x-webhook-secret": "anything" }))).toBe(false);
        expect(verifyMsg91WebhookSecret(new Headers({ authkey: "auth-key" }))).toBe(false);
      }
    );

    it("returns 401 { ok: false } for a wrong secret and never opens a DB client", async () => {
      const dbSpy = vi.spyOn(systemDb, "getSystemDb");
      const res = await POST(
        msg91Request({ eventName: "Inbound" }, { "content-type": "application/json", "x-webhook-secret": "nope" }),
        MSG91_PARAMS
      );
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ ok: false });
      expect(dbSpy).not.toHaveBeenCalled();
    });
  });

  describe("2-5. Through the route on the local stack (V2-04 04-03c: replies queued, never sent)", () => {
    let providerFactory: { mock: { calls: unknown[] } };
    beforeEach(() => {
      process.env = { ...originalEnv };
      useWebhookSecret();
      providerFactory = vi.spyOn(messagingModule, "getMessagingProvider");
    });
    afterEach(() => {
      expect(providerFactory).not.toHaveBeenCalled();
      vi.unstubAllEnvs();
    });

    describe("2. Inbound Interactive Button Replies & Slot Release (D-04)", () => {
      it("[Confirm] correlated by replyMsgId confirms the visit and queues the acknowledgement to the recipient", async () => {
        const c = await seedConversation("unit-confirm");
        expect(await postMsg91(track(buttonReply(c, "btn_confirm")))).toEqual(OK);
        expect(await visitStatus(c.visitId)).toBe("confirmed");
        const replies = await botReplies(c.visitId);
        expect(replies.map((r) => [r.templateId, r.recipient, r.status])).toEqual([["appointment_confirmed_ack", c.phone, "pending"]]);
        expect(replies[0].params).toMatchObject({ message: expect.stringContaining("confirmed") });
        expect(messageJobCount(replies[0].id)).toBe(1);
        // The visit carries the bot's confirmation metadata.
        const { data } = await getAdminClient().from("visits").select("metadata").eq("id", c.visitId).single();
        expect(data?.metadata).toMatchObject({ patient_confirmed: true, confirmed_via: "whatsapp_bot" });
      });

      it("[Cancel] calls cancelAppointment, frees the slot and queues the cancellation acknowledgement", async () => {
        const c = await seedConversation("unit-cancel");
        const cancelSpy = vi.spyOn(appointmentsActions, "cancelAppointment");
        expect(await postMsg91(track(buttonReply(c, "btn_cancel")))).toEqual(OK);
        expect(cancelSpy).toHaveBeenCalledWith(
          expect.objectContaining({ reason: "messaging_webhook" }),
          expect.objectContaining({ appointmentId: c.visitId, reason: "patient_whatsapp_bot", isClinicInitiated: false })
        );
        expect(await visitStatus(c.visitId)).toBe("cancelled");
        expect(await auditCount(c.visitId, "appointment_cancelled_whatsapp")).toBe(1);
        expect((await botReplies(c.visitId)).map((r) => r.templateId)).toEqual(["appointment_cancelled_ack"]);
      });

      it("[Reschedule] queues the tokenized URL to the recipient only (never in the response) and alerts the front desk", async () => {
        const c = await seedConversation("unit-reschedule");
        const res = await postMsg91(track(buttonReply(c, "btn_reschedule")));
        expect(res).toEqual(OK);
        expect(res.text).not.toMatch(/reschedule|https?:|token/i);
        const replies = await botReplies(c.visitId);
        expect(replies.map((r) => [r.templateId, r.recipient])).toEqual([["appointment_reschedule_link", c.phone]]);
        expect(String(replies[0].params.message)).toContain("/reschedule/");
        const { count } = await getAdminClient()
          .from("in_app_notifications")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", c.tenantId)
          .eq("event_type", "reschedule_requested")
          .eq("category", "system");
        expect(count).toBe(1);
      });
    });

    describe("3. Cancellation Gating (Peer Review Finding 5)", () => {
      it.each(["2", "no", "2 days"])("free text %j does NOT cancel or release the slot (routed to triage)", async (text) => {
        const c = await seedConversation("unit-gate");
        const cancelSpy = vi.spyOn(appointmentsActions, "cancelAppointment");
        expect(
          await postMsg91(track({ uuid: crypto.randomUUID(), customerNumber: senderOf(c.phone), replyMsgId: c.replyMsgId, text }))
        ).toEqual(OK);
        expect(cancelSpy).not.toHaveBeenCalled();
        expect(await visitStatus(c.visitId)).toBe("booked");
        expect((await botReplies(c.visitId)).map((r) => r.templateId)).toEqual(["conversational_triage"]);
      });
    });

    describe("4. Conversational Auto-Triage & Receptionist Alerting (D-05)", () => {
      it("a conversational reply queues the polite triage reply and creates one system-category alert", async () => {
        const c = await seedConversation("unit-triage");
        const body = track({ uuid: crypto.randomUUID(), customerNumber: senderOf(c.phone), replyMsgId: c.replyMsgId, text: "Can I come at 4pm?" });
        expect(await postMsg91(body)).toEqual(OK);
        expect((await botReplies(c.visitId)).map((r) => [r.templateId, r.recipient])).toEqual([["conversational_triage", c.phone]]);
        const { data } = await getAdminClient()
          .from("in_app_notifications")
          .select("category, recipient_role, title")
          .eq("tenant_id", c.tenantId)
          .eq("event_type", "inbound_whatsapp_reply");
        expect(data).toEqual([expect.objectContaining({ category: "system", recipient_role: "receptionist" })]);
      });
    });

    describe("5. Delivery Reports (DLR) Lifecycle Tracking (D-06, Peer Review Findings 3, 4, 6)", () => {
      const dlr = (requestId: string, status: string, extra: Record<string, unknown> = {}) =>
        track({ direction: "outbound", status, request_id: requestId, ...extra });
      async function status(id: string) {
        const { data } = await getAdminClient().from("communication_queue").select("status, metadata").eq("id", id).single();
        return data as { status: string; metadata: Record<string, unknown> };
      }

      it("Delivered → delivered (delivered_at), one audit row; Read → read (read_at)", async () => {
        const c = await seedConversation("unit-dlr");
        const m = await seedSentMessage(c);
        expect(await postMsg91(dlr(m.requestId, "Delivered", { delivered_at: "2026-11-01T10:00:00Z" }))).toEqual(OK);
        const delivered = await status(m.id);
        expect(delivered.status).toBe("delivered");
        expect(delivered.metadata).toHaveProperty("delivered_at");
        expect(await auditCount(m.id, "communication_dlr_delivered")).toBe(1);
        expect(await postMsg91(dlr(m.requestId, "Read"))).toEqual(OK);
        const read = await status(m.id);
        expect(read.status).toBe("read");
        expect(read.metadata).toHaveProperty("read_at");
      });

      it("Failed on an urgent message → dead_letter and one system-category alert to the receptionist", async () => {
        const c = await seedConversation("unit-dlr-failed");
        const m = await seedSentMessage(c, "appointment_booked");
        expect(await postMsg91(dlr(m.requestId, "Failed", { reason: "unreachable" }))).toEqual(OK);
        expect((await status(m.id)).status).toBe("dead_letter");
        const { data } = await getAdminClient()
          .from("in_app_notifications")
          .select("category, recipient_role, title")
          .eq("tenant_id", c.tenantId)
          .eq("event_type", "whatsapp_delivery_failed");
        expect(data).toEqual([expect.objectContaining({ category: "system", recipient_role: "receptionist", title: "WhatsApp Delivery Failed" })]);
      });

      it("a DLR without request_id opens no DB client and echoes nothing", async () => {
        const dbSpy = vi.spyOn(systemDb, "getSystemDb");
        const res = await POST(msg91Request({ direction: "outbound", status: "Submitted" }, { "content-type": "application/json", "x-webhook-secret": process.env.MSG91_WEBHOOK_SECRET ?? "" }), MSG91_PARAMS);
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true });
        expect(dbSpy).not.toHaveBeenCalled();
      });

      it("does not echo the request id for an unknown DLR", async () => {
        const requestId = `req-unknown-${crypto.randomUUID()}`;
        const res = await postMsg91(dlr(requestId, "Delivered"));
        expect(res).toEqual(OK);
        expect(res.text).not.toContain(requestId);
        expect(keyFor({ direction: "outbound", status: "Delivered", request_id: requestId })).toBe(`dlr:${requestId}:delivered`);
        // 04-07a: kept for a later finish write; this spec's report never gets one.
        psql(`delete from ops.early_delivery_reports where external_message_id = '${requestId}'`);
      });
    });
  });

  describe("6. Helper Unit Tests: parseMsg91Payload & parseInboundAction", () => {
    it("distinguishes outbound DLR from inbound interaction", () => {
      const dlrJson = JSON.stringify({
        eventName: "On Delivered Event",
        direction: "outbound",
        status: "Delivered",
        request_id: "req-abc-999",
        delivered_at: "1711086185",
      });
      const parsedDlr = parseMsg91Payload(dlrJson);
      expect(parsedDlr.type).toBe("dlr");
      if (parsedDlr.type === "dlr") {
        expect(parsedDlr.status).toBe("delivered");
        expect(parsedDlr.requestId).toBe("req-abc-999");
      }

      const inboundJson = JSON.stringify({
        customerNumber: "919876543210",
        interactive: JSON.stringify({
          button_reply: { id: "btn_confirm", title: "Confirm" },
        }),
      });
      const parsedInbound = parseMsg91Payload(inboundJson);
      expect(parsedInbound.type).toBe("inbound");
      if (parsedInbound.type === "inbound") {
        expect(parsedInbound.action).toBe("confirm");
        expect(parsedInbound.buttonId).toBe("btn_confirm");
      }
    });

    it("reads only the request body (no query-string fallback) and tolerates non-object JSON", () => {
      const empty = parseMsg91Payload("");
      expect(empty.type).toBe("inbound");
      if (empty.type === "inbound") {
        expect(empty.from).toBe("");
        expect(empty.replyMsgId).toBeUndefined();
        expect(empty.action).toBe("unhandled");
      }
      expect(() => parseMsg91Payload("null")).not.toThrow();
    });

    it("parses interactive button click vs conversational text strictly", () => {
      expect(parseInboundAction("btn_confirm", true)).toBe("confirm");
      expect(parseInboundAction("btn_cancel", true)).toBe("cancel");
      expect(parseInboundAction("btn_reschedule", true)).toBe("reschedule");

      // Strictly unhandled when not a button click
      expect(parseInboundAction("no", false)).toBe("unhandled");
      expect(parseInboundAction("2", false)).toBe("unhandled");
      expect(parseInboundAction("2 days", false)).toBe("unhandled");
      expect(parseInboundAction("I want to cancel please", false)).toBe("unhandled");
    });
  });
});
