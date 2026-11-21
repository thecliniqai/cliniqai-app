import { z } from "zod";
import { clientRequestIdSchema } from "@/lib/commands/request-id";

/**
 * Vitals measurement bounds and clinical validation schema (caller input).
 * Enforces systolic > diastolic when both blood pressure values are present.
 * `recorded_by` is not an input field: the recorder is always derived from the session (ADR-0005 D1, SEC-02);
 * zod strips a caller-sent value. It exists only on the stored shape, `Vitals`, below.
 */
const vitalsFieldsSchema = z.object({
    systolic:z.number().int().min(50, "Systolic BP must be >= 50").max(250, "Systolic BP must be <= 250").nullable().optional(),
    diastolic: z.number().int().min(30, "Diastolic BP must be >= 30").max(150, "Diastolic BP must be <= 150").nullable().optional(),
    pulse: z.number().int().min(30, "Pulse must be >= 30").max(220, "Pulse must be <= 220").nullable().optional(),
    temperature: z.number().min(90, "Temperature must be >= 90°F").max(110, "Temperature must be <= 110°F").nullable().optional(),
    spo2: z.number().int().min(50, "SpO2 must be >= 50%").max(100, "SpO2 must be <= 100%").nullable().optional(),
    weight: z.number().min(0.5, "Weight must be >= 0.5 kg").max(300, "Weight must be <= 300 kg").nullable().optional(),
    height: z.number().min(20, "Height must be >= 20 cm").max(250, "Height must be <= 250 cm").nullable().optional(),
    respiratory_rate: z.number().int().min(8, "Respiratory rate must be >= 8").max(60, "Respiratory rate must be <= 60").nullable().optional(),
    bmi: z.number().nullable().optional(),
    /** Blood sugar (mg/dL) and what it was taken as; written by the triage VitalsForm (V2-08). */
    sugar: z.number().min(10, "Blood sugar must be >= 10 mg/dL").max(1000, "Blood sugar must be <= 1000 mg/dL").nullable().optional(),
    sugar_type: z.enum(["random", "fasting", "pp"]).nullable().optional(),
    recorded_at: z.string().nullable().optional(),
  });

const bloodPressureOrder = {
  check: (data: { systolic?: number | null; diastolic?: number | null }) => {
    if (data.systolic != null && data.diastolic != null) {
      return data.systolic > data.diastolic;
    }
    return true;
  },
  options: {
    message: "Systolic BP must be strictly greater than diastolic BP",
    path: ["systolic"],
  },
};

export const vitalsSchema = vitalsFieldsSchema.refine(bloodPressureOrder.check, bloodPressureOrder.options);

/** Stored vitals (clinical_notes.vitals JSONB since V2-05 05-02a): the validated measurements plus the server-set recorder. */
export type Vitals = z.infer<typeof vitalsSchema> & { recorded_by?: string | null };

/**
 * Input accepted by `recordVisitVitals`. `recorded_by` is not an input: the recorder is always the session user
 * (ADR-0005 D1, SEC-02); a caller-sent value is stripped by zod.
 */
export const recordVitalsInputSchema = vitalsSchema;

export type RecordVitalsInput = z.infer<typeof recordVitalsInputSchema>;

/**
 * Chief Complaint item schema with symptom name and duration.
 */
export const chiefComplaintItemSchema = z.object({
  id: z.string().optional(),
  symptom: z.string().min(1, "Symptom is required").max(200),
  // V2-09b 09B-04b (Q-16): a complaint typed in shorthand without a duration has none; no default is invented, and every reader prints a duration only when present.
  duration_val: z.number().int().positive("Duration must be a positive number").optional(),
  duration_unit: z.enum(["days", "weeks", "months", "years"]).optional(),
  notes: z.string().max(500).nullable().optional(),
});

export type ChiefComplaintItem = z.infer<typeof chiefComplaintItemSchema>;

