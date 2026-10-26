import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  isQuietHours,
  calculateNextEligibleSendTime,
  evaluateMessageEligibility,
} from "@/lib/messaging/governance";
import {
  calculateBackoffDelay,
  enqueueMessage,
  dispatchPendingQueue,
} from "@/lib/messaging/dispatcher";
import { GET, POST } from "@/app/api/cron/dispatch-communications/route";
import { NextRequest } from "next/server";

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

  describe("3. Outbox Queue Enqueueing & Backoff Calculation", () => {
    it("calculateBackoffDelay produces progressive backoffs", () => {
      expect(calculateBackoffDelay(1)).toBe(60000); // 1 min
      expect(calculateBackoffDelay(2)).toBe(300000); // 5 min
      expect(calculateBackoffDelay(3)).toBe(900000); // 15 min
    });

    it("enqueueMessage inserts into communication_queue with pending status", async () => {
      const mockInsert = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: {
              id: "queue-123",
              tenant_id: "tenant-1",
              channel: "whatsapp",
              message_type: "appointment_booked",
              status: "pending",
              retry_count: 0,
            },
            error: null,
          }),
        }),
      });

      const mockClient = {
        from: vi.fn().mockReturnValue({
          insert: mockInsert,
        }),
      };

      const item = await enqueueMessage(
        {
          tenantId: "tenant-1",
          patientId: "patient-1",
          channel: "whatsapp",
          messageType: "appointment_booked",
          templateId: "appointment_booked_en",
          recipientPhone: "+919876543210",
        },
        mockClient
      );

      expect(item.id).toBe("queue-123");
      expect(item.status).toBe("pending");
      expect(mockClient.from).toHaveBeenCalledWith("communication_queue");
    });
  });

  describe("4. Dispatch Lifecycle & Audit Logging (T-05-02)", () => {
    it("dispatchPendingQueue marks sent and logs audit record on delivery success", async () => {
      const pendingItem = {
        id: "msg-1",
        tenant_id: "tenant-1",
        channel: "sms",
        message_type: "appointment_reminder",
        template_id: "reminder_en",
        recipient_phone: "+919876543210",
        template_params: { patient_name: "Anita" },
        status: "pending",
        retry_count: 0,
        max_retries: 3,
      };

      const mockUpdate = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: null, error: null }),
      });
      const mockAuditInsert = vi.fn().mockResolvedValue({ data: null, error: null });

      const mockClient = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "communication_queue") {
            return {
              select: vi.fn().mockReturnValue({
                in: vi.fn().mockReturnValue({
                  lte: vi.fn().mockReturnValue({
                    order: vi.fn().mockReturnValue({
                      limit: vi.fn().mockResolvedValue({ data: [pendingItem], error: null }),
                    }),
                  }),
                }),
              }),
              update: mockUpdate,
            };
          }
          if (table === "audit_logs") {
            return {
              insert: mockAuditInsert,
            };
          }
          return {};
        }),
      };

      const summary = await dispatchPendingQueue({
        clientOverride: mockClient,
        providerName: "dev",
      });

      expect(summary.processed).toBe(1);
      expect(summary.succeeded).toBe(1);
      expect(summary.failed).toBe(0);
      expect(mockAuditInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "communication_sent",
          tenant_id: "tenant-1",
        })
      );
    });
  });

  describe("5. Cron Recovery Endpoint Security (T-05-04)", () => {
    it("rejects unauthorized request without Bearer CRON_SECRET with HTTP 401", async () => {
      process.env.CRON_SECRET = "secret-token-123";

      const req = new NextRequest("http://localhost:3000/api/cron/dispatch-communications", {
        headers: { authorization: "Bearer invalid-secret" },
      });

      const res = await GET(req);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toContain("Unauthorized");
    });

    it("accepts valid Bearer CRON_SECRET and returns dispatch summary", async () => {
      process.env.CRON_SECRET = "secret-token-123";

      const req = new NextRequest("http://localhost:3000/api/cron/dispatch-communications", {
        headers: { authorization: "Bearer secret-token-123" },
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data).toHaveProperty("processed");
    });
  });
});
