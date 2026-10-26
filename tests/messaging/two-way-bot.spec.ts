import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  verifyWebhookSignature,
  parseInboundAction,
  GET,
  POST,
} from "@/app/api/webhooks/messaging/[provider]/route";
import * as appointmentsActions from "@/features/appointments/actions";
import { NextRequest } from "next/server";

describe("Two-Way WhatsApp Bot & Webhook Ingestion (REQ-reminders-notifications, T-05-05, T-05-07)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe("1. Webhook Signature Verification (T-05-05)", () => {
    it("allows dev provider requests without cryptographic headers", () => {
      const headers = new Headers();
      expect(verifyWebhookSignature("dev", headers, "test")).toBe(true);
    });

    it("verifies Gupshup token against configured API key", () => {
      process.env.GUPSHUP_API_KEY = "test-gupshup-key";
      const validHeaders = new Headers({ apikey: "test-gupshup-key" });
      const invalidHeaders = new Headers({ apikey: "wrong-key" });

      expect(verifyWebhookSignature("gupshup", validHeaders, "{}")).toBe(true);
      expect(verifyWebhookSignature("gupshup", invalidHeaders, "{}")).toBe(false);
    });

    it("verifies MSG91 authkey header", () => {
      process.env.MSG91_AUTH_KEY = "test-msg91-key";
      const validHeaders = new Headers({ authkey: "test-msg91-key" });
      const invalidHeaders = new Headers({ authkey: "wrong-key" });

      expect(verifyWebhookSignature("msg91", validHeaders, "{}")).toBe(true);
      expect(verifyWebhookSignature("msg91", invalidHeaders, "{}")).toBe(false);
    });
  });

  describe("2. Interactive Button & Action Parsing", () => {
    it("parses confirmation aliases", () => {
      expect(parseInboundAction("btn_confirm")).toBe("confirm");
      expect(parseInboundAction("Confirm")).toBe("confirm");
      expect(parseInboundAction("yes")).toBe("confirm");
      expect(parseInboundAction("1")).toBe("confirm");
    });

    it("parses cancellation aliases", () => {
      expect(parseInboundAction("btn_cancel")).toBe("cancel");
      expect(parseInboundAction("Cancel")).toBe("cancel");
      expect(parseInboundAction("no")).toBe("cancel");
      expect(parseInboundAction("2")).toBe("cancel");
    });

    it("parses reschedule aliases", () => {
      expect(parseInboundAction("btn_reschedule")).toBe("reschedule");
      expect(parseInboundAction("Reschedule")).toBe("reschedule");
      expect(parseInboundAction("3")).toBe("reschedule");
    });

    it("classifies conversational questions as unhandled", () => {
      expect(parseInboundAction("Can I come at 4pm instead?")).toBe("unhandled");
      expect(parseInboundAction("What is the doctor's fee?")).toBe("unhandled");
    });
  });

  describe("3. Webhook Route Handlers & Slot Release (T-05-07)", () => {
    const mockAppointment = {
      id: "visit-123",
      tenant_id: "tenant-1",
      patient_id: "patient-1",
      doctor_id: "doc-1",
      scheduled_at: "2026-10-27T10:00:00.000Z",
      patient: {
        id: "patient-1",
        full_name: "Vikram Malhotra",
        phone: "+919876543210",
      },
      metadata: {},
    };

    it("processes [Confirm] button click via GET dev simulator", async () => {
      vi.spyOn(appointmentsActions, "findActiveAppointmentByPhone").mockResolvedValue(mockAppointment as any);

      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "visits") {
            return {
              update: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
            };
          }
          if (table === "audit_logs") {
            return {
              insert: vi.fn().mockResolvedValue({ data: null, error: null }),
            };
          }
          return {};
        }),
      };
      vi.spyOn(appointmentsActions, "getAppointmentsDbClient").mockResolvedValue(mockSupabase as any);

      const req = new NextRequest(
        "http://localhost:3000/api/webhooks/messaging/dev?from=%2B919876543210&action=btn_confirm"
      );
      const res = await GET(req, { params: Promise.resolve({ provider: "dev" }) });
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.action).toBe("confirmed");
      expect(json.appointment_id).toBe("visit-123");
    });

    it("processes [Cancel] button click and releases doctor slot", async () => {
      vi.spyOn(appointmentsActions, "findActiveAppointmentByPhone").mockResolvedValue(mockAppointment as any);
      const cancelSpy = vi.spyOn(appointmentsActions, "cancelAppointment").mockResolvedValue({ success: true, appointment: {} as any });

      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          insert: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      };
      vi.spyOn(appointmentsActions, "getAppointmentsDbClient").mockResolvedValue(mockSupabase as any);

      const req = new NextRequest("http://localhost:3000/api/webhooks/messaging/dev", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          from: "+919876543210",
          action: "btn_cancel",
        }),
      });

      const res = await POST(req, { params: Promise.resolve({ provider: "dev" }) });
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.action).toBe("cancelled");
      expect(cancelSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          appointmentId: "visit-123",
          reason: "patient_whatsapp_bot",
        })
      );
    });

    it("processes [Reschedule] button click and returns tokenized link", async () => {
      vi.spyOn(appointmentsActions, "findActiveAppointmentByPhone").mockResolvedValue(mockAppointment as any);
      vi.spyOn(appointmentsActions, "generateRescheduleToken").mockResolvedValue("http://localhost:3000/reschedule/token-abc-123");

      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          insert: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      };
      vi.spyOn(appointmentsActions, "getAppointmentsDbClient").mockResolvedValue(mockSupabase as any);

      const req = new NextRequest(
        "http://localhost:3000/api/webhooks/messaging/dev?from=%2B919876543210&action=btn_reschedule"
      );
      const res = await GET(req, { params: Promise.resolve({ provider: "dev" }) });
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.action).toBe("reschedule_link_generated");
      expect(json.reschedule_url).toContain("/reschedule/token-abc-123");
    });
  });
});