/**
 * Valid FDI Tooth Numbers:
 * Adult teeth: 11-18, 21-28, 31-38, 41-48
 * Deciduous / Pediatric teeth: 51-55, 61-65, 71-75, 81-85
 */
export const VALID_FDI_TEETH = new Set([
  // Maxillary Right (Q1) & Left (Q2) Adult
  11, 12, 13, 14, 15, 16, 17, 18,
  21, 22, 23, 24, 25, 26, 27, 28,
  // Mandibular Left (Q3) & Right (Q4) Adult
  31, 32, 33, 34, 35, 36, 37, 38,
  41, 42, 43, 44, 45, 46, 47, 48,
  // Deciduous Maxillary Right (Q5) & Left (Q6)
  51, 52, 53, 54, 55,
  61, 62, 63, 64, 65,
  // Deciduous Mandibular Left (Q7) & Right (Q8)
  71, 72, 73, 74, 75,
  81, 82, 83, 84, 85,
]);

export const dentalConditionTags = z.enum([
  "decay",
  "crown",
  "missing",
  "rct",
  "filled",
  "extraction",
]);

export type DentalConditionTag = z.infer<typeof dentalConditionTags>;

export const dentalToothSchema = z.object({
  tooth_number: z.number().int().refine((num) => VALID_FDI_TEETH.has(num), {
    message: "Invalid FDI tooth number. Must be 11-48 or 51-85.",
  }),
  condition_tags: z.array(dentalConditionTags).default([]),
  notes: z.string().max(250).nullable().optional(),
});

export type DentalTooth = z.infer<typeof dentalToothSchema>;

/**
 * Discriminated union schemas for Specialty Data payloads.
 */
/**
 * V2-09b 09B-03 (R-9): the structured exam the template tiles write, `specialty_data.exam`. One entry per system of the chosen template; the normal
 * text of a system lives in the template (features/consultation/exam-templates.ts), so a system with `abnormal: false` stores nothing else. A pure
 * function (features/consultation/exam-text.ts) mirrors it into `systemic` for the readers that predate it.
 */
export const EXAM_SIDES = ["Right", "Left", "Bilateral"] as const;
export const examSystemSchema = z.object({
  abnormal: z.boolean(),
  findings: z.array(z.string().min(1).max(80)).max(20),
  side: z.enum(EXAM_SIDES).nullable().optional(),
  note: z.string().max(200).nullable().optional(),
});
export const examSchema = z.object({
  template_id: z.string().regex(/^[a-z0-9_]{1,24}$/),
  systems: z.record(z.string().regex(/^[a-z0-9_]{1,16}$/), examSystemSchema),
});
export type ExamSystemState = z.infer<typeof examSystemSchema>;
export type ExamState = z.infer<typeof examSchema>;

export const gpSpecialtySchema = z.object({
  specialty: z.literal("general_physician"),
  general_exam: z
    .object({
      pallor: z.boolean().default(false),
      icterus: z.boolean().default(false),
      cyanosis: z.boolean().default(false),
      clubbing: z.boolean().default(false),
      lymphadenopathy: z.boolean().default(false),
      edema: z.boolean().default(false),
    })
    .optional(),
  exam: examSchema.optional(),
  systemic: z
    .object({
      gen: z.string().max(500).nullable().optional(),
      ent: z.string().max(500).nullable().optional(),
      cvs: z.string().max(500).nullable().optional(),
      rs: z.string().max(500).nullable().optional(),
      pa: z.string().max(500).nullable().optional(),
      cns: z.string().max(500).nullable().optional(),
    })
    .optional(),
});

export const dentalSpecialtySchema = z.object({
  specialty: z.literal("dental"),
  odontogram: z.array(dentalToothSchema).default([]),
  general_notes: z.string().max(1000).nullable().optional(),
});

