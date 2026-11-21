import { describe, it, expect } from "vitest";
import {
  calculateAgeFromDob,
  calculateDobFromAge,
  normalizePhone,
  patientSchema,
} from "@/features/patients/schema";

describe("Patient Intake Deduplication & Age/DOB Sync (REQ-patient-records)", () => {
  describe("1. Age and DOB Bidirectional Derivation", () => {
    it("derives DOB as Jan 01 of (currentYear - age) when only age is provided", () => {
      const currentYear = new Date().getFullYear();
      const derivedDob = calculateDobFromAge(40);
      expect(derivedDob).toBe(`${currentYear - 40}-01-01`);

      const parsed = patientSchema.safeParse({
        full_name: "Aarav Gupta",
        phone: "9876543210",
        age: 40,
      });

      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.age).toBe(40);
        expect(parsed.data.date_of_birth).toBe(`${currentYear - 40}-01-01`);
      }
    });

    it("derives exact current age in whole years when DOB is provided", () => {
      const currentYear = new Date().getFullYear();
      const birthDate = `${currentYear - 25}-01-01`;
      const age = calculateAgeFromDob(birthDate);
      expect(age).toBe(25);

      const parsed = patientSchema.safeParse({
        full_name: "Sneha Reddy",
        phone: "9876543211",
        date_of_birth: birthDate,
      });

      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.age).toBe(25);
        expect(parsed.data.date_of_birth).toBe(birthDate);
      }
    });
  });

  describe("2. Phone Number Normalization", () => {
    it("normalizes bare 10-digit Indian numbers to E.164 +91 format", () => {
      expect(normalizePhone("9876543210")).toBe("+919876543210");
      expect(normalizePhone(" 98765 43210 ")).toBe("+919876543210");
      expect(normalizePhone("+919876543210")).toBe("+919876543210");
    });
  });

  // The database duplicate detection (same mobile; same name with the same date of birth or an age within two years) moved
  // to `public.find_patient_duplicates` in V2-08 08-02: tests/patients/find-duplicates-db.spec.ts.
});
