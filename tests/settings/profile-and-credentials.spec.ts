import { describe, it, expect } from "vitest";
import {
  clinicSettingsSchema,
  userProfileSchema,
  staffEditSchema,
} from "@/features/settings/schema";

describe("Doctor & Staff Profile Schemas (NMC Regulations & Multi-Doctor Practice)", () => {
  describe("clinicSettingsSchema with Owner Doctor Credentials", () => {
    it("validates clinic settings including owner doctor qualifications and reg no", () => {
      const input = {
        name: "Apollo Clinic Bangalore",
        address: "123 Indiranagar, 100ft Road",
        specialties: ["General Physician", "Dental"],
        timezone: "Asia/Kolkata",
        owner_is_practicing_doctor: true,
        default_consultation_fee: 600,
        default_followup_fee: 350,
        accepted_payment_methods: ["cash", "upi", "card"],
        doctor_name: "Dr. Rajesh Sharma",
        doctor_phone: "+91 98765 43210",
        medical_council_reg_no: "KMC 48291",
        qualifications: "MBBS, MD (Medicine), DNB",
        default_specialty: "general_physician",
      };

      const result = clinicSettingsSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.doctor_name).toBe("Dr. Rajesh Sharma");
        expect(result.data.medical_council_reg_no).toBe("KMC 48291");
        expect(result.data.qualifications).toBe("MBBS, MD (Medicine), DNB");
      }
    });

    it("allows omitting doctor credentials if owner is not practicing", () => {
      const input = {
        name: "City Diagnostics",
        address: "MG Road",
        specialties: ["General Physician"],
        timezone: "Asia/Kolkata",
        owner_is_practicing_doctor: false,
        default_consultation_fee: 400,
        default_followup_fee: 200,
        accepted_payment_methods: ["cash"],
      };

      const result = clinicSettingsSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.owner_is_practicing_doctor).toBe(false);
      }
    });
  });

  describe("userProfileSchema (My Profile)", () => {
    it("validates personal profile and doctor clinical credentials", () => {
      const input = {
        full_name: "Dr. Priya Deshmukh",
        phone: "+91 91234 56789",
        medical_council_reg_no: "MMC-2018-9921",
        qualifications: "MBBS, DCH, MD (Pediatrics)",
        default_specialty: "pediatrics",
      };

      const result = userProfileSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.full_name).toBe("Dr. Priya Deshmukh");
        expect(result.data.medical_council_reg_no).toBe("MMC-2018-9921");
        expect(result.data.default_specialty).toBe("pediatrics");
      }
    });

    it("rejects invalid name with less than 2 characters", () => {
      const input = {
        full_name: "D",
        phone: "+91 98765 43210",
      };

      const result = userProfileSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe("staffEditSchema (Staff Management)", () => {
    it("validates staff member credential update", () => {
      const input = {
        membership_id: "550e8400-e29b-41d4-a716-446655440000",
        full_name: "Dr. Anand Rao",
        phone: "+91 94444 12345",
        role: "doctor",
        medical_council_reg_no: "KDC 1289",
        qualifications: "BDS, MDS (Orthodontics)",
        default_specialty: "dental",
      };

      const result = staffEditSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.role).toBe("doctor");
        expect(result.data.default_specialty).toBe("dental");
      }
    });

    it("rejects invalid UUID membership ID", () => {
      const input = {
        membership_id: "not-a-uuid",
        full_name: "Sister Mary",
        phone: "+91 98765 00000",
        role: "nurse",
      };

      const result = staffEditSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("rejects invalid role string", () => {
      const input = {
        membership_id: "550e8400-e29b-41d4-a716-446655440000",
        full_name: "John Doe",
        phone: "+91 98765 00000",
        role: "superadmin_invalid",
      };

      const result = staffEditSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });
});
