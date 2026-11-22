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
 * One row of the medicine search (`GET /api/prescriptions/medicines`, V2-09c R-3): a CDCI brand or the calling doctor's own custom medicine. A custom row
 * carries the doctor's stored dosage, timing and duration (null when they stored none); a CDCI row carries none, never a default.
 */
export interface MedicineSearchResult {
  id: string;
  kind: "cdci" | "custom";
  medicine_name: string;
  generic_name: string | null;
  dose_form: string | null;
  substance_ids: string[];
  dosage: string | null;
  timing: string | null;
  duration: string | null;
}

/** The exact keys of a search row, in order (the route's projection; `tests/security/guard-manifest.ts` pins the same list). */
export const MEDICINE_SEARCH_KEYS = ["id", "kind", "medicine_name", "generic_name", "dose_form", "substance_ids", "dosage", "timing", "duration"] as const;

export const MEDICINE_SEARCH_LIMIT = 15;
export const MEDICINE_QUERY_MAX = 60;

/** An optional text that may be empty or null; the command stores an empty one as NULL. */
const optionalText = (max: number) => z.string().max(max).nullable().optional();

/** One medicine line of the `change_prescription` command (the rules of {@link prescriptionItemSchema}, closed key set). */
export const changeLineSchema = z
  .object({
    medicine_name: z.string().trim().min(1, "Medicine name is required").max(250),
    generic_name: optionalText(250),
    dose_form: optionalText(50),
    dosage: z.string().trim().min(1, "Dosage is required").max(50),
    timing: optionalText(100),
    duration: z.string().trim().min(1, "Duration is required").max(50),
    special_instructions: optionalText(500),
    cdci_brand_id: optionalText(100),
  })
  .strict();

export const changeUpdateSchema = z
  .object({
    id: z.string().uuid(),
    dosage: z.string().trim().min(1).max(50).optional(),
    timing: optionalText(100),
    duration: z.string().trim().min(1).max(50).optional(),
    special_instructions: optionalText(500),
  })
  .strict();

/** The input of the Rx change command: at least one operation, at most 30 of each kind, each item named once. */
export const changePrescriptionSchema = z
  .object({
    visit_id: z.string().uuid(),
    changes: z
      .object({
        add: z.array(changeLineSchema).max(30).optional(),
        update: z.array(changeUpdateSchema).max(30).optional(),
        remove: z.array(z.string().uuid()).max(30).optional(),
        // V2-09c 09C-02 (R-7, Q-4): the reason to prescribe a medicine that matches a recorded allergy, 5 to 300 characters.
        allergy_override_reason: z.string().trim().min(5, "Give a reason of at least 5 characters.").max(300).optional(),
      })
      .strict(),
    client_request_id: z.string().uuid(),
  })
  // Top level: unknown keys (a forged tenant_id or created_by) are dropped, never read; the tenant and the actor are the session's (ADR-0005 D1).
  .superRefine((value, ctx) => {
    const { add = [], update = [], remove = [] } = value.changes;
    if (add.length + update.length + remove.length === 0) ctx.addIssue({ code: "custom", message: "Nothing to change." });
    const named = [...update.map((u) => u.id), ...remove];
    if (new Set(named).size !== named.length) ctx.addIssue({ code: "custom", message: "An item is named twice." });
    update.forEach((u, i) => {
      if (u.dosage === undefined && u.duration === undefined && u.timing === undefined && u.special_instructions === undefined) {
        ctx.addIssue({ code: "custom", path: ["changes", "update", i], message: "Nothing to change on this item." });
      }
    });
  });

export type ChangePrescriptionInput = z.input<typeof changePrescriptionSchema>;
