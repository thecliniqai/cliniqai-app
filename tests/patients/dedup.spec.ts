import { describe, it, expect, beforeAll } from "vitest";
import {
  calculateAgeFromDob,
  calculateDobFromAge,
  normalizePhone,
  patientSchema,
} from "@/features/patients/schema";
import { seedTenantWithOwner } from "../helpers/tenants";
import { findPotentialDuplicates } from "@/features/patients/dedup";

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

  describe("3. Database Duplicate Detection Engine", () => {
    let tenant: Awaited<ReturnType<typeof seedTenantWithOwner>>;

    beforeAll(async () => {
      tenant = await seedTenantWithOwner("Fortis Health Clinic");

      // Seed baseline patient in this tenant
      const { error } = await tenant.client.from("patients").insert({
        tenant_id: tenant.tenantId,
        full_name: "Sunil Narine",
        phone: "+919811122233",
        date_of_birth: "1985-06-15",
        age: 41,
        created_by: tenant.userId,
      });

      if (error) throw new Error(`Failed to seed test patient: ${error.message}`);
    });

    it("detects high-confidence duplicate on exact phone match regardless of formatting", async () => {
      // Input bare 10-digit phone
      const matches = await findPotentialDuplicates(
        {
          phone: "9811122233",
          fullName: "Different Name",
        },
        tenant.client,
        tenant.tenantId
      );

      const matched = matches.find((m) => m.patient.phone === "+919811122233");
      expect(matched).toBeDefined();
      expect(matched?.confidence).toBe("high");
      expect(matched?.patient.full_name).toBe("Sunil Narine");
    });

    it("detects medium-confidence duplicate on matching name + approximate age (within 2 years)", async () => {
      const matches = await findPotentialDuplicates(
        {
          phone: "9999900000", // Different phone
          fullName: "sunil narine", // Same name, lowercase
          age: 42, // Within 2 years of 41
        },
        tenant.client,
        tenant.tenantId
      );

      const matched = matches.find((m) => m.patient.full_name === "Sunil Narine");
      expect(matched).toBeDefined();
      expect(matched?.confidence).toBe("medium");
    });

    it("does not match when name matches but age is significantly different", async () => {
      const matches = await findPotentialDuplicates(
        {
          phone: "9999900000", // Different phone
          fullName: "Sunil Narine", // Same name
          age: 20, // 21 years younger -> not the same patient
        },
        tenant.client,
        tenant.tenantId
      );

      const matched = matches.find((m) => m.patient.full_name === "Sunil Narine");
      expect(matched).toBeUndefined();
    });
  });
});