export const pediatricsSpecialtySchema = z.object({
  specialty: z.literal("pediatrics"),
  birth_history: z
    .object({
      gestational_age_weeks: z.number().min(20).max(45).nullable().optional(),
      birth_weight_kg: z.number().min(0.5).max(10).nullable().optional(),
      delivery_type: z.enum(["normal", "c_section", "assisted"]).nullable().optional(),
      complications: z.string().max(500).nullable().optional(),
    })
    .optional(),
  head_circumference_cm: z.number().min(25).max(65).nullable().optional(),
  immunizations_given: z.array(z.string()).default([]),
});

export type GPSpecialty = z.infer<typeof gpSpecialtySchema>;
export type DentalSpecialty = z.infer<typeof dentalSpecialtySchema>;
export type PediatricsSpecialty = z.infer<typeof pediatricsSpecialtySchema>;

export const specialtyDataSchema = z.discriminatedUnion("specialty", [
  gpSpecialtySchema,
  dentalSpecialtySchema,
  pediatricsSpecialtySchema,
]);

export type SpecialtyData = z.infer<typeof specialtyDataSchema>;

/**
 * Follow-up schedule recommendation schema.
 */
export const followUpSchema = z.object({
  interval: z.enum(["none", "3_days", "5_days", "1_week", "2_weeks", "1_month", "custom"]).optional(),
  follow_up_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD").nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});

export type FollowUpInput = z.infer<typeof followUpSchema>;

/**
 * Complete consultation draft save schema.
 */
export const saveConsultationDraftSchema = z.object({
  visit_id: z.string().uuid("Invalid visit ID"),
  vitals: vitalsSchema.nullable().optional(),
  chief_complaints: z.array(chiefComplaintItemSchema).default([]),
  clinical_notes: z.string().nullable().optional(),
  specialty: z.enum(["general_physician", "dental", "pediatrics"]).default("general_physician"),
  specialty_data: z
    .union([specialtyDataSchema, z.record(z.string(), z.unknown())])
    .nullable()
    .optional(),
  investigations_advised: z.array(z.string()).default([]),
  advice: z.array(z.string()).default([]),
  follow_up: followUpSchema.nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
});

export type ClinicalSpecialty = "general_physician" | "dental" | "pediatrics";

export type SaveConsultationDraftInput = z.infer<typeof saveConsultationDraftSchema>;

/**
 * V2-09b 09B-01 (R-3): the patch of `save_consultation_draft`. Each key is optional; only the keys present are written. The field rules are the
 * ones of `saveConsultationDraftSchema` above. `follow_up: null` removes the visit's follow-up; `provenance` is cleaned by the service;
 * `conflict_overwrite` is the audit flag the client sets after "Keep mine" (R-5).
 */
export const draftFollowUpSchema = z.object({
  interval: z.enum(["none", "3_days", "5_days", "1_week", "2_weeks", "1_month", "custom"]).optional(),
  follow_up_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  notes: z.string().max(500).nullable().optional(),
});

export const draftPatchSchema = z
  .object({
    vitals: vitalsSchema.nullable(),
    chief_complaints: z.array(chiefComplaintItemSchema),
    clinical_notes: z.string().nullable(),
    specialty_data: z.union([specialtyDataSchema, z.record(z.string(), z.unknown())]).nullable(),
    investigations_advised: z.array(z.string()),
    advice: z.array(z.string()),
    specialty: z.enum(["general_physician", "dental", "pediatrics"]),
    provenance: z.record(z.string(), z.unknown()).nullable(),
    follow_up: draftFollowUpSchema.nullable(),
    conflict_overwrite: z.boolean(),
  })
  .partial();

export const saveDraftCommandSchema = z.object({
  visit_id: z.string().uuid("Invalid visit ID"),
  expected_version: z.number().int().min(0),
  patch: draftPatchSchema,
  client_request_id: clientRequestIdSchema,
});

export type DraftPatch = z.infer<typeof draftPatchSchema>;
export type SaveDraftCommandInput = z.input<typeof saveDraftCommandSchema>;
