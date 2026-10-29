import { describe, it, expect } from "vitest";
import referenceDataset from "../fixtures/reference-dataset.json";
import { extractStructuredSoap } from "@/lib/ai/soap-generator";

describe("Phase 05.3 Evaluation: Negative Syllogism & Physical Exam Omission Immunity (D-14, Cases 12–16)", () => {
  const cases = referenceDataset.filter((c) => c.category === "negative_syllogism");

  it("loads all 5 negative syllogism test cases", () => {
    expect(cases.length).toBe(5);
  });

  // Regex defining fabricated normal organ system reviews
  const FABRICATED_NORMAL_ORGAN_REGEX =
    /(s1\s*s2|vesicular|breath\s*sounds|bowel\s*sounds|cranial\s*nerves|perrla|abdomen\s*soft|no\s*rhonchi|no\s*wheeze|chest\s*clear)/i;

  for (const tc of cases) {
    it(`guarantees zero hallucinated physical exam findings in ${tc.id}: ${tc.description}`, async () => {
      const draft = await extractStructuredSoap(tc.input, tc.context);

      // 1. Must never invent standard normal organ system reviews
      expect(draft.examination).not.toMatch(FABRICATED_NORMAL_ORGAN_REGEX);

      // 2. Specific case assertions
      if (tc.id === "ref-12") {
        // Fever only, no exam documented -> examination must be empty string
        expect(draft.examination).toBe("");
      }

      if (tc.id === "ref-13") {
        // Headache 1 day, no exam documented -> examination must be empty string
        expect(draft.examination).toBe("");
      }

      if (tc.id === "ref-14") {
        // Localized forearm rash -> examination strictly limited to the documented lesion
        expect(draft.examination).toMatch(/erythematous plaque|forearm/i);
        expect(draft.examination).not.toMatch(/chest|heart|abdomen|respiratory/i);
      }

      if (tc.id === "ref-15") {
        // Dental scaling request -> general physical exam must be blank
        expect(draft.examination).toBe("");
      }

      if (tc.id === "ref-16") {
        // Teleconsult nausea -> zero palpation/auscultation findings
        expect(draft.examination).toBe("");
        expect(draft.examination).not.toMatch(/palpation|auscultation|tenderness/i);
      }

      // 3. Prohibited tokens check
      for (const token of tc.prohibited_tokens || []) {
        expect(draft.examination.toLowerCase()).not.toContain(token.toLowerCase());
      }
    });
  }
});
