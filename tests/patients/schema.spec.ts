import { describe, it, expect } from "vitest";
import { patientSchema } from "@/features/patients/schema";

describe("Patient Schema & Boundary Validation (REQ-compliance-data-layer)", () => {
  it("accepts a patient with only name and phone, leaving ABHA null", () => {
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

  it("rejects invalid or too short phone numbers", () => {
    const input = {
      full_name: "Anita Sharma",
      phone: "123",
    };

    const parsed = patientSchema.safeParse(input);
    expect(parsed.success).toBe(false);
  });
});
