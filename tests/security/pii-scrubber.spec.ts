import { describe, it, expect } from "vitest";
import referenceDataset from "../ai/fixtures/reference-dataset.json";
import {
  sanitizePatientContextForPrompt,
  stripPiiFromText,
  containsDirectPii,
} from "@/lib/ai/sanitizer";

describe("Phase 05.3 Security Evaluation: DPDP Act Direct PII Sanitization (D-15, T-05.3-12, Case 25)", () => {
  const case25 = referenceDataset.find((c) => c.id === "ref-25");

  it("loads Case 25 DPDP Act PII benchmark case", () => {
    expect(case25).toBeDefined();
  });

  describe("1. Structured Patient Context Sanitization", () => {
    it("strips direct identifiers (full_name, phone, aadhaar, abha, uhid, address) and retains clinical tokens", () => {
      const rawPatientPayload = {
        id: "p-9999",
        full_name: "Rahul Sharma",
        phone: "+919876543210",
        aadhaar: "2345 6789 1234",
        abha_id: "12-3456-7890-1234",
        uhid: "UHID-BLR-001928",
        address: "42 Indiranagar 100ft Road, Bengaluru 560038",
        email: "rahul.sharma@example.com",
        emergency_contact: "+919811223344",
        // De-identified clinical parameters:
        age: 38,
        sex: "male",
        vitals: {
          systolic: 124,
          diastolic: 82,
          pulse: 76,
          spo2: 99,
          temperature: 98.4,
        },
        chronic_conditions: ["Type 2 Diabetes Mellitus", "Essential Hypertension"],
      };

      const sanitized = sanitizePatientContextForPrompt(rawPatientPayload);

      // Direct PII fields must NOT exist in the sanitized object
      expect((sanitized as any).full_name).toBeUndefined();
      expect((sanitized as any).phone).toBeUndefined();
      expect((sanitized as any).aadhaar).toBeUndefined();
      expect((sanitized as any).abha_id).toBeUndefined();
      expect((sanitized as any).uhid).toBeUndefined();
      expect((sanitized as any).address).toBeUndefined();
      expect((sanitized as any).email).toBeUndefined();
      expect((sanitized as any).emergency_contact).toBeUndefined();

      // De-identified clinical parameters must be preserved
      expect(sanitized.age).toBe(38);
      expect(sanitized.sex).toBe("male");
      expect(sanitized.vitals).toEqual({
        systolic: 124,
        diastolic: 82,
        pulse: 76,
        spo2: 99,
        temperature: 98.4,
      });
      expect(sanitized.chronic_conditions).toEqual([
        "Type 2 Diabetes Mellitus",
        "Essential Hypertension",
      ]);
    });

    it("handles null and undefined patient context gracefully", () => {
      expect(sanitizePatientContextForPrompt(null)).toEqual({});
      expect(sanitizePatientContextForPrompt(undefined)).toEqual({});
    });
  });

  describe("2. Free-Form Text Direct PII Scrubbing (Case 25)", () => {
    it("scrubs Indian mobile numbers (+91 and 10-digit formats)", () => {
      const text = "Contact patient on +919876543210 or alternate 9812345678 regarding test report.";
      const scrubbed = stripPiiFromText(text);

      expect(scrubbed).not.toContain("+919876543210");
      expect(scrubbed).not.toContain("9812345678");
      expect(scrubbed).toContain("[PHONE REDACTED]");
      expect(containsDirectPii(scrubbed)).toBe(false);
    });

    it("scrubs 12-digit Indian Aadhaar numbers", () => {
      const text = "Patient provided Aadhaar number 2345 6789 1234 during registration.";
      const scrubbed = stripPiiFromText(text);

      expect(scrubbed).not.toContain("2345 6789 1234");
      expect(scrubbed).toContain("[AADHAAR REDACTED]");
      expect(containsDirectPii(scrubbed)).toBe(false);
    });

    it("scrubs 14-digit Ayushman Bharat Health Account (ABHA) IDs", () => {
      const text = "Linked ABHA address is 12-3456-7890-1234.";
      const scrubbed = stripPiiFromText(text);

      expect(scrubbed).not.toContain("12-3456-7890-1234");
      expect(scrubbed).toContain("[ABHA REDACTED]");
      expect(containsDirectPii(scrubbed)).toBe(false);
    });

    it("verifies Case 25 composite prompt scrubs all direct PII tokens", () => {
      if (!case25) throw new Error("Case 25 not found");

      expect(containsDirectPii(case25.input)).toBe(true);

      const scrubbed = stripPiiFromText(case25.input);

      expect(scrubbed).not.toContain("+91 9876543210");
      expect(scrubbed).not.toContain("2345 6789 1234");
      expect(scrubbed).toContain("[PHONE REDACTED]");
      expect(scrubbed).toContain("[AADHAAR REDACTED]");
      expect(scrubbed).toContain("c/o fever 2d");
      expect(containsDirectPii(scrubbed)).toBe(false);
    });
  });

  describe("3. DPDP Act Zero Leaks Across All 26 Reference Dataset Payloads", () => {
    it("ensures zero direct PII is transmitted in test prompts", () => {
      for (const tc of referenceDataset) {
        if (tc.id === "ref-25") {
          // Explicit PII test case — verified scrubbed above
          continue;
        }

        // Verify that standard test inputs contain no accidental unredacted direct PII
        expect(containsDirectPii(tc.input)).toBe(false);
      }
    });
  });
});
