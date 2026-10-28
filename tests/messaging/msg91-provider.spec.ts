import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Msg91Provider } from "@/lib/messaging/providers/msg91";
import {
  mapTemplateParameters,
  buildPositionalComponents,
  sanitizeParameter,
  sanitizeTemplateParameter,
  extractDocumentToken,
  extractUrlToken,
  TEMPLATE_POSITIONAL_MAP,
} from "@/lib/messaging/templates/mapping";
import { WHATSAPP_TEMPLATES } from "@/lib/messaging/templates";

describe("MSG91 Provider & Template Mapping (REQ-reminders-notifications, T-05.1-01, T-05.1-02)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // 1. Positional Variable Mapping Matrix
  // ==========================================================================
  describe("1. Positional Variable Mapping", () => {
    it("maps appointment_booked to body_1..body_4 positional variables", () => {
      const components = mapTemplateParameters("appointment_booked", {
        patient_name: "Rahul Sharma",
        doctor_name: "Dr. Aditi Rao",
        clinic_name: "Pune Care Clinic",
        appointment_time: "Wednesday, Oct 28 at 10:30 AM",
      });

      expect(components).toEqual({
        body_1: { type: "text", value: "Rahul Sharma" },
        body_2: { type: "text", value: "Dr. Aditi Rao" },
        body_3: { type: "text", value: "Pune Care Clinic" },
        body_4: { type: "text", value: "Wednesday, Oct 28 at 10:30 AM" },
      });
    });

    it("maps prescription_ready with dynamic CTA button_1 token", () => {
      const components = mapTemplateParameters("prescription_ready", {
        patient_name: "Rahul Sharma",
        doctor_name: "Dr. Aditi Rao",
        clinic_name: "Pune Care Clinic",
        token: "rx-token-abc-123",
      });

      expect(components).toEqual({
        body_1: { type: "text", value: "Rahul Sharma" },
        body_2: { type: "text", value: "Dr. Aditi Rao" },
        body_3: { type: "text", value: "Pune Care Clinic" },
        button_1: { type: "url", value: "rx-token-abc-123" },
      });
    });

    it("maps lab_report_uploaded with button_1 token", () => {
      const components = mapTemplateParameters("lab_report_uploaded", {
        patient_name: "Rahul Sharma",
        test_name: "Complete Blood Count",
        clinic_name: "Pune Care Clinic",
        token: "lab-report-456",
      });

      expect(components).toEqual({
        body_1: { type: "text", value: "Rahul Sharma" },
        body_2: { type: "text", value: "Complete Blood Count" },
        body_3: { type: "text", value: "Pune Care Clinic" },
        button_1: { type: "url", value: "lab-report-456" },
      });
    });

    it("maps referral_letter_issued with button_1 token", () => {
      const components = mapTemplateParameters("referral_letter_issued", {
        patient_name: "Rahul Sharma",
        doctor_name: "Dr. Aditi Rao",
        referred_to_name: "Dr. Suresh Patil",
        clinic_name: "Pune Care Clinic",
        token: "ref-letter-789",
      });

      expect(components).toEqual({
        body_1: { type: "text", value: "Rahul Sharma" },
        body_2: { type: "text", value: "Dr. Aditi Rao" },
        body_3: { type: "text", value: "Dr. Suresh Patil" },
        body_4: { type: "text", value: "Pune Care Clinic" },
        button_1: { type: "url", value: "ref-letter-789" },
      });
    });

    it("maps receipt_issued with button_1 token", () => {
      const components = mapTemplateParameters("receipt_issued", {
        patient_name: "Rahul Sharma",
        invoice_number: "INV-2026-0042",
        amount_inr: "500",
        clinic_name: "Pune Care Clinic",
        token: "inv-token-0042",
      });

      expect(components).toEqual({
        body_1: { type: "text", value: "Rahul Sharma" },
        body_2: { type: "text", value: "INV-2026-0042" },
        body_3: { type: "text", value: "500" },
        body_4: { type: "text", value: "Pune Care Clinic" },
        button_1: { type: "url", value: "inv-token-0042" },
      });
    });

    it("maps all 13 pre-approved templates in whatsapp-templates.json without error", () => {
      expect(WHATSAPP_TEMPLATES.length).toBe(13);

      for (const tpl of WHATSAPP_TEMPLATES) {
        expect(TEMPLATE_POSITIONAL_MAP[tpl.template_name]).toBeDefined();
        const mapping = TEMPLATE_POSITIONAL_MAP[tpl.template_name];
        expect(Array.isArray(mapping.body)).toBe(true);

        const sampleParams: Record<string, string> = {};
        for (const key of mapping.body) {
          sampleParams[key] = "test-value";
        }
        if (mapping.button_1) {
          sampleParams[mapping.button_1] = "token-test";
        }

        const components = mapTemplateParameters(tpl.template_name, sampleParams);
        expect(Object.keys(components).length).toBeGreaterThanOrEqual(mapping.body.length);
      }
    });
  });

  // ==========================================================================
  // 2. Real Caller Parameter Aliases (Cross-AI Review Finding 2)
  // ==========================================================================
  describe("2. Real Caller Parameter Aliases", () => {
    it("maps appointment_rescheduled caller passing new_date_time to body_4", () => {
      // From features/appointments/actions.ts:187-191
      const components = mapTemplateParameters("appointment_rescheduled", {
        patient_name: "Rahul Sharma",
        doctor_name: "Doctor",
        new_date_time: "Thursday, Oct 29 at 11:00 AM",
      });

      expect(components.body_4).toEqual({
        type: "text",
        value: "Thursday, Oct 29 at 11:00 AM",
      });
      expect(components.body_3.value).toBe("Clinic"); // default clinic_name fallback
    });

    it("maps lab_report_uploaded caller passing document_title to body_2 (test_name)", () => {
      // From features/labs/actions.ts:518-523
      const components = mapTemplateParameters("lab_report_uploaded", {
        patient_name: "Rahul Sharma",
        clinic_name: "Pune Care Clinic",
        document_url: "https://app.thecliniqai.com/r/lab-abc-123",
        document_title: "Complete Blood Count",
      });

      expect(components.body_2).toEqual({
        type: "text",
        value: "Complete Blood Count",
      });
      expect(components.button_1).toEqual({
        type: "url",
        value: "lab-abc-123",
      });
    });

    it("maps referral_letter_issued caller passing specialist_name to body_3 (referred_to_name)", () => {
      // From features/referrals/actions.ts:667-672
      const components = mapTemplateParameters("referral_letter_issued", {
        patient_name: "Rahul Sharma",
        specialist_name: "Dr. Kulkarni",
        clinic_name: "Pune Care Clinic",
        document_url: "https://app.thecliniqai.com/r/ref-xyz-789",
      });

      expect(components.body_2).toEqual({
        type: "text",
        value: "Doctor", // fallback when caller omits doctor_name
      });
      expect(components.body_3).toEqual({
        type: "text",
        value: "Dr. Kulkarni",
      });
      expect(components.button_1).toEqual({
        type: "url",
        value: "ref-xyz-789",
      });
    });

    it("maps appointment_cancelled caller passing reason to body_3 (cancellation_reason)", () => {
      // From features/appointments/actions.ts:280-283
      const components = mapTemplateParameters("appointment_cancelled", {
        patient_name: "Rahul Sharma",
        reason: "Patient unwell",
      });

      expect(components.body_2).toEqual({
        type: "text",
        value: "Clinic",
      });
      expect(components.body_3).toEqual({
        type: "text",
        value: "Patient unwell",
      });
    });

    it("maps consultation_documents caller passing prescription_url and receipt_url to button_1 token", () => {
      // From features/billing/actions.ts:1250-1258
      const components = mapTemplateParameters("consultation_documents", {
        patient_name: "Rahul Sharma",
        doctor_name: "Dr. Aditi Rao",
        clinic_name: "Pune Care Clinic",
        amount: "850",
        invoice_number: "INV-2026-0043",
        prescription_url: "https://app.thecliniqai.com/r/rx-123",
        receipt_url: "https://app.thecliniqai.com/r/rcpt-123",
      });

      expect(components.body_4).toEqual({
        type: "text",
        value: "850",
      });
      expect(components.body_5).toEqual({
        type: "text",
        value: "INV-2026-0043",
      });
      expect(components.button_1).toEqual({
        type: "url",
        value: "rx-123",
      });
    });

    it("maps appointment_booked caller passing date_time to body_4 (appointment_time)", () => {
      // From features/appointments/actions.ts:110-114
      const components = mapTemplateParameters("appointment_booked", {
        patient_name: "Rahul Sharma",
        doctor_name: "Dr. Aditi Rao",
        date_time: "Wednesday, Oct 28 at 10:30 AM",
      });

      expect(components.body_4).toEqual({
        type: "text",
        value: "Wednesday, Oct 28 at 10:30 AM",
      });
    });
  });

  // ==========================================================================
  // 3. Parameter Sanitization Engine
  // ==========================================================================
  describe("3. Parameter Sanitization Engine", () => {
    it("replaces newlines with spaces and collapses whitespace", () => {
      const sanitized = sanitizeParameter("Line 1\nLine 2\r\nLine 3\r  Extra   Spaces  ");
      expect(sanitized).toBe("Line 1 Line 2 Line 3 Extra Spaces");
    });

    it("enforces Meta maximum length limits", () => {
      const longText = "A".repeat(1200);
      const sanitizedBody = sanitizeParameter(longText, "-", 1024);
      expect(sanitizedBody.length).toBe(1024);

      const sanitizedButton = sanitizeParameter(longText, "-", 128);
      expect(sanitizedButton.length).toBe(128);
    });

    it("returns deterministic non-empty fallback strings when parameter is empty or null", () => {
      expect(sanitizeParameter("", "Patient")).toBe("Patient");
      expect(sanitizeParameter(null, "Doctor")).toBe("Doctor");
      expect(sanitizeParameter(undefined, "Clinic")).toBe("Clinic");
      expect(sanitizeParameter("   ", "-")).toBe("-");
    });
  });

  // ==========================================================================
  // 4. CTA URL Button Token Extraction
  // ==========================================================================
  describe("4. CTA URL Button Token Extraction", () => {
    it("extracts token from full URLs like /r/[token] and /share/[token]", () => {
      expect(extractDocumentToken("https://app.thecliniqai.com/r/rx-token-7a8f")).toBe(
        "rx-token-7a8f"
      );
      expect(extractDocumentToken("http://localhost:3000/r/doc-xyz-999?query=param")).toBe(
        "doc-xyz-999"
      );
      expect(extractDocumentToken("/r/receipt-444")).toBe("receipt-444");
    });

    it("passes through bare tokens cleanly", () => {
      expect(extractDocumentToken("bare-token-1234")).toBe("bare-token-1234");
    });

    it("handles empty or invalid inputs with fallback", () => {
      expect(extractDocumentToken("")).toBe("-");
      // @ts-expect-error testing invalid input
      expect(extractDocumentToken(null)).toBe("-");
    });
  });

  // ==========================================================================
  // 5. Provider Sender ID Resolution (Cross-AI Review Finding 1)
  // ==========================================================================
  describe("5. Provider Sender ID Resolution", () => {
    it("resolves sender ID from options.integratedNumber", () => {
      const provider = new Msg91Provider({
        authKey: "test-auth-key",
        integratedNumber: "919876540001",
      });
      // @ts-expect-error accessing private property for test verification
      expect(provider.senderId).toBe("919876540001");
    });

    it("resolves sender ID from process.env.MSG91_INTEGRATED_NUMBER", () => {
      process.env.MSG91_INTEGRATED_NUMBER = "919876540002";
      delete process.env.MSG91_SENDER_ID;
      const provider = new Msg91Provider({ authKey: "test-auth-key" });
      // @ts-expect-error accessing private property for test verification
      expect(provider.senderId).toBe("919876540002");
    });

    it("falls back to process.env.MSG91_SENDER_ID if integrated number is not set", () => {
      delete process.env.MSG91_INTEGRATED_NUMBER;
      process.env.MSG91_SENDER_ID = "919876540003";
      const provider = new Msg91Provider({ authKey: "test-auth-key" });
      // @ts-expect-error accessing private property for test verification
      expect(provider.senderId).toBe("919876540003");
    });
  });

  // ==========================================================================
  // 6. Msg91Provider Outbound template-bulk Request Structure
  // ==========================================================================
  describe("6. Msg91Provider Outbound template-bulk Request Structure", () => {
    it("dispatches to template-bulk endpoint with to_and_components and deterministic policy", async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          status: "success",
          hasError: false,
          request_id: "e03d9fe7b8304033b00c97e7c95146fa",
        }),
      });
      vi.stubGlobal("fetch", fetchSpy);

      const provider = new Msg91Provider({
        authKey: "msg91-secret-key",
        integratedNumber: "919876540000",
      });

      const result = await provider.sendWhatsApp(
        "+91 98765 43210",
        "appointment_booked",
        {
          patient_name: "Rahul Sharma",
          doctor_name: "Dr. Aditi Rao",
          clinic_name: "Pune Care Clinic",
          appointment_time: "Wednesday, Oct 28 at 10:30 AM",
        }
      );

      expect(result.success).toBe(true);
      expect(result.channelUsed).toBe("whatsapp");
      expect(result.externalMessageId).toBe("e03d9fe7b8304033b00c97e7c95146fa");

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0];

      expect(url).toBe(
        "https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/"
      );
      expect(init.method).toBe("POST");
      expect(init.headers).toEqual({
        "Content-Type": "application/json",
        authkey: "msg91-secret-key",
      });

      const body = JSON.parse(init.body);
      expect(body).toEqual({
        integrated_number: "919876540000",
        content_type: "template",
        payload: {
          type: "template",
          template: {
            name: "appointment_booked",
            language: {
              code: "en",
              policy: "deterministic",
            },
            to_and_components: [
              {
                to: ["919876543210"],
                components: {
                  body_1: { type: "text", value: "Rahul Sharma" },
                  body_2: { type: "text", value: "Dr. Aditi Rao" },
                  body_3: { type: "text", value: "Pune Care Clinic" },
                  body_4: { type: "text", value: "Wednesday, Oct 28 at 10:30 AM" },
                },
              },
            ],
          },
          messaging_product: "whatsapp",
        },
      });
    });
  });

  // ==========================================================================
  // 7. Active Session Text Endpoint Fallback
  // ==========================================================================
  describe("7. Active Session Text Endpoint Fallback", () => {
    it("routes non-catalogue templates to active session text endpoint", async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          status: "success",
          hasError: false,
          request_id: "session-req-777",
        }),
      });
      vi.stubGlobal("fetch", fetchSpy);

      const provider = new Msg91Provider({
        authKey: "msg91-secret-key",
        integratedNumber: "919876540000",
      });

      const result = await provider.sendWhatsApp(
        "919876543210",
        "appointment_confirmed_ack",
        {
          patient_name: "Rahul Sharma",
          message:
            "Thank you! Your appointment has been confirmed. We look forward to seeing you.",
        }
      );

      expect(result.success).toBe(true);
      expect(result.externalMessageId).toBe("session-req-777");

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0];

      expect(url).toBe("https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/");
      expect(init.method).toBe("POST");

      const body = JSON.parse(init.body);
      expect(body).toEqual({
        integrated_number: "919876540000",
        recipient_number: "919876543210",
        content_type: "text",
        text: "Thank you! Your appointment has been confirmed. We look forward to seeing you.",
      });
    });
  });

  // ==========================================================================
  // 8. Error & Missing Credentials Handling
  // ==========================================================================
  describe("8. Error & Missing Credentials Handling", () => {
    it("returns error when MSG91_AUTH_KEY is not configured", async () => {
      delete process.env.MSG91_AUTH_KEY;
      const provider = new Msg91Provider({ authKey: "" });
      const result = await provider.sendWhatsApp("919876543210", "appointment_booked", {});

      expect(result.success).toBe(false);
      expect(result.error).toContain("MSG91_AUTH_KEY is not configured");
    });

    it("handles HTTP 400 validation error from MSG91 API", async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({
          status: "error",
          hasError: true,
          message: "Template variable count mismatch",
        }),
      });
      vi.stubGlobal("fetch", fetchSpy);

      const provider = new Msg91Provider({
        authKey: "test-auth-key",
        integratedNumber: "919876540000",
      });

      const result = await provider.sendWhatsApp("919876543210", "appointment_booked", {});
      expect(result.success).toBe(false);
      expect(result.error).toContain("Template variable count mismatch");
      expect(result.statusCode).toBe(400);
    });

    it("handles HTTP 401 unauthorized from MSG91 API", async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({
          status: "error",
          hasError: true,
          message: "Invalid Auth Key",
        }),
      });
      vi.stubGlobal("fetch", fetchSpy);

      const provider = new Msg91Provider({
        authKey: "wrong-auth-key",
        integratedNumber: "919876540000",
      });

      const result = await provider.sendWhatsApp("919876543210", "appointment_booked", {});
      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid Auth Key");
      expect(result.statusCode).toBe(401);
    });
  });
});
