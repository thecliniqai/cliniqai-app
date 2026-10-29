import { describe, it, expect } from "vitest";
import { getClinicalTools } from "@/lib/ai/tools/clinical-tools";

describe("Phase 05.3 Evaluation: ICD-10 Ranking & Differential Criteria (D-10, AI-SPEC §5)", () => {
  const tools = getClinicalTools({
    tenantId: "test-tenant-1",
    userId: "test-doc-1",
    role: "doctor",
  });

  const ICD10_BILLABLE_CODE_REGEX = /^[A-Z][0-9][0-9A-Z](\.[0-9A-Z]{1,4})?$/;

  const testQueries = [
    { query: "acute pharyngitis with fever", expectedKeyword: "pharyngitis" },
    { query: "type 2 diabetes mellitus follow up", expectedKeyword: "diabetes" },
    { query: "bronchial asthma with nocturnal wheezing", expectedKeyword: "asthma" },
    { query: "stage 1 essential hypertension", expectedKeyword: "hypertension" },
    { query: "acute otitis media right ear", expectedKeyword: "otitis" },
  ];

  for (const { query, expectedKeyword } of testQueries) {
    it(`suggests specific ICD-10 codes with differential criteria for: "${query}"`, async () => {
      // Execute suggest_icd10 tool
      const res = await (tools.suggest_icd10 as any).execute({ query });

      expect(res).toBeDefined();
      expect(res.candidates).toBeDefined();
      expect(Array.isArray(res.candidates)).toBe(true);

      // 1. Returns 1 to 4 ranked candidates
      expect(res.candidates.length).toBeGreaterThanOrEqual(1);
      expect(res.candidates.length).toBeLessThanOrEqual(4);

      // 2. Contains expected clinical diagnosis candidate
      const hasExpectedCandidate = res.candidates.some(
        (c: any) =>
          c.description.toLowerCase().includes(expectedKeyword) ||
          c.code.toLowerCase().includes(expectedKeyword)
      );
      expect(hasExpectedCandidate).toBe(true);

      // 3. Validation for each candidate
      for (const candidate of res.candidates) {
        // Valid billable ICD-10 format
        expect(candidate.code).toMatch(ICD10_BILLABLE_CODE_REGEX);
        expect(candidate.description.trim().length).toBeGreaterThan(0);

        // Differential criteria explaining "When to choose"
        expect(candidate.differential_criteria).toBeDefined();
        expect(typeof candidate.differential_criteria).toBe("string");
        expect(candidate.differential_criteria.trim().length).toBeGreaterThan(15);
        expect(candidate.differential_criteria).toMatch(/when|select|presentation|indicates/i);
      }
    });
  }

  it("blocks non-clinical roles from executing ICD-10 suggestions", async () => {
    const nurseTools = getClinicalTools({
      tenantId: "test-tenant-1",
      userId: "test-nurse-1",
      role: "nurse",
    });

    await expect(
      (nurseTools.suggest_icd10 as any).execute({ query: "fever" })
    ).rejects.toThrow("UNAUTHORIZED_ROLE");
  });
});
