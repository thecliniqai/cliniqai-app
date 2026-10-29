import { describe, it, expect, vi } from "vitest";
import {
  sanitizePatientContextForPrompt,
  stripPiiFromText,
  containsDirectPii,
} from "@/lib/ai/sanitizer";
import { getProductHelpAnswer } from "@/lib/ai/knowledge/product-manifest";
import {
  assertRoleAllowed,
  getOperationsTools,
} from "@/lib/ai/tools/operations-tools";
import { getClinicalTools } from "@/lib/ai/tools/clinical-tools";
import {
  getAiGatewayModel,
  MockAiProvider,
  OpenAiGatewayClient,
  geminiFetchInterceptor,
  SKIP_THOUGHT_SIGNATURE_VALIDATOR,
} from "@/lib/ai/client";

describe("Phase 05.3 Gateway & Tools Foundation (REQ-ai-features, REQ-compliance-data-layer)", () => {
  describe("1. DPDP Act PII Sanitizer (T-05.3-01)", () => {
    it("strips direct patient identifiers while preserving clinical tokens", () => {
      const rawPatient = {
        id: "123e4567-e89b-12d3-a456-426614174000",
        full_name: "Amitabh Bachchan",
        name: "Amitabh",
        phone: "+919876543210",
        mobile: "9876543210",
        address: "Jalsa, JVPD Scheme, Juhu, Mumbai",
        aadhaar: "1234 5678 9012",
        abha_id: "12-3456-7890-1234",
        uhid: "UHID-2026-991",
        email: "amitabh@example.com",
        emergency_contact: "+919811122233",
        // Clinical tokens to preserve:
        age: 82,
        sex: "male",
        chronic_conditions: ["Hypertension", "Asthma"],
        vitals: { bp_systolic: 130, bp_diastolic: 85, pulse: 72 },
      };

      const sanitized = sanitizePatientContextForPrompt(rawPatient);

      // Direct PII must NOT be present
      expect((sanitized as any).full_name).toBeUndefined();
      expect((sanitized as any).name).toBeUndefined();
      expect((sanitized as any).phone).toBeUndefined();
      expect((sanitized as any).mobile).toBeUndefined();
      expect((sanitized as any).address).toBeUndefined();
      expect((sanitized as any).aadhaar).toBeUndefined();
      expect((sanitized as any).abha_id).toBeUndefined();
      expect((sanitized as any).email).toBeUndefined();

      // Clinical parameters must be preserved
      expect(sanitized.age).toBe(82);
      expect(sanitized.sex).toBe("male");
      expect(sanitized.chronic_conditions).toEqual(["Hypertension", "Asthma"]);
      expect(sanitized.vitals).toEqual({ bp_systolic: 130, bp_diastolic: 85, pulse: 72 });
    });

    it("redacts phone numbers, Aadhaar, and ABHA numbers from free text", () => {
      const text =
        "Patient Rahul (call 9876543210 or +91 9123456789) Aadhaar 5555 4444 3333 and ABHA 91-8888-7777-6666 reported headache.";
      const scrubbed = stripPiiFromText(text);

      expect(scrubbed).not.toContain("9876543210");
      expect(scrubbed).not.toContain("9123456789");
      expect(scrubbed).not.toContain("5555 4444 3333");
      expect(scrubbed).not.toContain("91-8888-7777-6666");
      expect(scrubbed).toContain("[PHONE REDACTED]");
      expect(scrubbed).toContain("[AADHAAR REDACTED]");
      expect(scrubbed).toContain("[ABHA REDACTED]");
    });

    it("detects direct PII with containsDirectPii", () => {
      expect(containsDirectPii("Please reach out on 9876543210")).toBe(true);
      expect(containsDirectPii("Aadhaar card: 1234 5678 9012")).toBe(true);
      expect(containsDirectPii("ABHA ID is 12-3456-7890-1234")).toBe(true);
      expect(
        containsDirectPii("Patient complains of mild fever and dry cough for 3 days.")
      ).toBe(false);
    });
  });

  describe("2. Grounded Product Manifest (D-08)", () => {
    it("retrieves verified navigation steps for valid ClinicOS features", () => {
      const calendarHelp = getProductHelpAnswer("calendar");
      expect(calendarHelp.found).toBe(true);
      expect(calendarHelp.navigation_steps.length).toBeGreaterThan(0);
      expect(calendarHelp.navigation_steps[0]).toContain("/calendar");

      const queueHelp = getProductHelpAnswer("opd_queue");
      expect(queueHelp.found).toBe(true);
      expect(queueHelp.navigation_steps[0]).toContain("/queue");

      const cabinHelp = getProductHelpAnswer("cabin");
      expect(cabinHelp.found).toBe(true);
      expect(cabinHelp.navigation_steps[0]).toContain("/cabin");
    });

    it("explicitly flags unsupported features to prevent LLM hallucinations", () => {
      const cryptoHelp = getProductHelpAnswer("Can I accept Bitcoin or crypto payments?");
      expect(cryptoHelp.found).toBe(false);
      expect(cryptoHelp.unsupported_features[0]).toContain("Cryptocurrency payments are not supported");

      const ipdHelp = getProductHelpAnswer("How to allocate in-patient ward beds?");
      expect(ipdHelp.found).toBe(false);
      expect(ipdHelp.unsupported_features[0]).toContain("In-patient ward bed management is not supported");

      const autoRxHelp = getProductHelpAnswer("Enable autonomous prescribing for fever");
      expect(autoRxHelp.found).toBe(false);
      expect(autoRxHelp.unsupported_features[0]).toContain("Autonomous prescribing is strictly prohibited");
    });
  });

  describe("3. Server-Side RBAC Enforcement (T-05.3-02, D-09)", () => {
    it("assertRoleAllowed permits authorized roles and throws UNAUTHORIZED_ROLE for blocked roles", () => {
      expect(() =>
        assertRoleAllowed("doctor", ["doctor", "admin", "owner"])
      ).not.toThrow();

      expect(() =>
        assertRoleAllowed("nurse", ["doctor", "admin", "owner"])
      ).toThrowError(/not authorized/);

      try {
        assertRoleAllowed("receptionist", ["doctor", "owner"]);
      } catch (err: any) {
        expect(err.code).toBe("UNAUTHORIZED_ROLE");
      }
    });

    it("blocks nurses from invoking clinical diagnostic coding (suggest_icd10)", async () => {
      const clinicalTools = getClinicalTools({
        tenantId: "00000000-0000-0000-0000-000000000001",
        userId: "00000000-0000-0000-0000-000000000002",
        role: "nurse",
      });

      // Nurse executing suggest_icd10 must throw UNAUTHORIZED_ROLE
      await expect(
        clinicalTools.suggest_icd10.execute(
          { query: "fever with chills" },
          { toolCallId: "call_1", messages: [] }
        )
      ).rejects.toThrow(/not authorized/);
    });

    it("allows doctors and admins to execute suggest_icd10", async () => {
      const clinicalTools = getClinicalTools({
        tenantId: "00000000-0000-0000-0000-000000000001",
        userId: "00000000-0000-0000-0000-000000000002",
        role: "doctor",
      });

      const result = await clinicalTools.suggest_icd10.execute(
        { query: "fever with chills" },
        { toolCallId: "call_2", messages: [] }
      );

      expect(result).toBeDefined();
      expect(result.candidates).toBeInstanceOf(Array);
      expect(result.candidates.length).toBeGreaterThan(0);
      expect(result.candidates[0].differential_criteria).toBeDefined();
    });
  });

  describe("4. Operations Two-Phase Preview Cards (D-05)", () => {
    it("stages appointment booking as preview_ready with requires_confirmation: true", async () => {
      const opsTools = getOperationsTools({
        tenantId: "00000000-0000-0000-0000-000000000001",
        userId: "00000000-0000-0000-0000-000000000002",
        role: "receptionist",
      });

      const bookingPayload = {
        patient_id: "123e4567-e89b-12d3-a456-426614174000",
        patient_name: "Rahul Verma",
        phone: "+919876543210",
        doctor_id: "223e4567-e89b-12d3-a456-426614174000",
        doctor_name: "Dr. Sunita Rao",
        date: "2026-11-05",
        start_time: "10:30",
        consultation_type: "in_person" as const,
        fee: 600,
        outside_shift_warning: false,
      };

      const result = await opsTools.request_appointment_booking.execute(bookingPayload, {
        toolCallId: "call_booking_1",
        messages: [],
      });

      expect(result.status).toBe("preview_ready");
      expect(result.requires_confirmation).toBe(true);
      expect(result.action_type).toBe("book_appointment");
      expect(result.details.patient_name).toBe("Rahul Verma");
      expect(result.details.fee).toBe(600);
    });

    it("stages rescheduling and cancellations as preview_ready", async () => {
      const opsTools = getOperationsTools({
        tenantId: "00000000-0000-0000-0000-000000000001",
        userId: "00000000-0000-0000-0000-000000000002",
        role: "receptionist",
      });

      const rescheduleResult = await opsTools.reschedule_appointment.execute(
        {
          appointment_id: "333e4567-e89b-12d3-a456-426614174000",
          patient_name: "Priya Patel",
          doctor_name: "Dr. A. Verma",
          old_date_time: "2026-11-05 10:00",
          new_date: "2026-11-06",
          new_start_time: "11:00",
        },
        { toolCallId: "call_reschedule_1", messages: [] }
      );

      expect(rescheduleResult.status).toBe("preview_ready");
      expect(rescheduleResult.requires_confirmation).toBe(true);
      expect(rescheduleResult.action_type).toBe("reschedule_appointment");

      const cancelResult = await opsTools.cancel_appointment.execute(
        {
          appointment_id: "333e4567-e89b-12d3-a456-426614174000",
          patient_name: "Priya Patel",
          doctor_name: "Dr. A. Verma",
          scheduled_at: "2026-11-05 10:00",
          reason: "Patient requested reschedule to next week",
        },
        { toolCallId: "call_cancel_1", messages: [] }
      );

      expect(cancelResult.status).toBe("preview_ready");
      expect(cancelResult.requires_confirmation).toBe(true);
      expect(cancelResult.action_type).toBe("cancel_appointment");
    });

    it("returns queue status counts correctly", async () => {
      const opsTools = getOperationsTools({
        tenantId: "00000000-0000-0000-0000-000000000001",
        userId: "00000000-0000-0000-0000-000000000002",
        role: "nurse",
      });

      const queueResult = await opsTools.get_queue_status.execute(
        { date: "2026-11-05" },
        { toolCallId: "call_queue_1", messages: [] }
      );

      expect(queueResult.date).toBe("2026-11-05");
      expect(queueResult.waiting_count).toBeGreaterThanOrEqual(0);
      expect(queueResult.completed_count).toBeGreaterThanOrEqual(0);
    });
  });

  describe("5. Universal AI Gateway & Model Resolver (D-02)", () => {
    it("getAiGatewayModel returns a valid LanguageModel instance", () => {
      const origProvider = process.env.AI_PROVIDER;
      const origModel = process.env.AI_MODEL_NAME;
      try {
        process.env.AI_PROVIDER = "openai";
        process.env.AI_MODEL_NAME = "gpt-4o-mini";
        const model = getAiGatewayModel();
        expect(model).toBeDefined();
        expect(model.modelId).toBeDefined();
        expect(model.provider).toBe("openai.chat");
      } finally {
        process.env.AI_PROVIDER = origProvider;
        if (origModel) process.env.AI_MODEL_NAME = origModel;
        else delete process.env.AI_MODEL_NAME;
      }
    });

    it("MockAiProvider provides simulated operations responses", async () => {
      const mock = new MockAiProvider();

      const searchResp = await mock.generateChatResponse([
        { role: "user", content: "search patient Ramesh" },
      ]);
      expect(JSON.parse(searchResp).patients).toBeInstanceOf(Array);

      const availResp = await mock.generateChatResponse([
        { role: "user", content: "check doctor availability slots" },
      ]);
      expect(JSON.parse(availResp).available_slots).toBeInstanceOf(Array);

      const bookingResp = await mock.generateChatResponse([
        { role: "user", content: "book appointment for patient" },
      ]);
      expect(JSON.parse(bookingResp).status).toBe("preview_ready");
    });

    it("getAiGatewayModel resolves to Google Generative AI when AI_PROVIDER=gemini", () => {
      const origProvider = process.env.AI_PROVIDER;
      const origModel = process.env.AI_MODEL_NAME;
      try {
        process.env.AI_PROVIDER = "gemini";
        delete process.env.AI_MODEL_NAME;
        const model = getAiGatewayModel();
        expect(model).toBeDefined();
        expect(model.provider).toBe("google.generative-ai");
        expect(model.modelId).toBe("gemini-3.1-flash-lite");
      } finally {
        process.env.AI_PROVIDER = origProvider;
        if (origModel) process.env.AI_MODEL_NAME = origModel;
      }
    });

    it("OpenAiGatewayClient resolves Gemini defaults properly", () => {
      const client = new OpenAiGatewayClient({ provider: "gemini" });
      expect(client.baseUrl).toBe("https://generativelanguage.googleapis.com/v1beta/openai");
      expect(client.model).toBe("gemini-3.1-flash-lite");
    });

    it("geminiFetchInterceptor injects sentinel thoughtSignature when missing from functionCall parts", async () => {
      let interceptedBody: string | undefined;
      const mockFetch = vi.fn().mockImplementation((url, init) => {
        interceptedBody = init?.body;
        return Promise.resolve(new Response(JSON.stringify({ ok: true })));
      });

      const origFetch = global.fetch;
      global.fetch = mockFetch;

      try {
        const payload = {
          contents: [
            {
              role: "model",
              parts: [
                {
                  functionCall: {
                    name: "get_product_help",
                    args: { topic: "booking" },
                  },
                },
              ],
            },
          ],
        };

        await geminiFetchInterceptor("https://generativelanguage.googleapis.com", {
          method: "POST",
          body: JSON.stringify(payload),
        });

        expect(interceptedBody).toBeDefined();
        const parsed = JSON.parse(interceptedBody!);
        expect(parsed.contents[0].parts[0].thoughtSignature).toBe(
          SKIP_THOUGHT_SIGNATURE_VALIDATOR
        );
      } finally {
        global.fetch = origFetch;
      }
    });
  });
});
