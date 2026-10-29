import { describe, it, expect } from "vitest";
import referenceDataset from "../fixtures/reference-dataset.json";
import { extractStructuredSoap } from "@/lib/ai/soap-generator";
import { SoapDraftZodSchema } from "@/lib/ai/types";

describe("Phase 05.3 Evaluation: Indian Shorthand Normalization (D-13, Cases 1–11)", () => {
  const cases = referenceDataset.filter(
    (c) => c.category === "standard_opd" || c.category === "indian_shorthand"
  );

  it("loads all 11 standard and Indian shorthand reference cases", () => {
    expect(cases.length).toBe(11);
  });

  for (const tc of cases) {
    it(`evaluates ${tc.id}: ${tc.description}`, async () => {
      const draft = await extractStructuredSoap(tc.input, tc.context);

      // 1. Conforms to Zod Schema
      const validation = SoapDraftZodSchema.safeParse(draft);
      expect(validation.success).toBe(true);

      // 2. Chief complaints extraction
      expect(draft.chief_complaints.length).toBeGreaterThan(0);
      for (const cc of draft.chief_complaints) {
        expect(cc.complaint.trim().length).toBeGreaterThan(0);
        expect(cc.severity).toMatch(/^(mild|moderate|severe)$/);
      }

      // 3. Indian shorthand normalization assertions
      if (tc.id === "ref-01") {
        // Fever 2d, sore throat, difficulty swallowing
        expect(draft.chief_complaints.some((c) => /fever/i.test(c.complaint))).toBe(true);
        expect(draft.examination).toContain("pharynx congested");
        expect(draft.diagnosis_hypothesis).toMatch(/pharyngitis/i);
      }

      if (tc.id === "ref-07") {
        // Separates acute fever from chronic HTN/T2DM and OA
        const acuteComplaints = draft.chief_complaints.map((c) => c.complaint.toLowerCase());
        expect(acuteComplaints.some((c) => c.includes("fever"))).toBe(true);
        // Chronic HTN should not be duplicated as an acute chief complaint
        expect(acuteComplaints.some((c) => c === "k/c/o htn")).toBe(false);
      }

      if (tc.id === "ref-08") {
        // Pediatric loose stools + vomiting with dehydration check
        const complaintsStr = draft.chief_complaints.map((c) => c.complaint).join(" ");
        expect(complaintsStr).toMatch(/loose stools/i);
        expect(draft.examination).toMatch(/sunken eyes/i);
      }

      if (tc.id === "ref-10") {
        // Migraine with aura
        expect(draft.diagnosis_hypothesis).toMatch(/migraine/i);
        expect(draft.examination).toMatch(/neck supple/i);
      }

      // 4. Zero prohibited tokens in advice or complaints
      for (const prohibited of tc.prohibited_tokens || []) {
        const fullOutput = JSON.stringify(draft).toLowerCase();
        expect(fullOutput).not.toContain(prohibited.toLowerCase());
      }
    });
  }
});
