import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { POST } from "@/app/api/webhooks/messaging/[provider]/route";
import {
  verifyMsg91WebhookSecret,
  parseInboundAction,
  parseMsg91Payload,
} from "@/lib/messaging/webhook-helpers";
import * as appointmentsActions from "@/features/appointments/system";
import * as adminSupabase from "@/lib/supabase/admin";
import * as messagingModule from "@/lib/messaging";
import { NextRequest } from "next/server";

// Unit-level (mocked DB) coverage of the MSG91 webhook. The DB-backed P0-03 regression suite (cross-tenant replies,
// filter injection, 404/401 with no DB access) lives in tests/security/webhook-lockdown.spec.ts.
//
// P0-03 (V2-01, plan 01-03) changes reflected here: the webhook secret is accepted only from the
// `x-webhook-secret` header (no `?secret=`, no MSG91 auth key, no dev bypass when unset); replies resolve only via
// `replyMsgId` (the phone-number fallback is deleted); every response body is `{ ok: true }` / `{ ok: false }`.

const TEST_SECRET = "msg91-unit-test-secret";
const SECRET_HEADERS = { "content-type": "application/json", "x-webhook-secret": TEST_SECRET };
const MSG91_PARAMS = { params: Promise.resolve({ provider: "msg91" }) };
/** The synthetic recipient every correlated queue row was sent to (replies come from 919876543210). */
const PATIENT_E164 = "+919876543210";

