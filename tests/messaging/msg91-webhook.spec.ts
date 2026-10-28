import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GET, POST } from "@/app/api/webhooks/messaging/[provider]/route";
import {
  verifyWebhookSignature,
  parseInboundAction,
  parseMsg91Payload,
} from "@/lib/messaging/webhook-helpers";
import * as appointmentsActions from "@/features/appointments/actions";
import * as messagingModule from "@/lib/messaging";
import { NextRequest } from "next/server";

describe("MSG91 Inbound Webhook & DLR Engine (REQ-reminders-notifications, D-04, D-05, D-06)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe("1. Signature Validation & Authentication (T-05.1-04)", () => {
    it("accepts valid authkey header matching MSG91_AUTH_KEY", () => {
      process.env.MSG91_AUTH_KEY = "valid-auth-key-123";
      const headers = new Headers({ authkey: "valid-auth-key-123" });
      expect(verifyWebhookSignature("msg91", headers, "{}")).toBe(true);
    });

    it("accepts valid secret query parameter matching MSG91_WEBHOOK_SECRET", () => {
      process.env.MSG91_WEBHOOK_SECRET = "super-secret-token-456";
      const headers = new Headers();
      const searchParams = new URLSearchParams({ secret: "super-secret-token-456" });
      expect(verifyWebhookSignature("msg91", headers, "{}", searchParams)).toBe(true);
    });

    it("accepts valid x-webhook-secret header matching MSG91_WEBHOOK_SECRET", () => {
      process.env.MSG91_WEBHOOK_SECRET = "super-secret-token-456";
      const headers = new Headers({ "x-webhook-secret": "super-secret-token-456" });
      expect(verifyWebhookSignature("msg91", headers, "{}")).toBe(true);
    });

    it("rejects requests with invalid authkey or secret with HTTP 403 Forbidden", async () => {
      process.env.MSG91_AUTH_KEY = "valid-auth-key-123";
      process.env.MSG91_WEBHOOK_SECRET = "super-secret-token-456";

      const headers = new Headers({ authkey: "wrong-auth-key" });
      expect(verifyWebhookSignature("msg91", headers, "{}")).toBe(false);

      const req = new NextRequest("http://localhost:3000/api/webhooks/messaging/msg91", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authkey: "wrong-auth-key",
        },
        body: JSON.stringify({ eventName: "Inbound" }),
      });

      const res = await POST(req, { params: Promise.resolve({ provider: "msg91" }) });
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toContain("Forbidden");
    });

    it("allows dev/test environment bypass when secrets are unset and NODE_ENV !== 'production'", () => {
      delete process.env.MSG91_AUTH_KEY;
      delete process.env.MSG91_WEBHOOK_SECRET;
      process.env.NODE_ENV = "test";

      const headers = new Headers();
      expect(verifyWebhookSignature("msg91", headers, "{}")).toBe(true);
    });

    it("rejects when secrets are unset in production environment", () => {
      delete process.env.MSG91_AUTH_KEY;
      delete process.env.MSG91_WEBHOOK_SECRET;
      process.env.NODE_ENV = "production";

      const headers = new Headers();
      expect(verifyWebhookSignature("msg91", headers, "{}")).toBe(false);
    });
  });

  describe("2. Inbound Interactive Button Replies & Slot Release (D-04)", () => {
    const mockAppointment = {
      id: "visit-confirm-123",
      tenant_id: "tenant-cardio-1",
      patient_id: "patient-rahul",
      doctor_id: "doc-aditi",
      scheduled_at: "2026-10-28T10:30:00.000Z",
      status: "scheduled",
      patient: {
        id: "patient-rahul",
        full_name: "Rahul Sharma",
        phone: "+919876543210",
      },
      metadata: {},
    };

    it("processes [Confirm] interactive button reply and sends acknowledgement", async () => {
      delete process.env.MSG91_AUTH_KEY;
      delete process.env.MSG91_WEBHOOK_SECRET;

      vi.spyOn(appointmentsActions, "findActiveAppointmentByPhone").mockResolvedValue(mockAppointment as any);

      const updateVisitSpy = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: null, error: null }),
      });
      const insertAuditSpy = vi.fn().mockResolvedValue({ data: null, error: null });

      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "visits") {
            return { update: updateVisitSpy };
          }
          if (table === "audit_logs") {
            return { insert: insertAuditSpy };
          }
          if (table === "communication_queue") {
            return {
              select: vi.fn().mockReturnValue({
                or: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                }),
              }),
            };
          }
          return {};
        }),
      };
      vi.spyOn(appointmentsActions, "getAppointmentsDbClient").mockResolvedValue(mockSupabase as any);
      const sendWaDirectSpy = vi.spyOn(messagingModule, "sendDirectWhatsApp").mockResolvedValue({
        success: true,
        messageId: "wa-ack-1",
      });

      const payload = {
        eventName: "Inbound",
        direction: "inbound",
        customerNumber: "919876543210",
        interactive: JSON.stringify({
          button_reply: { id: "btn_confirm", title: "Confirm" },
        }),
      };

      const req = new NextRequest("http://localhost:3000/api/webhooks/messaging/msg91", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      const res = await POST(req, { params: Promise.resolve({ provider: "msg91" }) });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.action).toBe("confirmed");
      expect(json.appointment_id).toBe("visit-confirm-123");

      expect(updateVisitSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "confirmed",
          metadata: expect.objectContaining({
            patient_confirmed: true,
            confirmed_via: "whatsapp_bot",
          }),
        })
      );
      expect(insertAuditSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "appointment_confirmed_whatsapp",
          tenant_id: "tenant-cardio-1",
          entity_id: "visit-confirm-123",
        })
      );
      expect(sendWaDirectSpy).toHaveBeenCalledWith(
        expect.stringContaining("919876543210"),
        "appointment_confirmed_ack",
        expect.any(Object),
        undefined,
        undefined
      );
    });

    it("processes [Cancel] interactive button reply, calls cancelAppointment, frees calendar slot, and sends ack", async () => {
      delete process.env.MSG91_AUTH_KEY;
      delete process.env.MSG91_WEBHOOK_SECRET;

      vi.spyOn(appointmentsActions, "findActiveAppointmentByPhone").mockResolvedValue(mockAppointment as any);
      const cancelSpy = vi.spyOn(appointmentsActions, "cancelAppointment").mockResolvedValue({
        success: true,
        appointment: mockAppointment as any,
      });

      const insertAuditSpy = vi.fn().mockResolvedValue({ data: null, error: null });
      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "audit_logs") return { insert: insertAuditSpy };
          if (table === "communication_queue") {
            return {
              select: vi.fn().mockReturnValue({
                or: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                }),
              }),
            };
          }
          return {};
        }),
      };
      vi.spyOn(appointmentsActions, "getAppointmentsDbClient").mockResolvedValue(mockSupabase as any);
      const sendWaDirectSpy = vi.spyOn(messagingModule, "sendDirectWhatsApp").mockResolvedValue({
        success: true,
        messageId: "wa-ack-cancel",
      });

      const payload = {
        eventName: "Inbound",
        direction: "inbound",
        customerNumber: "919876543210",
        interactive: JSON.stringify({
          button_reply: { id: "btn_cancel", title: "Cancel" },
        }),
      };

      const req = new NextRequest("http://localhost:3000/api/webhooks/messaging/msg91", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      const res = await POST(req, { params: Promise.resolve({ provider: "msg91" }) });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.action).toBe("cancelled");
      expect(json.appointment_id).toBe("visit-confirm-123");

      expect(cancelSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          appointmentId: "visit-confirm-123",
          reason: "patient_whatsapp_bot",
        })
      );
      expect(insertAuditSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "appointment_cancelled_whatsapp",
          tenant_id: "tenant-cardio-1",
          entity_id: "visit-confirm-123",
        })
      );
      expect(sendWaDirectSpy).toHaveBeenCalledWith(
        expect.stringContaining("919876543210"),
        "appointment_cancelled_ack",
        expect.any(Object),
        undefined,
        undefined
      );
    });

    it("processes [Reschedule] interactive button reply and sends tokenized URL", async () => {
      delete process.env.MSG91_AUTH_KEY;
      delete process.env.MSG91_WEBHOOK_SECRET;

      vi.spyOn(appointmentsActions, "findActiveAppointmentByPhone").mockResolvedValue(mockAppointment as any);
      vi.spyOn(appointmentsActions, "generateRescheduleToken").mockResolvedValue(
        "https://app.thecliniqai.com/reschedule/token-24hr-abc"
      );

      const insertNotifSpy = vi.fn().mockResolvedValue({ data: null, error: null });
      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "in_app_notifications") return { insert: insertNotifSpy };
          if (table === "communication_queue") {
            return {
              select: vi.fn().mockReturnValue({
                or: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                }),
              }),
            };
          }
          return {};
        }),
      };
      vi.spyOn(appointmentsActions, "getAppointmentsDbClient").mockResolvedValue(mockSupabase as any);
      const sendWaDirectSpy = vi.spyOn(messagingModule, "sendDirectWhatsApp").mockResolvedValue({
        success: true,
        messageId: "wa-reschedule-link",
      });

      const payload = {
        eventName: "Inbound",
        direction: "inbound",
        customerNumber: "919876543210",
        interactive: JSON.stringify({
          button_reply: { id: "btn_reschedule", title: "Reschedule" },
        }),
      };

      const req = new NextRequest("http://localhost:3000/api/webhooks/messaging/msg91", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      const res = await POST(req, { params: Promise.resolve({ provider: "msg91" }) });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.action).toBe("reschedule_link_generated");
      expect(json.reschedule_url).toContain("/reschedule/token-24hr-abc");

      expect(insertNotifSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          tenant_id: "tenant-cardio-1",
          recipient_role: "receptionist",
          category: expect.stringMatching(/^(system|queue)$/),
          event_type: "reschedule_requested",
        })
      );
      expect(sendWaDirectSpy).toHaveBeenCalledWith(
        expect.stringContaining("919876543210"),
        "appointment_reschedule_link",
        expect.objectContaining({
          message: expect.stringContaining("https://app.thecliniqai.com/reschedule/token-24hr-abc"),
        }),
        undefined,
        undefined
      );
    });
  });

  describe("3. Cancellation Gating & Multi-Tenant Isolation (Peer Review Finding 5)", () => {
    it("does NOT cancel appointments or release slots for free-text '2', 'no', or '2 days'", async () => {
      delete process.env.MSG91_AUTH_KEY;
      delete process.env.MSG91_WEBHOOK_SECRET;

      const mockAppointment = {
        id: "visit-protected-456",
        tenant_id: "tenant-1",
        patient_id: "patient-1",
        status: "scheduled",
        patient: { full_name: "Anita Desai", phone: "+919876543210" },
      };

      vi.spyOn(appointmentsActions, "findActiveAppointmentByPhone").mockResolvedValue(mockAppointment as any);
      const cancelSpy = vi.spyOn(appointmentsActions, "cancelAppointment");

      const insertNotifSpy = vi.fn().mockResolvedValue({ data: null, error: null });
      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "in_app_notifications") return { insert: insertNotifSpy };
          if (table === "communication_queue") {
            return {
              select: vi.fn().mockReturnValue({
                or: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                }),
              }),
            };
          }
          return {};
        }),
      };
      vi.spyOn(appointmentsActions, "getAppointmentsDbClient").mockResolvedValue(mockSupabase as any);
      vi.spyOn(messagingModule, "sendDirectWhatsApp").mockResolvedValue({ success: true, messageId: "wa-triage" });

      // Test loose free text variations that must NOT cancel
      const testInputs = ["2", "no", "2 days", "No thanks"];

      for (const textInput of testInputs) {
        cancelSpy.mockClear();
        insertNotifSpy.mockClear();

        const req = new NextRequest("http://localhost:3000/api/webhooks/messaging/msg91", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            customerNumber: "919876543210",
            text: textInput,
          }),
        });

        const res = await POST(req, { params: Promise.resolve({ provider: "msg91" }) });
        expect(res.status).toBe(200);
        const json = await res.json();

        // Gated: routes to conversational auto-triage instead of cancellation
        expect(json.action).toBe("conversational_triage");
        expect(cancelSpy).not.toHaveBeenCalled();
      }
    });

    it("resolves specific clinic tenant via replyMsgId correlation, preventing cross-tenant cancellation", async () => {
      delete process.env.MSG91_AUTH_KEY;
      delete process.env.MSG91_WEBHOOK_SECRET;

      // Patient Vikram has appointments at Clinic A and Clinic B
      const visitClinicA = {
        id: "visit-clinic-a",
        tenant_id: "tenant-clinic-a",
        patient_id: "patient-vikram",
        status: "scheduled",
        patient: { full_name: "Vikram", phone: "+919876543210" },
      };

      const cancelSpy = vi.spyOn(appointmentsActions, "cancelAppointment").mockResolvedValue({
        success: true,
        appointment: visitClinicA as any,
      });

      const mockQueueItem = {
        id: "queue-msg-a",
        tenant_id: "tenant-clinic-a",
        external_message_id: "wamid.msg-outbound-clinic-a",
        metadata: {
          appointment_id: "visit-clinic-a",
        },
      };

      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "communication_queue") {
            return {
              select: vi.fn().mockReturnValue({
                or: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: mockQueueItem, error: null }),
                }),
              }),
            };
          }
          if (table === "visits") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({ data: visitClinicA, error: null }),
                  }),
                }),
              }),
            };
          }
          if (table === "audit_logs") {
            return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) };
          }
          return {};
        }),
      };
      vi.spyOn(appointmentsActions, "getAppointmentsDbClient").mockResolvedValue(mockSupabase as any);
      vi.spyOn(messagingModule, "sendDirectWhatsApp").mockResolvedValue({ success: true, messageId: "wa-cancel-ack" });

      const payload = {
        eventName: "Inbound",
        direction: "inbound",
        customerNumber: "919876543210",
        replyMsgId: "wamid.msg-outbound-clinic-a",
        interactive: JSON.stringify({
          button_reply: { id: "btn_cancel", title: "Cancel" },
        }),
      };

      const req = new NextRequest("http://localhost:3000/api/webhooks/messaging/msg91", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      const res = await POST(req, { params: Promise.resolve({ provider: "msg91" }) });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.action).toBe("cancelled");
      expect(json.appointment_id).toBe("visit-clinic-a");

      // Verifies the cancellation was targeted strictly to tenant-clinic-a
      expect(cancelSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          appointmentId: "visit-clinic-a",
          reason: "patient_whatsapp_bot",
        })
      );
    });
  });

  describe("4. Conversational Auto-Triage & Receptionist Alerting (D-05)", () => {
    it("handles conversational query, sends polite triage reply, and creates system category alert", async () => {
      delete process.env.MSG91_AUTH_KEY;
      delete process.env.MSG91_WEBHOOK_SECRET;

      const mockAppointment = {
        id: "visit-triage-789",
        tenant_id: "tenant-skin-clinic",
        patient_id: "patient-priya",
        status: "scheduled",
        patient: { full_name: "Priya Nair", phone: "+919876543210" },
      };

      vi.spyOn(appointmentsActions, "findActiveAppointmentByPhone").mockResolvedValue(mockAppointment as any);

      const insertNotifSpy = vi.fn().mockResolvedValue({ data: null, error: null });
      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "in_app_notifications") return { insert: insertNotifSpy };
          if (table === "communication_queue") {
            return {
              select: vi.fn().mockReturnValue({
                or: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                }),
              }),
            };
          }
          return {};
        }),
      };
      vi.spyOn(appointmentsActions, "getAppointmentsDbClient").mockResolvedValue(mockSupabase as any);
      const sendWaDirectSpy = vi.spyOn(messagingModule, "sendDirectWhatsApp").mockResolvedValue({
        success: true,
        messageId: "wa-triage-ack",
      });

      const payload = {
        customerNumber: "919876543210",
        text: "Is Dr. Rao available earlier on Wednesday?",
      };

      const req = new NextRequest("http://localhost:3000/api/webhooks/messaging/msg91", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      const res = await POST(req, { params: Promise.resolve({ provider: "msg91" }) });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.action).toBe("conversational_triage");

      // Validates Event #18 inbound_whatsapp_reply alert with category: "system"
      expect(insertNotifSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          tenant_id: "tenant-skin-clinic",
          recipient_role: "receptionist",
          category: "system", // Constraint check: ('clinical', 'queue', 'billing', 'system')
          event_type: "inbound_whatsapp_reply",
          message: expect.stringContaining("Is Dr. Rao available earlier on Wednesday?"),
        })
      );

      // Validates polite triage reply dispatched to patient
      expect(sendWaDirectSpy).toHaveBeenCalledWith(
        expect.stringContaining("919876543210"),
        "conversational_triage",
        expect.objectContaining({
          message: expect.stringContaining("received your message and our reception desk will assist you shortly"),
        }),
        undefined,
        undefined
      );
    });
  });

  describe("5. Delivery Reports (DLR) Lifecycle Tracking (D-06, Peer Review Findings 3, 4, 6)", () => {
    it("processes Delivered DLR event, updates queue status, and logs audit event", async () => {
      delete process.env.MSG91_AUTH_KEY;
      delete process.env.MSG91_WEBHOOK_SECRET;

      const mockQueueItem = {
        id: "queue-row-101",
        tenant_id: "tenant-100",
        status: "sent",
        external_message_id: "req-dlr-101",
        recipient_phone: "+919876543210",
        metadata: { dispatched_at: "2026-10-28T07:00:00.000Z" },
      };

      const updateQueueSpy = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: null, error: null }),
      });
      const insertAuditSpy = vi.fn().mockResolvedValue({ data: null, error: null });

      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "communication_queue") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: mockQueueItem, error: null }),
                }),
              }),
              update: updateQueueSpy,
            };
          }
          if (table === "audit_logs") {
            return { insert: insertAuditSpy };
          }
          return {};
        }),
      };
      vi.spyOn(appointmentsActions, "getAppointmentsDbClient").mockResolvedValue(mockSupabase as any);

      const payload = {
        eventName: "On Delivered Event",
        direction: "outbound",
        status: "Delivered",
        request_id: "req-dlr-101",
        delivered_at: "1711086185",
      };

      const req = new NextRequest("http://localhost:3000/api/webhooks/messaging/msg91", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      const res = await POST(req, { params: Promise.resolve({ provider: "msg91" }) });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.event).toBe("dlr_processed");
      expect(json.status).toBe("delivered");

      expect(updateQueueSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "delivered",
          metadata: expect.objectContaining({
            delivered_at: "1711086185",
          }),
        })
      );
      expect(insertAuditSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "communication_dlr_delivered",
          tenant_id: "tenant-100",
          entity_type: "communication_queue",
          entity_id: "queue-row-101",
        })
      );
    });

    it("processes Read DLR event, updates queue status to read, and logs audit event", async () => {
      delete process.env.MSG91_AUTH_KEY;
      delete process.env.MSG91_WEBHOOK_SECRET;

      const mockQueueItem = {
        id: "queue-row-102",
        tenant_id: "tenant-100",
        status: "delivered",
        external_message_id: "req-dlr-102",
        recipient_phone: "+919876543210",
        metadata: { delivered_at: "1711086185" },
      };

      const updateQueueSpy = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: null, error: null }),
      });
      const insertAuditSpy = vi.fn().mockResolvedValue({ data: null, error: null });

      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "communication_queue") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: mockQueueItem, error: null }),
                }),
              }),
              update: updateQueueSpy,
            };
          }
          if (table === "audit_logs") {
            return { insert: insertAuditSpy };
          }
          return {};
        }),
      };
      vi.spyOn(appointmentsActions, "getAppointmentsDbClient").mockResolvedValue(mockSupabase as any);

      const payload = {
        direction: "outbound",
        status: "Read",
        request_id: "req-dlr-102",
        read_at: "1711086200",
      };

      const req = new NextRequest("http://localhost:3000/api/webhooks/messaging/msg91", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      const res = await POST(req, { params: Promise.resolve({ provider: "msg91" }) });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.event).toBe("dlr_processed");
      expect(json.status).toBe("read");

      expect(updateQueueSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "read",
          metadata: expect.objectContaining({
            read_at: "1711086200",
          }),
        })
      );
      expect(insertAuditSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "communication_dlr_read",
          tenant_id: "tenant-100",
          entity_type: "communication_queue",
        })
      );
    });

    it("preserves monotonic progression: does NOT regress status from 'read' to 'delivered' on late delivery event", async () => {
      delete process.env.MSG91_AUTH_KEY;
      delete process.env.MSG91_WEBHOOK_SECRET;

      const mockQueueItem = {
        id: "queue-row-103",
        tenant_id: "tenant-100",
        status: "read", // Already read
        external_message_id: "req-dlr-103",
        recipient_phone: "+919876543210",
        metadata: { read_at: "1711086200" },
      };

      const updateQueueSpy = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: null, error: null }),
      });

      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "communication_queue") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: mockQueueItem, error: null }),
                }),
              }),
              update: updateQueueSpy,
            };
          }
          if (table === "audit_logs") {
            return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) };
          }
          return {};
        }),
      };
      vi.spyOn(appointmentsActions, "getAppointmentsDbClient").mockResolvedValue(mockSupabase as any);

      // Late Delivered DLR arriving after Read
      const payload = {
        direction: "outbound",
        status: "Delivered",
        request_id: "req-dlr-103",
        delivered_at: "1711086185",
      };

      const req = new NextRequest("http://localhost:3000/api/webhooks/messaging/msg91", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      const res = await POST(req, { params: Promise.resolve({ provider: "msg91" }) });
      expect(res.status).toBe(200);

      // Status must remain "read"
      expect(updateQueueSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "read",
        })
      );
    });

    it("processes Failed DLR event: transitions to dead_letter, clears next_retry_at, and creates system category alert", async () => {
      delete process.env.MSG91_AUTH_KEY;
      delete process.env.MSG91_WEBHOOK_SECRET;

      const mockQueueItem = {
        id: "queue-row-104",
        tenant_id: "tenant-cardio-2",
        status: "sent",
        message_type: "appointment_reminder", // Urgent message type
        external_message_id: "req-dlr-104",
        recipient_phone: "+919876543210",
        next_retry_at: "2026-10-28T08:00:00.000Z",
      };

      const updateQueueSpy = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: null, error: null }),
      });
      const insertAuditSpy = vi.fn().mockResolvedValue({ data: null, error: null });
      const insertNotifSpy = vi.fn().mockResolvedValue({ data: null, error: null });

      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "communication_queue") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: mockQueueItem, error: null }),
                }),
              }),
              update: updateQueueSpy,
            };
          }
          if (table === "audit_logs") return { insert: insertAuditSpy };
          if (table === "in_app_notifications") return { insert: insertNotifSpy };
          return {};
        }),
      };
      vi.spyOn(appointmentsActions, "getAppointmentsDbClient").mockResolvedValue(mockSupabase as any);

      const payload = {
        direction: "outbound",
        status: "Failed",
        request_id: "req-dlr-104",
        reason: "Invalid Number",
      };

      const req = new NextRequest("http://localhost:3000/api/webhooks/messaging/msg91", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      const res = await POST(req, { params: Promise.resolve({ provider: "msg91" }) });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.status).toBe("dead_letter");

      // Critical: status = 'dead_letter' and next_retry_at = null prevents infinite retry loops
      expect(updateQueueSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "dead_letter",
          next_retry_at: null,
          error_message: "Invalid Number",
        })
      );
      expect(insertAuditSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "communication_dlr_failed",
          tenant_id: "tenant-cardio-2",
        })
      );

      // Critical: Valid notification category 'system' adheres to DB CHECK constraint 000014:97
      expect(insertNotifSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          tenant_id: "tenant-cardio-2",
          recipient_role: "receptionist",
          category: "system", // Constraint check: ('clinical', 'queue', 'billing', 'system')
          event_type: "whatsapp_delivery_failed",
          message: expect.stringContaining("Invalid Number"),
        })
      );
    });

    it("handles DLR with missing request_id gracefully without throwing", async () => {
      delete process.env.MSG91_AUTH_KEY;
      delete process.env.MSG91_WEBHOOK_SECRET;

      const payload = {
        direction: "outbound",
        status: "Submitted",
      };

      const req = new NextRequest("http://localhost:3000/api/webhooks/messaging/msg91", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      const res = await POST(req, { params: Promise.resolve({ provider: "msg91" }) });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.event).toBe("dlr_ignored_no_request_id");
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
