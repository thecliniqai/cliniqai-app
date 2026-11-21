import { describe, it, expect, vi } from "vitest";
import { getDoctorFrequentPrescriptions } from "@/lib/ai/prescription-suggestions";
import type { AiChatClient } from "@/lib/ai/client";
import { mockCtx } from "../helpers/context";

// AI-01: tests inject a fake adapter; there is no mock provider.
function fakeAiClient(output: string) {
  const chatCompletion = vi.fn<AiChatClient["chatCompletion"]>().mockResolvedValue(output);
  return { client: { chatCompletion } satisfies AiChatClient, chatCompletion };
}

describe("Wave 3: Deterministic Historical Prescription Suggestions (REQ-ai-features, T-05-11, T-05-10)", () => {
  describe("Zero-Hallucination SQL Suggestions (T-05-11)", () => {
    it("returns empty array immediately when diagnosis string is too short or empty", async () => {
      const results1 = await getDoctorFrequentPrescriptions(mockCtx({}, { tenantId: "tenant-123" }), {
        doctorId: "doc-456",
        diagnosis: "",
      });
      expect(results1).toEqual([]);

      const results2 = await getDoctorFrequentPrescriptions(mockCtx({}, { tenantId: "tenant-123" }), {
        doctorId: "doc-456",
        diagnosis: "a",
      });
      expect(results2).toEqual([]);
    });

    it("queries doctor's past signed prescriptions filtered by diagnosis string and ranks by frequency", async () => {
      // Mock Supabase with consultation_diagnoses, prescriptions, and prescription_items
      const mockDiagnoses = [{ visit_id: "visit-1" }, { visit_id: "visit-2" }];
      const mockPrescriptions = [{ id: "rx-1" }, { id: "rx-2" }];
      const mockItems = [
        {
          medicine_name: "Azithromycin 500mg",
          dosage: "1 tab",
          timing: "1-0-0",
          duration: "3 days",
          special_instructions: "After food",
        },
        {
          medicine_name: "Azithromycin 500mg",
          dosage: "1 tab",
          timing: "1-0-0",
          duration: "3 days",
          special_instructions: "After food",
        },
        {
          medicine_name: "Paracetamol 650mg",
          dosage: "1 tab",
          timing: "1-0-1",
          duration: "5 days",
          special_instructions: "SOS",
        },
        {
          medicine_name: "Azithromycin 500mg",
          dosage: "1 tab",
          timing: "1-0-0",
          duration: "3 days",
          special_instructions: "After food",
        },
      ];

      const mockSupabase = {
        from: vi.fn((table: string) => {
          if (table === "consultation_diagnoses") {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              ilike: vi.fn().mockReturnThis(),
              limit: vi.fn().mockResolvedValue({ data: mockDiagnoses, error: null }),
            };
          }
          if (table === "prescriptions") {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              in: vi.fn().mockResolvedValue({ data: mockPrescriptions, error: null }),
            };
          }
          if (table === "prescription_items") {
            return {
              select: vi.fn().mockReturnThis(),
              in: vi.fn().mockResolvedValue({ data: mockItems, error: null }),
            };
          }
          return {};
        }),
      };

      const suggestions = await getDoctorFrequentPrescriptions(mockCtx(mockSupabase, { tenantId: "tenant-123" }), {
        doctorId: "doc-456",
        diagnosis: "Pharyngitis",
      });

      expect(suggestions).toHaveLength(2);
      // Top drug should be Azithromycin with count 3
      expect(suggestions[0].drug_name).toBe("Azithromycin 500mg");
      expect(suggestions[0].frequency_count).toBe(3);
      expect(suggestions[0].dosage).toBe("1 tab");
      expect(suggestions[0].frequency).toBe("1-0-0");
      expect(suggestions[0].duration).toBe("3 days");

      // Second drug should be Paracetamol with count 1
      expect(suggestions[1].drug_name).toBe("Paracetamol 650mg");
      expect(suggestions[1].frequency_count).toBe(1);
    });

    it("returns empty list without throwing when no prior prescriptions match diagnosis", async () => {
      const mockSupabase = {
        from: vi.fn(() => ({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          ilike: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({ data: [], error: null }),
        })),
      };

      const suggestions = await getDoctorFrequentPrescriptions(mockCtx(mockSupabase, { tenantId: "tenant-123" }), {
        doctorId: "doc-456",
        diagnosis: "UnusualRareCondition",
      });

      expect(suggestions).toEqual([]);
    });

    it("handles database query errors gracefully by returning empty array", async () => {
      const mockSupabase = {
        from: vi.fn(() => ({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          ilike: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({ data: null, error: new Error("DB Error") }),
        })),
      };

      const suggestions = await getDoctorFrequentPrescriptions(mockCtx(mockSupabase, { tenantId: "tenant-123" }), {
        doctorId: "doc-456",
        diagnosis: "Fever",
      });

      expect(suggestions).toEqual([]);
    });
  });
});
