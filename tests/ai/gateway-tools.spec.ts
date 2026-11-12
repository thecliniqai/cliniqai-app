import { describe, it, expect } from "vitest";
import {
  sanitizePatientContextForPrompt,
  stripPiiFromText,
  containsDirectPii,
} from "@/lib/ai/sanitizer";

// AI-01: the copilot parts of this spec (product manifest, copilot tool RBAC, operations previews, AI SDK model
// resolver, MockAiProvider, Gemini interceptor) were retired with the copilots (AI_STRATEGY.md §11.2,
// TEST_STRATEGY.md §2.6 erratum). The PII sanitizer stays (A9, extended in AI-04).
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
});
