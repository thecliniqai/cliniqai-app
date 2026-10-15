import { describe, it, expect } from "vitest";
import {
  dosageFrequencySchema,
  foodTimingSchema,
  durationSchema,
  normalizeDuration,
  normalizeFrequency,
  prescriptionItemSchema,
  protocolTemplateSchema,
  saveCustomMedicineSchema,
  STANDARD_FREQUENCIES,
  STANDARD_FOOD_RELATIONS,
  STANDARD_DURATIONS,
} from "../../features/prescriptions/schema";

describe("Dosage Chip Parser & Prescription Validation", () => {
  describe("Dosage Frequencies", () => {
    it("correctly parses standard Indian OPD dosage frequencies", () => {
      const validFrequencies = ["1-0-1", "1-0-0", "0-0-1", "1-1-1", "1-0-1-0", "SOS", "Stat"];
      for (const freq of validFrequencies) {
        const res = dosageFrequencySchema.safeParse(freq);
        expect(res.success).toBe(true);
      }
    });

    it("verifies all STANDARD_FREQUENCIES constants parse successfully", () => {
      for (const freq of STANDARD_FREQUENCIES) {
        expect(dosageFrequencySchema.safeParse(freq).success).toBe(true);
      }
    });

    it("normalizes frequency text to uppercase", () => {
      expect(normalizeFrequency("sos")).toBe("SOS");
      expect(normalizeFrequency(" 1-0-1 ")).toBe("1-0-1");
    });
  });

  describe("Food Relation Timing Chips", () => {
    it("validates food relation chips", () => {
      const validTimings = ["After food", "Before food", "With food", "Empty stomach"];
      for (const timing of validTimings) {
        const res = foodTimingSchema.safeParse(timing);
        expect(res.success).toBe(true);
      }
    });

    it("verifies all STANDARD_FOOD_RELATIONS constants parse successfully", () => {
      for (const timing of STANDARD_FOOD_RELATIONS) {
        expect(foodTimingSchema.safeParse(timing).success).toBe(true);
      }
    });
  });

  describe("Duration Presets & Normalization", () => {
    it("normalizes short duration codes to standard human-readable clinical text", () => {
      expect(normalizeDuration("1d")).toBe("1 day");
      expect(normalizeDuration("3d")).toBe("3 days");
      expect(normalizeDuration("5d")).toBe("5 days");
      expect(normalizeDuration("10d")).toBe("10 days");
      expect(normalizeDuration("1w")).toBe("1 week");
      expect(normalizeDuration("2w")).toBe("2 weeks");
      expect(normalizeDuration("1m")).toBe("1 month");
      expect(normalizeDuration("3m")).toBe("3 months");
      expect(normalizeDuration("14 days")).toBe("14 days");
    });

    it("validates STANDARD_DURATIONS constants", () => {
      for (const dur of STANDARD_DURATIONS) {
        expect(durationSchema.safeParse(dur).success).toBe(true);
      }
    });
  });

  describe("Prescription Item Schema Validation", () => {
    it("accepts a valid medication item with all clinical instructions", () => {
      const validItem = {
        medicine_name: "Augmentin 625 Duo Tablet",
        generic_name: "Amoxicillin 500mg + Clavulanic Acid 125mg",
        dose_form: "Tablet",
        dosage: "1-0-1",
        timing: "After food",
        duration: "5 days",
        special_instructions: "Drink with plenty of water",
        cdci_brand_id: "cdci_aug_625",
        sort_order: 1,
      };

      const parsed = prescriptionItemSchema.safeParse(validItem);
      expect(parsed.success).toBe(true);
    });

    it("accepts minimal prescription item without brand ID (custom medicine)", () => {
      const customItem = {
        medicine_name: "Compound Vitamin B Mixture",
        dosage: "10 ml twice daily",
        duration: "14 days",
      };

      const parsed = prescriptionItemSchema.safeParse(customItem);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.medicine_name).toBe("Compound Vitamin B Mixture");
        expect(parsed.data.sort_order).toBe(0);
      }
    });

    it("rejects item when required fields are missing or empty", () => {
      // Empty medicine name
      expect(
        prescriptionItemSchema.safeParse({
          medicine_name: "",
          dosage: "1-0-1",
          duration: "5 days",
        }).success
      ).toBe(false);

      // Missing dosage
      expect(
        prescriptionItemSchema.safeParse({
          medicine_name: "Paracetamol 650",
          duration: "5 days",
        }).success
      ).toBe(false);

      // Missing duration
      expect(
        prescriptionItemSchema.safeParse({
          medicine_name: "Paracetamol 650",
          dosage: "1-0-1",
        }).success
      ).toBe(false);
    });
  });

  describe("Protocol Template & Custom Medicine Schemas", () => {
    it("validates protocol template schema with multiple items", () => {
      const validTemplate = {
        template_name: "Acute Bronchitis Standard Protocol",
        specialty: "general_physician",
        items: [
          {
            medicine_name: "Azithromycin 500mg Tablet",
            dosage: "1-0-0",
            timing: "After food",
            duration: "3 days",
          },
          {
            medicine_name: "Levosalbutamol + Guaiphenesin Syrup",
            dosage: "5 ml thrice daily",
            timing: "After food",
            duration: "5 days",
          },
        ],
      };

      const parsed = protocolTemplateSchema.safeParse(validTemplate);
      expect(parsed.success).toBe(true);
    });

    it("rejects protocol template when item list is empty", () => {
      const emptyTemplate = {
        template_name: "Empty Template",
        items: [],
      };

      const parsed = protocolTemplateSchema.safeParse(emptyTemplate);
      expect(parsed.success).toBe(false);
    });

    it("validates custom medicine save schema", () => {
      const customDrug = {
        medicine_name: "Doctor Special Calamine Lotion",
        dose_form: "Lotion",
        default_dosage: "Apply twice daily",
        default_duration: "7 days",
      };

      const parsed = saveCustomMedicineSchema.safeParse(customDrug);
      expect(parsed.success).toBe(true);
    });
  });
});
