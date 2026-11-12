import { z } from "zod";

/** OpenAI-compatible providers the gateway client can address. There is no "mock" provider (AI-01). */
export type AiProviderName =
  | "openai"
  | "gemini"
  | "claude"
  | "groq"
  | "ollama"
  | "deepseek";

/** A complete provider configuration; nothing in it is defaulted. */
export interface AiProviderConfig {
  provider: AiProviderName;
  baseUrl: string;
  apiKey: string;
  model: string;
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
