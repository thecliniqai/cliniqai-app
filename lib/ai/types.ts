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
