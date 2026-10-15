import { describe, it, expect } from "vitest";
import {
  dentalToothSchema,
  dentalSpecialtySchema,
  VALID_FDI_TEETH,
  DentalConditionTag,
} from "../../features/consultation/schema";

describe("Dental Odontogram & FDI Two-Digit Notation", () => {
  describe("FDI Tooth Numbering Validation", () => {
    it("validates all 32 adult permanent teeth (11-18, 21-28, 31-38, 41-48)", () => {
      const adultQuadrants = [
        [11, 12, 13, 14, 15, 16, 17, 18], // Maxillary Right (Q1)
        [21, 22, 23, 24, 25, 26, 27, 28], // Maxillary Left (Q2)
        [31, 32, 33, 34, 35, 36, 37, 38], // Mandibular Left (Q3)
        [41, 42, 43, 44, 45, 46, 47, 48], // Mandibular Right (Q4)
      ];

      for (const quadrant of adultQuadrants) {
        for (const toothNum of quadrant) {
          expect(VALID_FDI_TEETH.has(toothNum)).toBe(true);
          const parsed = dentalToothSchema.safeParse({
            tooth_number: toothNum,
            condition_tags: [],
          });
          expect(parsed.success).toBe(true);
        }
      }
    });

    it("validates all 20 deciduous / primary pediatric teeth (51-55, 61-65, 71-75, 81-85)", () => {
      const deciduousQuadrants = [
        [51, 52, 53, 54, 55], // Deciduous Maxillary Right (Q5)
        [61, 62, 63, 64, 65], // Deciduous Maxillary Left (Q6)
        [71, 72, 73, 74, 75], // Deciduous Mandibular Left (Q7)
        [81, 82, 83, 84, 85], // Deciduous Mandibular Right (Q8)
      ];

      for (const quadrant of deciduousQuadrants) {
        for (const toothNum of quadrant) {
          expect(VALID_FDI_TEETH.has(toothNum)).toBe(true);
          const parsed = dentalToothSchema.safeParse({
            tooth_number: toothNum,
            condition_tags: [],
          });
          expect(parsed.success).toBe(true);
        }
      }
    });

    it("strictly rejects non-existent FDI numbers and boundaries", () => {
      const invalidNumbers = [0, 9, 10, 19, 20, 29, 30, 39, 40, 49, 50, 56, 60, 66, 70, 76, 80, 86, 99, 101];

      for (const invalidNum of invalidNumbers) {
        expect(VALID_FDI_TEETH.has(invalidNum)).toBe(false);
        const parsed = dentalToothSchema.safeParse({
          tooth_number: invalidNum,
          condition_tags: [],
        });
        expect(parsed.success).toBe(false);
      }
    });
  });

  describe("Condition Tags & Tooth Data Serialization", () => {
    it("accepts valid condition tags and optional notes", () => {
      const validTags: DentalConditionTag[] = ["decay", "crown", "missing", "rct", "filled", "extraction"];

      for (const tag of validTags) {
        const parsed = dentalToothSchema.safeParse({
          tooth_number: 16,
          condition_tags: [tag],
          notes: `Observed ${tag} on occlusal surface`,
        });
        expect(parsed.success).toBe(true);
      }
    });

    it("allows multiple conditions on a single tooth (e.g., RCT + Crown)", () => {
      const tooth = {
        tooth_number: 26,
        condition_tags: ["rct", "crown"] as DentalConditionTag[],
        notes: "Completed RCT on 2026-09-01; PFM crown placed",
      };

      const parsed = dentalToothSchema.safeParse(tooth);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.condition_tags).toHaveLength(2);
        expect(parsed.data.condition_tags).toContain("rct");
        expect(parsed.data.condition_tags).toContain("crown");
      }
    });

    it("rejects invalid condition tags", () => {
      const tooth = {
        tooth_number: 11,
        condition_tags: ["chipped_enamel", "discolored"],
      };

      const parsed = dentalToothSchema.safeParse(tooth);
      expect(parsed.success).toBe(false);
    });

    it("validates full dental specialty schema payload", () => {
      const specialtyPayload = {
        specialty: "dental" as const,
        odontogram: [
          {
            tooth_number: 16,
            condition_tags: ["decay"] as DentalConditionTag[],
            notes: "Deep occlusal caries, tender on percussion",
          },
          {
            tooth_number: 46,
            condition_tags: ["filled"] as DentalConditionTag[],
            notes: "Amalgam restoration intact",
          },
          {
            tooth_number: 38,
            condition_tags: ["missing"] as DentalConditionTag[],
            notes: "Congenitally absent",
          },
        ],
        general_notes: "Generalized plaque accumulation. Scaling and polishing recommended.",
      };

      const parsed = dentalSpecialtySchema.safeParse(specialtyPayload);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.odontogram).toHaveLength(3);
        expect(parsed.data.odontogram[0].tooth_number).toBe(16);
      }
    });
  });
});
