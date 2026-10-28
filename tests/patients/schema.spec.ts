import { describe, it, expect } from "vitest";
import { patientSchema } from "@/features/patients/schema";

describe("Patient Schema & Boundary Validation (REQ-compliance-data-layer & Phase 05.2)", () => {
  it("accepts a patient with only name and phone, leaving ABHA null and transforming phone to E.164", () => {
    const input = {
      full_name: "Anita Sharma",
      phone: "9876543210",
    };

    const parsed = patientSchema.safeParse(input);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.full_name).toBe("Anita Sharma");
      expect(parsed.data.phone).toBe("+919876543210");
      expect(parsed.data.abha_id).toBeNull();
      expect(parsed.data.date_of_birth).toBeNull();
    }
  });

  it("transforms formatted Indian mobile numbers to E.164 (+91XXXXXXXXXX)", () => {
    const formattedInputs = [
      "+91 98765 43210",
      "09876543210",
      "+919876543210",
      "98765-43210",
    ];

    for (const phone of formattedInputs) {
      const parsed = patientSchema.safeParse({
        full_name: "Ramesh Patel",
        phone,
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.phone).toBe("+919876543210");
      }
    }
  });

  it("rejects phone numbers starting with 0-5 (landlines/invalid) with specific error message", () => {
    const invalidPrefixes = ["0123456789", "1234567890", "2345678901", "3456789012", "4567890123", "5555555555"];

    for (const phone of invalidPrefixes) {
      const parsed = patientSchema.safeParse({
        full_name: "Invalid Phone Test",
        phone,
      });
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.issues[0].message).toBe(
          "Please enter a valid 10-digit Indian mobile number starting with 6, 7, 8, or 9."
        );
      }
    }
  });

  it("rejects partial or incomplete phone numbers with specific error message", () => {
    const shortNumbers = ["123", "98765", "987654321"];

    for (const phone of shortNumbers) {
      const parsed = patientSchema.safeParse({
        full_name: "Short Phone Test",
        phone,
      });
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.issues[0].message).toBe(
          "Please enter a valid 10-digit Indian mobile number starting with 6, 7, 8, or 9."
        );
      }
    }
  });

  it("normalizes empty or blank ABHA strings to null rather than storing empty strings", () => {
    const inputWithBlank = {
      full_name: "Anita Sharma",
      phone: "9876543210",
      abha_id: "   ",
    };

    const parsed = patientSchema.safeParse(inputWithBlank);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.abha_id).toBeNull();
    }
  });

  it("preserves non-empty valid ABHA identifiers", () => {
    const input = {
      full_name: "Anita Sharma",
      phone: "9876543210",
      abha_id: "14-digit-abha-number",
    };

    const parsed = patientSchema.safeParse(input);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.abha_id).toBe("14-digit-abha-number");
    }
  });

  it("rejects missing full_name with a clear validation error", () => {
    const input = {
      full_name: "   ",
      phone: "9876543210",
    };

    const parsed = patientSchema.safeParse(input);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0].message).toContain("Patient full name is required");
    }
  });
});
