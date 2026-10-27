import { describe, it, expect, vi } from "vitest";
import { getDoctorFrequentPrescriptions } from "@/lib/ai/prescription-suggestions";
import { generatePatientCatchUpSummary } from "@/lib/ai/catch-up-summary";
import { OpenAiGatewayClient } from "@/lib/ai/client";

describe("Wave 3: Deterministic Historical Prescription Suggestions & Catch-Up Summary (REQ-ai-features, T-05-11, T-05-10)", () => {
  describe("Zero-Hallucination SQL Suggestions (T-05-11)", () => {
    it("returns empty array immediately when diagnosis string is too short or empty", async () => {
      const results1 = await getDoctorFrequentPrescriptions({
        tenantId: "tenant-123",
        doctorId: "doc-456",
        diagnosis: "",
      });
      expect(results1).toEqual([]);

      const results2 = await getDoctorFrequentPrescriptions({
        tenantId: "tenant-123",
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

      const suggestions = await getDoctorFrequentPrescriptions({
        tenantId: "tenant-123",
        doctorId: "doc-456",
        diagnosis: "Pharyngitis",
        clientOverride: mockSupabase,
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

      const suggestions = await getDoctorFrequentPrescriptions({
        tenantId: "tenant-123",
        doctorId: "doc-456",
        diagnosis: "UnusualRareCondition",
        clientOverride: mockSupabase,
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

      const suggestions = await getDoctorFrequentPrescriptions({
        tenantId: "tenant-123",
        doctorId: "doc-456",
        diagnosis: "Fever",
        clientOverride: mockSupabase,
      });

      expect(suggestions).toEqual([]);
    });
  });

  describe("Returning Patient Catch-Up Summary (REQ-ai-features)", () => {
    it("returns first visit message when patient has no prior visits", async () => {
      const mockSupabase = {
        from: vi.fn(() => ({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({ data: [], error: null }),
        })),
      };

      const summary = await generatePatientCatchUpSummary({
        tenantId: "tenant-123",
        patientId: "patient-new",
        clientOverride: mockSupabase,
      });

      expect(summary.last_visit_date).toBeNull();
      expect(summary.last_diagnosis).toBeNull();
      expect(summary.active_medications).toEqual([]);
      expect(summary.bullets).toContain("First recorded encounter for this patient in ClinicOS.");
    });

    it("synthesizes prior visits into a 3-bullet clinical brief using AI gateway", async () => {
      const mockVisits = [
        { id: "visit-1", scheduled_at: "2026-10-15T10:00:00Z", created_at: "2026-10-15T10:00:00Z" },
        { id: "visit-2", scheduled_at: "2026-09-01T10:00:00Z", created_at: "2026-09-01T10:00:00Z" },
      ];
      const mockDiagnoses = [
        { visit_id: "visit-1", diagnosis_name: "Essential Hypertension" },
        { visit_id: "visit-2", diagnosis_name: "Type 2 Diabetes" },
      ];
      const mockRxList = [{ id: "rx-1", visit_id: "visit-1" }];
      const mockItems = [
        { prescription_id: "rx-1", medicine_name: "Telmisartan 40mg", dosage: "1 tab" },
        { prescription_id: "rx-1", medicine_name: "Metformin 500mg", dosage: "1 tab" },
      ];

      const mockSupabase = {
        from: vi.fn((table: string) => {
          if (table === "visits") {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              in: vi.fn().mockReturnThis(),
              order: vi.fn().mockReturnThis(),
              limit: vi.fn().mockResolvedValue({ data: mockVisits, error: null }),
            };
          }
          if (table === "consultation_diagnoses") {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              in: vi.fn().mockResolvedValue({ data: mockDiagnoses, error: null }),
            };
          }
          if (table === "prescriptions") {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              in: vi.fn().mockResolvedValue({ data: mockRxList, error: null }),
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

      const mockAiClient = new OpenAiGatewayClient({ provider: "mock" });
      const mockChatCompletion = vi.spyOn(mockAiClient, "chatCompletion").mockResolvedValue(
        JSON.stringify({
          bullets: [
            "Last seen 12 days ago for Essential Hypertension.",
            "Active medications: Telmisartan 40mg, Metformin 500mg.",
            "Check BP control and compliance with anti-hypertensive regimen.",
          ],
        })
      );

      const summary = await generatePatientCatchUpSummary({
        tenantId: "tenant-123",
        patientId: "patient-regular",
        clientOverride: mockSupabase,
        aiClientOverride: mockAiClient,
      });

      expect(mockChatCompletion).toHaveBeenCalled();
      expect(summary.last_visit_date).toBe("2026-10-15T10:00:00Z");
      expect(summary.last_diagnosis).toBe("Essential Hypertension");
      expect(summary.active_medications).toEqual(["Telmisartan 40mg", "Metformin 500mg"]);
      expect(summary.bullets).toHaveLength(3);
      expect(summary.bullets[0]).toContain("Essential Hypertension");
    });
  });
});
