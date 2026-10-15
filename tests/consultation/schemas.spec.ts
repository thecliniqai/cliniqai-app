import { describe, it, expect } from "vitest";
import {
  vitalsSchema,
  chiefComplaintItemSchema,
  specialtyDataSchema,
  saveConsultationDraftSchema,
  VALID_FDI_TEETH,
} from "@/features/consultation/schema";

describe("Consultation Schema & Boundary Validation (REQ-specialty-templates, REQ-diagnosis-visit-management)", () => {
  describe("Vitals Schema Validation", () => {
    it("accepts valid normal vital signs", () => {
      const validVitals = {
        systolic: 120,
        diastolic: 80,
        pulse: 72,
        temperature: 98.6,
        spo2: 99,
        weight: 70.5,
        height: 175,
        respiratory_rate: 16,
      };

      const result = vitalsSchema.safeParse(validVitals);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.systolic).toBe(120);
        expect(result.data.diastolic).toBe(80);
      }
    });

    it("accepts partial vitals when only select parameters are recorded", () => {
      const partialVitals = {
        pulse: 84,
        temperature: 99.1,
      };

      const result = vitalsSchema.safeParse(partialVitals);
      expect(result.success).toBe(true);
    });

    it("rejects invalid blood pressure where systolic <= diastolic", () => {
      const invertedBP = {
        systolic: 80,
        diastolic: 120,
      };

      const result = vitalsSchema.safeParse(invertedBP);
      expect(result.success).toBe(false);
      if (!result.success) {
        const error = result.error.issues.find((i) => i.path.includes("systolic"));
        expect(error).toBeDefined();
        expect(error?.message).toContain("greater than diastolic");
      }

      const equalBP = {
        systolic: 100,
        diastolic: 100,
      };
      const equalResult = vitalsSchema.safeParse(equalBP);
      expect(equalResult.success).toBe(false);
    });

    it("enforces physiologic bounds for vital metrics", () => {
      // Pulse out of range (< 30 or > 220)
      expect(vitalsSchema.safeParse({ pulse: 25 }).success).toBe(false);
      expect(vitalsSchema.safeParse({ pulse: 230 }).success).toBe(false);

      // Temperature out of range (< 90 or > 110)
      expect(vitalsSchema.safeParse({ temperature: 88 }).success).toBe(false);
      expect(vitalsSchema.safeParse({ temperature: 112 }).success).toBe(false);

      // SpO2 out of range (< 50 or > 100)
      expect(vitalsSchema.safeParse({ spo2: 45 }).success).toBe(false);
      expect(vitalsSchema.safeParse({ spo2: 105 }).success).toBe(false);

      // Weight out of range (< 0.5 or > 300)
      expect(vitalsSchema.safeParse({ weight: 0.2 }).success).toBe(false);
      expect(vitalsSchema.safeParse({ weight: 350 }).success).toBe(false);
    });
  });

  describe("Chief Complaints Schema", () => {
    it("accepts valid chief complaint items with units", () => {
      const complaint = {
        symptom: "Fever with chills",
        duration_val: 3,
        duration_unit: "days",
        notes: "High grade in evenings",
      };

      const result = chiefComplaintItemSchema.safeParse(complaint);
      expect(result.success).toBe(true);
    });

    it("rejects empty symptom name or non-positive duration", () => {
      const emptySymptom = {
        symptom: "",
        duration_val: 2,
        duration_unit: "weeks",
      };
      expect(chiefComplaintItemSchema.safeParse(emptySymptom).success).toBe(false);

      const invalidDuration = {
        symptom: "Cough",
        duration_val: 0,
        duration_unit: "days",
      };
      expect(chiefComplaintItemSchema.safeParse(invalidDuration).success).toBe(false);
    });
  });

  describe("Specialty Templates Schema", () => {
    it("validates General Physician systemic review and physical signs", () => {
      const gpData = {
        specialty: "general_physician",
        general_exam: {
          pallor: true,
          icterus: false,
          cyanosis: false,
          clubbing: false,
          lymphadenopathy: true,
          edema: false,
        },
        systemic: {
          cvs: "S1 S2 heard, no murmurs",
          rs: "Bilateral vesicular breath sounds, no rhonchi",
          pa: "Soft, non-tender",
          cns: "Conscious, oriented",
        },
      };

      const result = specialtyDataSchema.safeParse(gpData);
      expect(result.success).toBe(true);
    });

    it("validates Dental Odontogram FDI tooth numbers and condition tags", () => {
      const dentalData = {
        specialty: "dental",
        odontogram: [
          {
            tooth_number: 16, // Adult upper right molar
            condition_tags: ["decay", "rct"],
            notes: "Deep occlusal caries",
          },
          {
            tooth_number: 55, // Deciduous upper right molar
            condition_tags: ["filled"],
          },
        ],
      };

      const result = specialtyDataSchema.safeParse(dentalData);
      expect(result.success).toBe(true);
    });

    it("rejects invalid tooth numbers not present in FDI notation", () => {
      const invalidTooth = {
        specialty: "dental",
        odontogram: [
          {
            tooth_number: 99, // Invalid tooth number
            condition_tags: ["decay"],
          },
        ],
      };

      const result = specialtyDataSchema.safeParse(invalidTooth);
      expect(result.success).toBe(false);
      expect(VALID_FDI_TEETH.has(99)).toBe(false);
    });

    it("validates Pediatrics tools with birth history and head circumference", () => {
      const pedsData = {
        specialty: "pediatrics",
        birth_history: {
          gestational_age_weeks: 38,
          birth_weight_kg: 3.1,
          delivery_type: "normal",
          complications: "None",
        },
        head_circumference_cm: 46.5,
        immunizations_given: ["BCG", "OPV-0", "Hepatitis B-1"],
      };

      const result = specialtyDataSchema.safeParse(pedsData);
      expect(result.success).toBe(true);
    });
  });

  describe("Save Consultation Draft Schema", () => {
    it("validates complete consultation draft input with visit ID", () => {
      const draft = {
        visit_id: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
        vitals: {
          systolic: 124,
          diastolic: 82,
          pulse: 78,
          temperature: 98.4,
          spo2: 98,
        },
        chief_complaints: [
          {
            symptom: "Acute sore throat",
            duration_val: 2,
            duration_unit: "days",
          },
        ],
        clinical_notes: "Erythematous posterior pharynx with tonsillar enlargement.",
        specialty: "general_physician",
        specialty_data: {
          specialty: "general_physician",
          general_exam: { pallor: false, lymphadenopathy: true },
        },
        investigations_advised: ["Complete Blood Count (CBC)"],
        advice: ["Warm saline gargle 3 times daily", "Steam inhalation"],
        follow_up: {
          interval: "5_days",
          follow_up_date: "2026-10-20",
          notes: "Review if fever persists",
        },
      };

      const result = saveConsultationDraftSchema.safeParse(draft);
      expect(result.success).toBe(true);
    });
  });
});
