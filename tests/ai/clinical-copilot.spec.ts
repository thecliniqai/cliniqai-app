import React from "react";
import { renderToString } from "react-dom/server";
import { describe, it, expect, vi } from "vitest";
import { ClinicalCopilotPanel, STATUTORY_DISCLAIMER } from "@/components/consultation/clinical-copilot-panel";
import { AppendReplaceModal } from "@/components/consultation/append-replace-modal";
import { IcdCodeSuggestionCard } from "@/components/consultation/icd-code-suggestion-card";
import { saveConsultationDraftSchema } from "@/features/consultation/schema";

describe("Phase 05.3 Clinical Copilot Components & Integration (05.3-03)", () => {
  describe("1. ClinicalCopilotPanel Rendering & Tabs", () => {
    it("returns null when isOpen is false", () => {
      const html = renderToString(
        React.createElement(ClinicalCopilotPanel, {
          isOpen: false,
          onClose: vi.fn(),
          onInsertChiefComplaints: vi.fn(),
          onInsertExamination: vi.fn(),
          onInsertAdvice: vi.fn(),
          onInsertAllSoap: vi.fn(),
          onApplyDiagnosis: vi.fn(),
        })
      );

      expect(html).toBe("");
    });

    it("renders dockable panel header, tabs, and de-identification banner when isOpen is true", () => {
      const html = renderToString(
        React.createElement(ClinicalCopilotPanel, {
          isOpen: true,
          onClose: vi.fn(),
          onInsertChiefComplaints: vi.fn(),
          onInsertExamination: vi.fn(),
          onInsertAdvice: vi.fn(),
          onInsertAllSoap: vi.fn(),
          onApplyDiagnosis: vi.fn(),
        })
      );

      expect(html).toContain("Clinical Copilot");
      expect(html).toContain("De-identified Query (Direct PII removed)");
      expect(html).toContain("SOAP Notes");
      expect(html).toContain("ICD-10");
      expect(html).toContain("Clinical Q&amp;A");
      expect(html).toContain("Generate SOAP Draft");
    });

    it("renders Zero Autonomous Prescribing guard notice in SOAP tab", () => {
      const html = renderToString(
        React.createElement(ClinicalCopilotPanel, {
          isOpen: true,
          onClose: vi.fn(),
          onInsertChiefComplaints: vi.fn(),
          onInsertExamination: vi.fn(),
          onInsertAdvice: vi.fn(),
          onInsertAllSoap: vi.fn(),
          onApplyDiagnosis: vi.fn(),
        })
      );

      expect(html).toContain("Zero Autonomous Prescribing");
      expect(html).toContain("Medications cannot be drafted autonomously");
    });

    it("renders granular section insertion buttons and Insert All Sections when draft is available", () => {
      const mockDraft = {
        chief_complaints: [{ complaint: "Fever", duration: "3 days", severity: "moderate" }],
        examination: "Throat congested, clear chest",
        advice: "Rest and warm oral fluids",
        diagnosis_hypothesis: "Acute Pharyngitis",
      };

      const html = renderToString(
        React.createElement(ClinicalCopilotPanel, {
          isOpen: true,
          initialDraft: mockDraft,
          onClose: vi.fn(),
          onInsertChiefComplaints: vi.fn(),
          onInsertExamination: vi.fn(),
          onInsertAdvice: vi.fn(),
          onInsertAllSoap: vi.fn(),
          onApplyDiagnosis: vi.fn(),
        })
      );

      expect(html).toContain("Insert Chief Complaints");
      expect(html).toContain("Insert Examination Findings");
      expect(html).toContain("Insert Clinical Advice");
      expect(html).toContain("Insert All Sections");
      expect(html).toContain("Throat congested, clear chest");
      expect(html).toContain("Rest and warm oral fluids");
    });
  });

  describe("2. AppendReplaceModal Collision Prompt", () => {
    it("renders collision warning, existing content preview, and new draft preview", () => {
      const html = renderToString(
        React.createElement(AppendReplaceModal, {
          isOpen: true,
          sectionName: "Chief Complaints",
          existingContent: "Fever (3 days)",
          newContent: "Fever (4 days), Cough (2 days)",
          onAppend: vi.fn(),
          onReplace: vi.fn(),
          onCancel: vi.fn(),
        })
      );

      expect(html).toContain("Existing Notes Detected in Chief Complaints");
      expect(html).toContain("Fever (3 days)");
      expect(html).toContain("Fever (4 days), Cough (2 days)");
      expect(html).toContain("Append to Existing Notes");
      expect(html).toContain("Replace Existing Notes");
      expect(html).toContain("Cancel");
    });

    it("returns null when isOpen is false", () => {
      const html = renderToString(
        React.createElement(AppendReplaceModal, {
          isOpen: false,
          sectionName: "Examination",
          existingContent: "Normal chest",
          newContent: "Bilateral wheezing",
          onAppend: vi.fn(),
          onReplace: vi.fn(),
          onCancel: vi.fn(),
        })
      );

      expect(html).toBe("");
    });
  });

  describe("3. IcdCodeSuggestionCard & Diagnostic Criteria", () => {
    it("renders candidate ICD-10 code, description, match score badge, and differential criteria", () => {
      const candidate = {
        code: "J06.9",
        description: "Acute upper respiratory infection, unspecified",
        match_score: 0.94,
        differential_criteria: [
          "Acute onset cough and rhinorrhea (<14 days)",
          "Absence of lower respiratory consolidation",
          "Normal respiratory rate without stridor",
        ],
      };

      const html = renderToString(
        React.createElement(IcdCodeSuggestionCard, {
          candidate,
          onApply: vi.fn(),
          isApplied: false,
        })
      );

      expect(html).toContain("J06.9");
      expect(html).toContain("Acute upper respiratory infection, unspecified");
      expect(html).toContain("94% match");
      expect(html).toContain("Acute onset cough and rhinorrhea (&lt;14 days)");
      expect(html).toContain("Apply Code");
    });

    it("renders applied checkmark state when isApplied is true", () => {
      const candidate = {
        code: "J02.9",
        description: "Acute pharyngitis, unspecified",
        match_score: 0.88,
        differential_criteria: ["Erythematous posterior pharynx"],
      };

      const html = renderToString(
        React.createElement(IcdCodeSuggestionCard, {
          candidate,
          onApply: vi.fn(),
          isApplied: true,
        })
      );

      expect(html).toContain("Applied ✓");
      expect(html).toContain("aria-disabled");
    });
  });

  describe("4. Statutory Clinical Advisory Disclaimer", () => {
    it("contains exact statutory NMC/regulatory clinical disclaimer text in the component definition and Q&A tab", () => {
      expect(STATUTORY_DISCLAIMER).toContain("Clinical Advisory");
      expect(STATUTORY_DISCLAIMER).toContain("informational assistant");
      expect(STATUTORY_DISCLAIMER).toContain("independent clinical judgment");

      // Render the panel with initialTab="qa"
      const html = renderToString(
        React.createElement(ClinicalCopilotPanel, {
          isOpen: true,
          initialTab: "qa",
          onClose: vi.fn(),
          onInsertChiefComplaints: vi.fn(),
          onInsertExamination: vi.fn(),
          onInsertAdvice: vi.fn(),
          onInsertAllSoap: vi.fn(),
          onApplyDiagnosis: vi.fn(),
        })
      );

      // Verify that the statutory disclaimer substring is present in rendered HTML
      expect(html).toContain("Clinical Advisory");
      expect(html).toContain("informational assistant");
      expect(html).toContain("independent clinical judgment");
    });
  });

  describe("5. Consultation Draft Provenance Metadata Validation", () => {
    it("validates consultation draft payload with ai_assisted: true and ai_sections_used in metadata", () => {
      const draftWithAiProvenance = {
        visit_id: "00000000-0000-0000-0000-000000000001",
        vitals: {
          systolic: 120,
          diastolic: 80,
          pulse: 72,
        },
        chief_complaints: [
          {
            symptom: "Fever with chills",
            duration_val: 3,
            duration_unit: "days" as const,
          },
        ],
        clinical_notes: "[O/E]: Throat congested, bilateral tonsillar injection.",
        specialty: "general_physician" as const,
        advice: ["Warm water gargles", "Adequate rest"],
        investigations_advised: ["Complete Blood Count (CBC)"],
        metadata: {
          ai_assisted: true,
          ai_sections_used: ["chief_complaints", "examination", "advice"],
          copilot_model: "gpt-4o-mini",
        },
      };

      const result = saveConsultationDraftSchema.safeParse(draftWithAiProvenance);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.metadata?.ai_assisted).toBe(true);
        expect(result.data.metadata?.ai_sections_used).toEqual([
          "chief_complaints",
          "examination",
          "advice",
        ]);
      }
    });

    it("validates consultation draft without AI metadata (unassisted visit)", () => {
      const unassistedDraft = {
        visit_id: "00000000-0000-0000-0000-000000000002",
        chief_complaints: [
          {
            symptom: "Routine checkup",
            duration_val: 1,
            duration_unit: "days" as const,
          },
        ],
        specialty: "general_physician" as const,
      };

      const result = saveConsultationDraftSchema.safeParse(unassistedDraft);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.metadata).toBeUndefined();
      }
    });
  });
});