function msg91Request(payload: unknown, headers: Record<string, string> = SECRET_HEADERS) {
  return new NextRequest("http://localhost:3000/api/webhooks/messaging/msg91", {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
}

/** Mock of the `communication_queue` → `visits` correlation reads used by the inbound reply path. */
function correlationTables(queueItem: unknown, visit: unknown) {
  const queueEq = vi.fn().mockReturnValue({
    maybeSingle: vi.fn().mockResolvedValue({ data: queueItem, error: null }),
  });
  const visitTenantEq = vi.fn().mockReturnValue({
    maybeSingle: vi.fn().mockResolvedValue({ data: visit, error: null }),
  });
  const visitIdEq = vi.fn().mockReturnValue({ eq: visitTenantEq });
  return {
    queueEq,
    visitIdEq,
    visitTenantEq,
    queueTable: { select: vi.fn().mockReturnValue({ eq: queueEq }) },
    visitSelect: vi.fn().mockReturnValue({ eq: visitIdEq }),
  };
}

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
      const dbSpy = vi.spyOn(adminSupabase, "getAdminClient");
      const res = await POST(
        msg91Request({ eventName: "Inbound" }, { "content-type": "application/json", "x-webhook-secret": "nope" }),
        MSG91_PARAMS
      );
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ ok: false });
      expect(dbSpy).not.toHaveBeenCalled();
    });
  });

  describe("2. Inbound Interactive Button Replies & Slot Release (D-04)", () => {
    const replyMsgId = "wamid.outbound-confirm-123";
    const queueItem = {
      id: "queue-msg-123",
      tenant_id: "tenant-cardio-1",
      appointment_id: "visit-confirm-123",
      recipient_phone: PATIENT_E164,
      metadata: {},
    };
    const mockAppointment = {
      id: "visit-confirm-123",
      tenant_id: "tenant-cardio-1",
      patient_id: "patient-rahul",
      doctor_id: "doc-aditi",
      scheduled_at: "2026-10-28T10:30:00.000Z",
      status: "booked",
      patient: { id: "patient-rahul", full_name: "Rahul Sharma", phone: "+919876543210" },
      metadata: {},
    };

    function buttonPayload(id: string, title: string) {
      return {
        eventName: "Inbound",
        direction: "inbound",
        customerNumber: "919876543210",
        replyMsgId,
        interactive: JSON.stringify({ button_reply: { id, title } }),
      };
    }

    it("processes [Confirm] interactive button reply correlated by replyMsgId and sends acknowledgement", async () => {
      const t = correlationTables(queueItem, mockAppointment);
      const updateStatusEq = vi.fn().mockResolvedValue({ data: null, error: null });
      const updateEq = vi.fn().mockReturnValue({ eq: updateStatusEq });
      const updateVisitSpy = vi.fn().mockReturnValue({ eq: updateEq });
      const insertAuditSpy = vi.fn().mockResolvedValue({ data: null, error: null });
      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "communication_queue") return t.queueTable;
          if (table === "visits") return { select: t.visitSelect, update: updateVisitSpy };
          if (table === "audit_logs") return { insert: insertAuditSpy };
          return {};
        }),
      };
      vi.spyOn(adminSupabase, "getAdminClient").mockReturnValue(mockSupabase as any);
      const sendWaDirectSpy = vi
        .spyOn(messagingModule, "sendDirectWhatsApp")
        .mockResolvedValue({ success: true, messageId: "wa-ack-1" } as any);

      const res = await POST(msg91Request(buttonPayload("btn_confirm", "Confirm")), MSG91_PARAMS);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });

      expect(t.queueEq).toHaveBeenCalledWith("external_message_id", replyMsgId);
      expect(t.visitIdEq).toHaveBeenCalledWith("id", "visit-confirm-123");
      expect(t.visitTenantEq).toHaveBeenCalledWith("tenant_id", "tenant-cardio-1");
      expect(updateVisitSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "confirmed",
          metadata: expect.objectContaining({ patient_confirmed: true, confirmed_via: "whatsapp_bot" }),
        })
      );
      expect(updateEq).toHaveBeenCalledWith("id", "visit-confirm-123");
      expect(updateStatusEq).toHaveBeenCalledWith("status", "booked");
      expect(insertAuditSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "appointment_confirmed_whatsapp",
          tenant_id: "tenant-cardio-1",
          entity_id: "visit-confirm-123",
        })
      );
      // AR-L1: acks go to the stored recipient number; the audit row carries no phone number.
      expect(JSON.stringify(insertAuditSpy.mock.calls)).not.toContain("9876543210");
      expect(sendWaDirectSpy).toHaveBeenCalledWith(
        PATIENT_E164,
        "appointment_confirmed_ack",
        expect.any(Object)
      );
    });

    it("processes [Cancel] interactive button reply, calls cancelAppointment, frees calendar slot, and sends ack", async () => {
      const t = correlationTables(queueItem, mockAppointment);
      const cancelSpy = vi
        .spyOn(appointmentsActions, "cancelAppointment")
        .mockResolvedValue({ success: true, appointment: mockAppointment as any });
      const insertAuditSpy = vi.fn().mockResolvedValue({ data: null, error: null });
      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "communication_queue") return t.queueTable;
          if (table === "visits") return { select: t.visitSelect };
          if (table === "audit_logs") return { insert: insertAuditSpy };
          return {};
        }),
      };
      vi.spyOn(adminSupabase, "getAdminClient").mockReturnValue(mockSupabase as any);
      const sendWaDirectSpy = vi
        .spyOn(messagingModule, "sendDirectWhatsApp")
        .mockResolvedValue({ success: true, messageId: "wa-ack-cancel" } as any);

      const res = await POST(msg91Request(buttonPayload("btn_cancel", "Cancel")), MSG91_PARAMS);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });

      expect(cancelSpy).toHaveBeenCalledWith(
        expect.objectContaining({ reason: "messaging_webhook" }),
        expect.objectContaining({ appointmentId: "visit-confirm-123", reason: "patient_whatsapp_bot" })
      );
      expect(insertAuditSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "appointment_cancelled_whatsapp",
          tenant_id: "tenant-cardio-1",
          entity_id: "visit-confirm-123",
        })
      );
      expect(sendWaDirectSpy).toHaveBeenCalledWith(
        PATIENT_E164,
        "appointment_cancelled_ack",
        expect.any(Object)
      );
    });

    it("processes [Reschedule] reply: sends the tokenized URL only by WhatsApp, never in the response", async () => {
      const t = correlationTables(queueItem, mockAppointment);
      vi.spyOn(appointmentsActions, "generateRescheduleToken").mockResolvedValue(
        "https://app.thecliniqai.com/reschedule/token-24hr-abc"
      );
      const insertNotifSpy = vi.fn().mockResolvedValue({ data: null, error: null });
      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "communication_queue") return t.queueTable;
          if (table === "visits") return { select: t.visitSelect };
          if (table === "in_app_notifications") return { insert: insertNotifSpy };
          return {};
        }),
      };
      vi.spyOn(adminSupabase, "getAdminClient").mockReturnValue(mockSupabase as any);
      const sendWaDirectSpy = vi
        .spyOn(messagingModule, "sendDirectWhatsApp")
        .mockResolvedValue({ success: true, messageId: "wa-reschedule-link" } as any);

      const res = await POST(msg91Request(buttonPayload("btn_reschedule", "Reschedule")), MSG91_PARAMS);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(JSON.parse(text)).toEqual({ ok: true });
      expect(text).not.toContain("reschedule");
      expect(text).not.toContain("token-24hr-abc");

      expect(insertNotifSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          tenant_id: "tenant-cardio-1",
          recipient_role: "receptionist",
          category: "system",
          event_type: "reschedule_requested",
        })
      );
      expect(sendWaDirectSpy).toHaveBeenCalledWith(
        PATIENT_E164,
        "appointment_reschedule_link",
        expect.objectContaining({
          message: expect.stringContaining("https://app.thecliniqai.com/reschedule/token-24hr-abc"),
        })
      );
    });
  });

  describe("3. Cancellation Gating & Multi-Tenant Isolation (Peer Review Finding 5)", () => {
    it("does NOT cancel appointments or release slots for free-text '2', 'no', or '2 days'", async () => {
      const mockAppointment = {
        id: "visit-protected-456",
        tenant_id: "tenant-1",
        patient_id: "patient-1",
        status: "booked",
        patient: { full_name: "Anita Desai", phone: "+919876543210" },
      };
      const t = correlationTables(
        { id: "q-1", tenant_id: "tenant-1", appointment_id: "visit-protected-456", recipient_phone: PATIENT_E164, metadata: {} },
        mockAppointment
      );
      const cancelSpy = vi.spyOn(appointmentsActions, "cancelAppointment");
      const insertNotifSpy = vi.fn().mockResolvedValue({ data: null, error: null });
      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "communication_queue") return t.queueTable;
          if (table === "visits") return { select: t.visitSelect };
          if (table === "in_app_notifications") return { insert: insertNotifSpy };
          return {};
        }),
      };
      vi.spyOn(adminSupabase, "getAdminClient").mockReturnValue(mockSupabase as any);
      vi.spyOn(messagingModule, "sendDirectWhatsApp").mockResolvedValue({ success: true } as any);

      for (const textInput of ["2", "no", "2 days", "No thanks"]) {
        cancelSpy.mockClear();
        insertNotifSpy.mockClear();

        const res = await POST(
          msg91Request({ customerNumber: "919876543210", replyMsgId: "wamid.q-1", text: textInput }),
          MSG91_PARAMS
        );
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true });

        // Gated: routes to conversational auto-triage instead of cancellation
        expect(cancelSpy).not.toHaveBeenCalled();
        expect(insertNotifSpy).toHaveBeenCalledWith(
          expect.objectContaining({ event_type: "inbound_whatsapp_reply", tenant_id: "tenant-1" })
        );
      }
    });

    it("never builds an .or() filter from replyMsgId and scopes the visit read to the queue row's tenant", async () => {
      const visitClinicA = {
        id: "visit-clinic-a",
        tenant_id: "tenant-clinic-a",
        patient_id: "patient-vikram",
        status: "booked",
        patient: { full_name: "Vikram", phone: "+919876543210" },
      };
      const t = correlationTables(
        { id: "queue-msg-a", tenant_id: "tenant-clinic-a", appointment_id: "visit-clinic-a", recipient_phone: PATIENT_E164, metadata: {} },
        visitClinicA
      );
      // Exact-match semantics, like PostgREST `eq`: only the stored id resolves.
      t.queueEq.mockImplementation((_col: string, value: string) => ({
        maybeSingle: vi.fn().mockResolvedValue({
          data:
            value === "wamid.msg-outbound-clinic-a"
              ? { id: "queue-msg-a", tenant_id: "tenant-clinic-a", appointment_id: "visit-clinic-a", recipient_phone: PATIENT_E164, metadata: {} }
              : null,
          error: null,
        }),
      }));
      const orSpy = vi.fn();
      (t.queueTable.select as any).mockReturnValue({ eq: t.queueEq, or: orSpy });
      const cancelSpy = vi
        .spyOn(appointmentsActions, "cancelAppointment")
        .mockResolvedValue({ success: true, appointment: visitClinicA as any });
      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "communication_queue") return t.queueTable;
          if (table === "visits") return { select: t.visitSelect };
          if (table === "audit_logs") return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) };
          return {};
        }),
      };
      vi.spyOn(adminSupabase, "getAdminClient").mockReturnValue(mockSupabase as any);
      vi.spyOn(messagingModule, "sendDirectWhatsApp").mockResolvedValue({ success: true } as any);

      const cancelButton = JSON.stringify({ button_reply: { id: "btn_cancel", title: "Cancel" } });
      const injected = "wamid.msg-outbound-clinic-a,metadata->>message_id.neq.x";
      const injectedRes = await POST(
        msg91Request({ customerNumber: "919876543210", replyMsgId: injected, interactive: cancelButton }),
        MSG91_PARAMS
      );
      expect(injectedRes.status).toBe(200);
      expect(await injectedRes.json()).toEqual({ ok: true });
      // The raw value is bound as a single equality operand; it is never parsed as a filter.
      expect(t.queueEq).toHaveBeenCalledWith("external_message_id", injected);
      expect(cancelSpy).not.toHaveBeenCalled();

      const res = await POST(
        msg91Request({
          customerNumber: "919876543210",
          replyMsgId: "wamid.msg-outbound-clinic-a",
          interactive: cancelButton,
        }),
        MSG91_PARAMS
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });

      expect(orSpy).not.toHaveBeenCalled();
      expect(t.visitTenantEq).toHaveBeenCalledWith("tenant_id", "tenant-clinic-a");
      expect(cancelSpy).toHaveBeenCalledTimes(1);
      expect(cancelSpy).toHaveBeenCalledWith(
        expect.objectContaining({ reason: "messaging_webhook" }),
        expect.objectContaining({ appointmentId: "visit-clinic-a", reason: "patient_whatsapp_bot" })
      );
    });

    it("does not fall back to a phone-number lookup when replyMsgId is missing or unknown", async () => {
      const queueEq = vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      });
      const patientsSpy = vi.fn();
      const visitsSpy = vi.fn();
      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "communication_queue") return { select: vi.fn().mockReturnValue({ eq: queueEq }) };
          if (table === "patients") return patientsSpy();
          if (table === "visits") return visitsSpy();
          return {};
        }),
      };
      vi.spyOn(adminSupabase, "getAdminClient").mockReturnValue(mockSupabase as any);
      const cancelSpy = vi.spyOn(appointmentsActions, "cancelAppointment");
      const sendSpy = vi.spyOn(messagingModule, "sendDirectWhatsApp").mockResolvedValue({ success: true } as any);

      const button = JSON.stringify({ button_reply: { id: "btn_cancel", title: "Cancel" } });
      for (const payload of [
        { customerNumber: "919876543210", interactive: button },
        { customerNumber: "919876543210", replyMsgId: "wamid.unknown", interactive: button },
      ]) {
        const res = await POST(msg91Request(payload), MSG91_PARAMS);
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true });
      }

      expect(patientsSpy).not.toHaveBeenCalled();
      expect(visitsSpy).not.toHaveBeenCalled();
      expect(cancelSpy).not.toHaveBeenCalled();
      expect(sendSpy).toHaveBeenCalledWith("919876543210", "bot_not_found", expect.any(Object));
    });
  });

  describe("4. Conversational Auto-Triage & Receptionist Alerting (D-05)", () => {
    it("handles a conversational reply, sends polite triage reply, and creates system category alert", async () => {
      const mockAppointment = {
        id: "visit-triage-789",
        tenant_id: "tenant-skin-clinic",
        patient_id: "patient-priya",
        status: "booked",
        patient: { full_name: "Priya Nair", phone: "+919876543210" },
      };
      const t = correlationTables(
        { id: "q-789", tenant_id: "tenant-skin-clinic", appointment_id: "visit-triage-789", recipient_phone: PATIENT_E164, metadata: {} },
        mockAppointment
      );
      const insertNotifSpy = vi.fn().mockResolvedValue({ data: null, error: null });
      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "communication_queue") return t.queueTable;
          if (table === "visits") return { select: t.visitSelect };
          if (table === "in_app_notifications") return { insert: insertNotifSpy };
          return {};
        }),
      };
      vi.spyOn(adminSupabase, "getAdminClient").mockReturnValue(mockSupabase as any);
      const sendWaDirectSpy = vi
        .spyOn(messagingModule, "sendDirectWhatsApp")
        .mockResolvedValue({ success: true, messageId: "wa-triage-ack" } as any);

      const res = await POST(
        msg91Request({
          customerNumber: "919876543210",
          context: { id: "wamid.q-789" },
          text: "Is Dr. Rao available earlier on Wednesday?",
        }),
        MSG91_PARAMS
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect(t.queueEq).toHaveBeenCalledWith("external_message_id", "wamid.q-789");

      expect(insertNotifSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          tenant_id: "tenant-skin-clinic",
          recipient_role: "receptionist",
          category: "system",
          event_type: "inbound_whatsapp_reply",
          message: expect.stringContaining("Is Dr. Rao available earlier on Wednesday?"),
        })
      );
      expect(sendWaDirectSpy).toHaveBeenCalledWith(
        PATIENT_E164,
        "conversational_triage",
        expect.objectContaining({
          message: expect.stringContaining("received your message and our reception desk will assist you shortly"),
        })
      );
    });
  });

  describe("5. Delivery Reports (DLR) Lifecycle Tracking (D-06, Peer Review Findings 3, 4, 6)", () => {
    function dlrSupabase(queueItem: unknown, extra: Record<string, unknown> = {}) {
      const updateEq = vi.fn().mockResolvedValue({ data: null, error: null });
      const updateQueueSpy = vi.fn().mockReturnValue({ eq: updateEq });
      const selectEq = vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({ data: queueItem, error: null }),
      });
      const insertAuditSpy = vi.fn().mockResolvedValue({ data: null, error: null });
      const supabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "communication_queue") {
            return { select: vi.fn().mockReturnValue({ eq: selectEq }), update: updateQueueSpy };
          }
          if (table === "audit_logs") return { insert: insertAuditSpy };
          if (table in extra) return extra[table];
          return {};
        }),
      };
      vi.spyOn(adminSupabase, "getAdminClient").mockReturnValue(supabase as any);
      return { updateQueueSpy, updateEq, selectEq, insertAuditSpy };
    }

    it("processes Delivered DLR event, updates queue status, and logs audit event", async () => {
      const m = dlrSupabase({
        id: "queue-row-101",
        tenant_id: "tenant-100",
        status: "sent",
        external_message_id: "req-dlr-101",
        recipient_phone: "+919876543210",
        metadata: { dispatched_at: "2026-10-28T07:00:00.000Z" },
      });

      const res = await POST(
        msg91Request({
          eventName: "On Delivered Event",
          direction: "outbound",
          status: "Delivered",
          request_id: "req-dlr-101",
          delivered_at: "1711086185",
        }),
        MSG91_PARAMS
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });

      expect(m.selectEq).toHaveBeenCalledWith("external_message_id", "req-dlr-101");
      expect(m.updateQueueSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "delivered",
          metadata: expect.objectContaining({ delivered_at: "1711086185" }),
        })
      );
      expect(m.updateEq).toHaveBeenCalledWith("id", "queue-row-101");
      expect(m.insertAuditSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "communication_dlr_delivered",
          tenant_id: "tenant-100",
          entity_type: "communication_queue",
          entity_id: "queue-row-101",
        })
      );
    });

    it("processes Read DLR event, updates queue status to read, and logs audit event", async () => {
      const m = dlrSupabase({
        id: "queue-row-102",
        tenant_id: "tenant-100",
        status: "delivered",
        external_message_id: "req-dlr-102",
        recipient_phone: "+919876543210",
        metadata: { delivered_at: "1711086185" },
      });

      const res = await POST(
        msg91Request({ direction: "outbound", status: "Read", request_id: "req-dlr-102", read_at: "1711086200" }),
        MSG91_PARAMS
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });

      expect(m.updateQueueSpy).toHaveBeenCalledWith(
        expect.objectContaining({ status: "read", metadata: expect.objectContaining({ read_at: "1711086200" }) })
      );
      expect(m.insertAuditSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "communication_dlr_read",
          tenant_id: "tenant-100",
          entity_type: "communication_queue",
        })
      );
    });

    it("preserves monotonic progression: does NOT regress status from 'read' to 'delivered' on late delivery event", async () => {
      const m = dlrSupabase({
        id: "queue-row-103",
        tenant_id: "tenant-100",
        status: "read",
        external_message_id: "req-dlr-103",
        recipient_phone: "+919876543210",
        metadata: { read_at: "1711086200" },
      });

      const res = await POST(
        msg91Request({
          direction: "outbound",
          status: "Delivered",
          request_id: "req-dlr-103",
          delivered_at: "1711086185",
        }),
        MSG91_PARAMS
      );
      expect(res.status).toBe(200);
      expect(m.updateQueueSpy).toHaveBeenCalledWith(expect.objectContaining({ status: "read" }));
    });

    it("processes Failed DLR event: transitions to dead_letter, clears next_retry_at, and creates system category alert", async () => {
      const insertNotifSpy = vi.fn().mockResolvedValue({ data: null, error: null });
      const m = dlrSupabase(
        {
          id: "queue-row-104",
          tenant_id: "tenant-cardio-2",
          status: "sent",
          message_type: "appointment_reminder",
          external_message_id: "req-dlr-104",
          recipient_phone: "+919876543210",
          next_retry_at: "2026-10-28T08:00:00.000Z",
        },
        { in_app_notifications: { insert: insertNotifSpy } }
      );

      const res = await POST(
        msg91Request({ direction: "outbound", status: "Failed", request_id: "req-dlr-104", reason: "Invalid Number" }),
        MSG91_PARAMS
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });

      // Critical: status = 'dead_letter' and next_retry_at = null prevents infinite retry loops
      expect(m.updateQueueSpy).toHaveBeenCalledWith(
        expect.objectContaining({ status: "dead_letter", next_retry_at: null, error_message: "Invalid Number" })
      );
      expect(m.insertAuditSpy).toHaveBeenCalledWith(
        expect.objectContaining({ action: "communication_dlr_failed", tenant_id: "tenant-cardio-2" })
      );
      // Critical: Valid notification category 'system' adheres to DB CHECK constraint 000014:97
      expect(insertNotifSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          tenant_id: "tenant-cardio-2",
          recipient_role: "receptionist",
          category: "system",
          event_type: "whatsapp_delivery_failed",
          message: expect.stringContaining("Invalid Number"),
        })
      );
    });

    it("handles DLR with missing request_id without a DB lookup or echo", async () => {
      const m = dlrSupabase(null);
      const res = await POST(msg91Request({ direction: "outbound", status: "Submitted" }), MSG91_PARAMS);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect(m.selectEq).not.toHaveBeenCalled();
    });

    it("does not echo the request id for an unknown DLR", async () => {
      const m = dlrSupabase(null);
      const res = await POST(
        msg91Request({ direction: "outbound", status: "Delivered", request_id: "req-unknown-555" }),
        MSG91_PARAMS
      );
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(JSON.parse(text)).toEqual({ ok: true });
      expect(text).not.toContain("req-unknown-555");
      expect(m.updateQueueSpy).not.toHaveBeenCalled();
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
