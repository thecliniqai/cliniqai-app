import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  isQuietHours,
  calculateNextEligibleSendTime,
  evaluateMessageEligibility,
} from "@/lib/messaging/governance";
import { enqueueMessage } from "@/lib/jobs/enqueue";
import { createMessageSendHandler } from "@/lib/jobs/internal/handlers/message-send";
import type { ClaimedJob, JobContext } from "@/lib/jobs/internal/types";
import { DevLoggerProvider, type MessagingProvider } from "@/lib/messaging";
import { mockCtx } from "../helpers/context";

describe("Outbox Queue & Governance Engine (REQ-reminders-notifications, T-05-02, T-05-03)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe("1. Quiet Hours Evaluation (T-05-03)", () => {
    it("identifies 22:30 IST (10:30 PM) as quiet hours", () => {
      // 22:30 IST is 17:00 UTC
      const date = new Date("2026-10-26T17:00:00.000Z");
      expect(isQuietHours(date)).toBe(true);
    });

    it("identifies 03:00 IST (3:00 AM) as quiet hours", () => {
      // 03:00 IST is 21:30 UTC previous day
      const date = new Date("2026-10-25T21:30:00.000Z");
      expect(isQuietHours(date)).toBe(true);
    });

    it("identifies 14:00 IST (2:00 PM) as active business hours (not quiet)", () => {
      // 14:00 IST is 08:30 UTC
      const date = new Date("2026-10-26T08:30:00.000Z");
      expect(isQuietHours(date)).toBe(false);
    });

    it("calculateNextEligibleSendTime targets 08:01 IST", () => {
      const fromTime = new Date("2026-10-26T17:00:00.000Z"); // 22:30 IST
      const nextTime = calculateNextEligibleSendTime(fromTime);
      // 08:01 IST is 02:31 UTC next day
      expect(nextTime.toISOString()).toContain(":31:00.000Z");
    });
  });

  describe("2. Two-Tier Message Eligibility Governance (D-06, D-10, D-11)", () => {
    it("permits in_app notifications unconditionally without deducting from external quota", () => {
      const result = evaluateMessageEligibility({
        tenantId: "t1",
        eventType: "patient_checked_in",
        requestedChannel: "in_app",
        config: { monthly_quota: 100, messages_sent_this_month: 100 },
      });
      expect(result.eligible).toBe(true);
      expect(result.resolvedChannel).toBe("in_app");
    });

    it("suppresses non-urgent external messages when monthly quota is exhausted", () => {
      const result = evaluateMessageEligibility({
        tenantId: "t1",
        eventType: "appointment_reminder",
        requestedChannel: "whatsapp",
        isUrgent: false,
        config: { monthly_quota: 200, messages_sent_this_month: 200 },
      });
      expect(result.eligible).toBe(false);
      expect(result.reason).toBe("monthly_quota_exhausted");
    });

    it("falls back to SMS when patient opts out of WhatsApp for booking events (D-09, D-11)", () => {
      const result = evaluateMessageEligibility({
        tenantId: "t1",
        eventType: "appointment_booked",
        requestedChannel: "whatsapp",
        patientPreferences: { whatsapp_opt_out: true, preferred_language: "mr" },
        config: { sms_enabled: true, whatsapp_enabled: true },
      });
      expect(result.eligible).toBe(true);
      expect(result.resolvedChannel).toBe("sms");
      expect(result.language).toBe("mr");
    });

    it("defers non-urgent reminders during quiet hours", () => {
      // 23:00 IST
      const lateNight = new Date("2026-10-26T17:30:00.000Z");
      const result = evaluateMessageEligibility({
        tenantId: "t1",
        eventType: "appointment_reminder",
        requestedChannel: "whatsapp",
        isUrgent: false,
        now: lateNight,
      });
      expect(result.eligible).toBe(true);
      expect(result.delayUntil).toBeDefined();
    });
  });

  // V2-04 04-03a (pitfall 9 rewrite): the request only enqueues through the RPC; the message.send job sends.
  describe("3. Outbox enqueue (request path)", () => {
    it("enqueueMessage calls enqueue_message with the session tenant, returns pending, and sends nothing", async () => {
      const rpc = vi.fn().mockResolvedValue({ data: { id: "queue-123", status: "pending", deduped: false }, error: null });
      const from = vi.fn(() => {
        throw new Error("direct table access attempted");
      });
      const sendSms = vi.spyOn(DevLoggerProvider.prototype, "sendSms");
      const sendWhatsApp = vi.spyOn(DevLoggerProvider.prototype, "sendWhatsApp");
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const ctx = mockCtx({ rpc, from }, { tenantId: "00000000-0000-4000-8000-0000000000a1" });

      const item = await enqueueMessage(ctx, {
        patientId: "00000000-0000-4000-8000-00000000000b",
        channel: "whatsapp",
        messageType: "appointment_booked",
        templateId: "appointment_booked",
        recipientPhone: "+919000000012",
      });

      expect(item).toEqual({ id: "queue-123", status: "pending", deduped: false });
      expect(rpc).toHaveBeenCalledTimes(1);
      expect(rpc).toHaveBeenCalledWith(
        "enqueue_message",
        expect.objectContaining({
          p_tenant_id: "00000000-0000-4000-8000-0000000000a1",
          p_patient_id: "00000000-0000-4000-8000-00000000000b",
          p_template_id: "appointment_booked",
          p_dedupe_key: null,
        })
      );
      expect(from).not.toHaveBeenCalled();
      // Before 04-03a the row was claimed and sent inside this call.
      expect(sendSms).not.toHaveBeenCalled();
      expect(sendWhatsApp).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe("4. Send lifecycle and audit logging (T-05-02), now in the message.send handler", () => {
    function job(): ClaimedJob {
      return {
        id: "job-1",
        kind: "message.send",
        tenantId: "tenant-1",
        payload: { queue_id: "00000000-0000-4000-8000-0000000000c1" },
        attempts: 1,
        maxAttempts: 5,
        leaseToken: "lease-1",
        runAt: new Date().toISOString(),
      };
    }

    it("claims through the RPC, sends once, finishes as sent and audits without the phone", async () => {
      const claimed = {
        id: "00000000-0000-4000-8000-0000000000c1",
        tenant_id: "tenant-1",
        patient_id: null,
        appointment_id: null,
        channel: "sms",
        message_type: "appointment_reminder",
        template_id: "reminder_en",
        recipient_phone: "+919000000012",
        template_params: { patient_name: "Synthetic" },
        metadata: {},
      };
      const auditInsert = vi.fn().mockResolvedValue({ data: null, error: null });
      // AR3-N1 (000024): each row is claimed and finished through the SECURITY DEFINER RPCs, never by direct UPDATE.
      const rpc = vi.fn().mockImplementation((name: string) => {
        if (name === "communication_queue_claim") return Promise.resolve({ data: [claimed], error: null });
        if (name === "communication_queue_finish") {
          return Promise.resolve({ data: [{ new_status: "sent", new_retry_count: 0 }], error: null });
        }
        return Promise.resolve({ data: null, error: { message: "unexpected rpc" } });
      });
      const from = vi.fn().mockImplementation((table: string) => {
        if (table === "audit_logs") return { insert: auditInsert };
        throw new Error(`unexpected table ${table}`);
      });
      const sendSms = vi.fn(async () => ({ success: true, channelUsed: "sms" as const, externalMessageId: "ext-1" }));
      const provider: MessagingProvider = { name: "dev", sendSms, sendWhatsApp: vi.fn() };
      const handler = createMessageSendHandler({ provider: () => provider });
      const ctx = { db: { rpc, from }, signal: new AbortController().signal, now: () => new Date() } as unknown as JobContext;

      const result = await handler.run(job(), { queue_id: claimed.id }, ctx);

      expect(result).toEqual({ outcome: "done" });
      expect(sendSms).toHaveBeenCalledTimes(1);
      expect(rpc).toHaveBeenCalledWith("communication_queue_claim", { p_id: claimed.id });
      expect(rpc).toHaveBeenCalledWith("communication_queue_finish", {
        p_id: claimed.id,
        p_success: true,
        p_external_message_id: "ext-1",
        p_error: null,
      });
      expect(auditInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "communication_sent",
          tenant_id: "tenant-1",
          entity_id: claimed.id,
          metadata: expect.objectContaining({ queue_id: claimed.id, message_type: "appointment_reminder" }),
        })
      );
      // No recipient phone in the audit trail (01-10).
      expect(JSON.stringify(auditInsert.mock.calls[0][0])).not.toContain("9000000012");
    });
  });
});
