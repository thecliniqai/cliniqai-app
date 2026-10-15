import { z } from "zod";

/**
 * Standard Indian OPD Dosage Frequencies.
 */
export const STANDARD_FREQUENCIES = [
  "1-0-1",
  "1-0-0",
  "0-0-1",
  "1-1-1",
  "1-0-1-0",
  "0-1-0",
  "1-1-1-1",
  "SOS",
  "Stat",
] as const;

export const dosageFrequencySchema = z
  .string()
  .min(1, "Frequency is required")
  .max(50);

/**
 * Standard Food Timing Relations.
 */
export const STANDARD_FOOD_RELATIONS = [
  "After food",
  "Before food",
  "With food",
  "Empty stomach",
] as const;

export const foodTimingSchema = z
  .string()
  .min(1, "Food relation is required")
  .max(100);

/**
 * Standard Prescribed Durations.
 */
export const STANDARD_DURATIONS = [
  "3d",
  "5d",
  "7d",
  "10d",
  "1w",
  "2w",
  "1m",
] as const;

export const durationSchema = z
  .string()
  .min(1, "Duration is required")
  .max(50);

/**
 * Normalizes short duration codes into readable clinical text.
 * e.g. "3d" -> "3 days", "1w" -> "1 week", "2w" -> "2 weeks", "1m" -> "1 month"
 */
export function normalizeDuration(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === "1d") return "1 day";
  if (/^\d+d$/.test(trimmed)) return `${trimmed.slice(0, -1)} days`;
  if (trimmed === "1w") return "1 week";
  if (/^\d+w$/.test(trimmed)) return `${trimmed.slice(0, -1)} weeks`;
  if (trimmed === "1m") return "1 month";
  if (/^\d+m$/.test(trimmed)) return `${trimmed.slice(0, -1)} months`;
  return raw.trim();
}

/**
 * Normalizes frequency string (standardizes 1-0-1 casing and spacing).
 */
export function normalizeFrequency(raw: string): string {
  const trimmed = raw.trim().toUpperCase();
  return trimmed;
}

/**
 * Schema for a single medication item in a prescription.
 */
export const prescriptionItemSchema = z.object({
  id: z.string().optional(),
  medicine_name: z.string().min(1, "Medicine name is required").max(250),
  generic_name: z.string().max(250).nullable().optional(),
  dose_form: z.string().max(50).nullable().optional(),
  dosage: z.string().min(1, "Dosage is required").max(50), // e.g. "1-0-1" or "625 mg"
  timing: z.string().max(100).nullable().optional(), // e.g. "After food"
  duration: z.string().min(1, "Duration is required").max(50), // e.g. "5 days"
  special_instructions: z.string().max(500).nullable().optional(),
  cdci_brand_id: z.string().nullable().optional(),
  cdci_generic_id: z.string().nullable().optional(),
  sort_order: z.number().int().default(0),
});

export type PrescriptionItemInput = z.input<typeof prescriptionItemSchema>;

/**
 * Schema for saving doctor custom medicine.
 */
export const saveCustomMedicineSchema = z.object({
  medicine_name: z.string().min(1, "Medicine name is required").max(250),
  generic_name: z.string().max(250).nullable().optional(),
  dose_form: z.string().max(50).nullable().optional(),
  default_dosage: z.string().max(50).nullable().optional(),
  default_timing: z.string().max(100).nullable().optional(),
  default_duration: z.string().max(50).nullable().optional(),
});

export type SaveCustomMedicineInput = z.infer<typeof saveCustomMedicineSchema>;

/**
 * Schema for doctor saved prescription protocol template.
 */
export const protocolTemplateSchema = z.object({
  template_name: z.string().min(1, "Template name is required").max(100),
  specialty: z.string().max(50).nullable().optional(),
  items: z.array(prescriptionItemSchema).min(1, "Template must include at least one medication"),
});

export type ProtocolTemplateInput = z.infer<typeof protocolTemplateSchema>;

/**
 * Drug search result item structure returned by search_medicines RPC.
 */
export interface MedicineSearchResult {
  id: string;
  medicine_name: string;
  generic_name: string | null;
  dose_form: string | null;
  default_dosage: string | null;
  default_timing: string | null;
  default_duration: string | null;
  is_custom: boolean;
  is_favorite: boolean;
}
