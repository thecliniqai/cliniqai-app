import { z } from "zod";

/**
 * Schema for querying Indian OPD diagnosis catalog & doctor custom diagnoses.
 */
export const searchDiagnosesSchema = z.object({
  query: z.string().min(1, "Search query is required").max(100),
  specialty: z.string().optional(),
  limit: z.number().int().min(1).max(50).default(20),
});

export type SearchDiagnosesInput = z.infer<typeof searchDiagnosesSchema>;

/**
 * Diagnosis search result item structure.
 */
export interface DiagnosisSearchResult {
  id: string;
  name: string;
  icd11_code: string | null;
  snomed_concept_id: string | null;
  category: string | null;
  specialties: string[];
  is_chronic: boolean;
  is_custom: boolean;
  use_count?: number;
}

/**
 * Schema for adding a diagnosis to a consultation visit.
 */
export const addConsultationDiagnosisSchema = z.object({
  visit_id: z.string().uuid("Invalid visit ID"),
  patient_id: z.string().uuid("Invalid patient ID"),
  diagnosis_name: z.string().min(1, "Diagnosis name is required").max(250),
  snomed_concept_id: z.string().max(50).nullable().optional(),
  icd11_code: z.string().max(50).nullable().optional(),
  is_custom: z.boolean().default(false),
  is_chronic: z.boolean().default(false),
  notes: z.string().max(500).nullable().optional(),
});

export type AddConsultationDiagnosisInput = z.infer<typeof addConsultationDiagnosisSchema>;

/**
 * Schema for updating an inline diagnosis remark.
 */
export const updateDiagnosisNoteSchema = z.object({
  diagnosis_id: z.string().uuid("Invalid diagnosis ID"),
  visit_id: z.string().uuid("Invalid visit ID"),
  notes: z.string().max(500).nullable(),
});

export type UpdateDiagnosisNoteInput = z.infer<typeof updateDiagnosisNoteSchema>;

/**
 * Diagnosis item for active consultation display.
 */
export interface ConsultationDiagnosisItem {
  id: string;
  visit_id: string;
  patient_id: string;
  diagnosis_name: string;
  snomed_concept_id: string | null;
  icd11_code: string | null;
  is_custom: boolean;
  is_chronic: boolean;
  notes: string | null;
  created_at: string;
}
