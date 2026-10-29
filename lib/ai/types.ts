import { z } from "zod";

export type AiProviderName =
  | "mock"
  | "openai"
  | "gemini"
  | "claude"
  | "groq"
  | "ollama"
  | "deepseek";

export interface AiClientConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
  provider?: AiProviderName;
}

export interface AiChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AnonymizedPatientContext {
  [key: string]: unknown;
  age?: number | string | null;
  sex?: string | null;
  existing_conditions?: string[];
  vitals?: Record<string, unknown> | null;
}

export const ChiefComplaintItemSchema = z.object({
  complaint: z.string().min(1, "Complaint cannot be empty"),
  duration: z.string().optional().default(""),
  severity: z.string().optional().default("moderate"),
});

export const SoapDraftZodSchema = z.object({
  chief_complaints: z.array(ChiefComplaintItemSchema).default([]),
  examination: z.string().default(""),
  diagnosis_hypothesis: z.string().optional().default(""),
  advice: z.string().default(""),
});

export type ChiefComplaintItem = z.infer<typeof ChiefComplaintItemSchema>;
export type SoapDraft = z.infer<typeof SoapDraftZodSchema>;

export interface CatchUpSummary {
  last_visit_date: string | null;
  last_diagnosis: string | null;
  active_medications: string[];
  bullets: string[];
}

export interface PrescriptionSuggestion {
  drug_name: string;
  dosage: string;
  frequency: string;
  duration: string;
  instructions: string | null;
  frequency_count: number;
}

// Phase 05.3 Schemas: ICD-10 suggestions, Screen Context & Operations Previews
export const Icd10CandidateSchema = z.object({
  code: z
    .string()
    .regex(/^[A-Z][0-9][0-9A-Z](\.[0-9A-Z]{1,4})?$/, "Invalid ICD-10 code format"),
  description: z.string(),
  differential_criteria: z
    .string()
    .describe('1-line "When to choose" clinical distinction bullet'),
});

export const Icd10RecommendationSchema = z.object({
  candidates: z.array(Icd10CandidateSchema).max(4),
});

export const ScreenContextSchema = z.object({
  screen: z.string(),
  role: z.string().optional(),
  selected_date: z.string().optional(),
  active_patient_id: z.string().uuid().optional(),
});

export const BookingPreviewDetailsSchema = z.object({
  patient_id: z.string().uuid(),
  patient_name: z.string(),
  phone: z.string().optional(),
  doctor_id: z.string().uuid(),
  doctor_name: z.string(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  start_time: z.string().regex(/^\d{2}:\d{2}$/, "Start time must be HH:MM"),
  consultation_type: z.enum(["in_person", "teleconsult"]).default("in_person"),
  fee: z.number().default(500),
  outside_shift_warning: z.boolean().default(false),
});

export const ReschedulePreviewDetailsSchema = z.object({
  appointment_id: z.string().uuid(),
  patient_name: z.string(),
  doctor_name: z.string(),
  old_date_time: z.string(),
  new_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  new_start_time: z.string().regex(/^\d{2}:\d{2}$/, "Start time must be HH:MM"),
});

export const CancelPreviewDetailsSchema = z.object({
  appointment_id: z.string().uuid(),
  patient_name: z.string(),
  doctor_name: z.string(),
  scheduled_at: z.string(),
  reason: z.string(),
});

export type Icd10Candidate = z.infer<typeof Icd10CandidateSchema>;
export type Icd10Recommendation = z.infer<typeof Icd10RecommendationSchema>;
export type ScreenContext = z.infer<typeof ScreenContextSchema>;
export type BookingPreviewDetails = z.infer<typeof BookingPreviewDetailsSchema>;
export type ReschedulePreviewDetails = z.infer<typeof ReschedulePreviewDetailsSchema>;
export type CancelPreviewDetails = z.infer<typeof CancelPreviewDetailsSchema>;
