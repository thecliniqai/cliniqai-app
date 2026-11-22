import { z } from "zod";
import { INDIAN_MOBILE_REGEX, toE164, extractTenDigits } from "@/lib/utils/phone";
import { DEFAULT_CLINIC_TZ, ageInYears, todayInTz } from "@/lib/datetime";

/**
 * Normalizes Indian and standard mobile numbers.
 */
export function normalizePhone(phone: string): string {
  return toE164(phone);
}

/**
 * Calculates age in whole years from a date of birth (YYYY-MM-DD) on the clinic date `todayYmd` (V2-03 03-05).
 * Without `todayYmd` it uses today in the default clinic zone, never the server's UTC date.
 */
export function calculateAgeFromDob(dobStr: string, todayYmd: string = todayInTz(DEFAULT_CLINIC_TZ)): number | null {
  if (!dobStr) return null;
  return ageInYears(dobStr, todayYmd);
}

/**
 * Derives a synthetic Jan 01 birth date from an age in years, counted from the clinic date `todayYmd`.
 */
export function calculateDobFromAge(age: number, todayYmd: string = todayInTz(DEFAULT_CLINIC_TZ)): string {
  const currentYear = Number(todayYmd.slice(0, 4));
  const birthYear = currentYear - age;
  return `${birthYear}-01-01`;
}

export const patientSchema = z
  .object({
    full_name: z
      .string()
      .trim()
      .min(1, "Patient full name is required.")
      .max(120, "Name must be under 120 characters."),
    phone: z
      .string()
      .trim()
      .transform((val) => extractTenDigits(val))
      .refine((val) => INDIAN_MOBILE_REGEX.test(val), {
        message: "Please enter a valid 10-digit Indian mobile number starting with 6, 7, 8, or 9.",
      })
      .transform((val) => toE164(val)),
    date_of_birth: z
      .string()
      .optional()
      .nullable()
      .transform((val) => (val && val.trim() !== "" ? val : null)),
    age: z
      .number()
      .int("Age must be a whole number.")
      .min(0, "Age cannot be negative.")
      .max(130, "Age must be under 130.")
      .optional()
      .nullable(),
    sex: z.enum(["male", "female", "other"]).optional().nullable(),
    address: z
      .object({
        line1: z.string().optional(),
        city: z.string().optional(),
        state: z.string().optional(),
        pincode: z.string().optional(),
      })
      .optional()
      .nullable(),
    allergies: z.array(z.string()).optional(),
    // 09C-06a (A-8, S-2): the allergy list the edit form started from (null = not recorded). The edit's allergy change goes through
    // record_patient_allergies, which refuses it when the stored list differs. Never part of a registration payload.
    allergies_expected: z.array(z.string()).nullable().optional(),
    chronic_conditions: z.array(z.string()).optional(),
    // The three keys the app writes (edit-patient-modal) and reads (patient detail, DPDP export); the front-desk commands'
    // `private.patient_input_normalize` refuses any other key (V2-07 07-04a G-6).
    emergency_contact: z
      .object({
        name: z.string().max(200).optional(),
        phone: z.string().max(200).optional(),
        relation: z.string().max(200).optional(),
      })
      .strict()
      .optional()
      .nullable(),
    abha_id: z
      .string()
      .optional()
      .nullable()
      .transform((val) => {
        if (val === undefined || val === null) return null;
        const trimmed = val.trim();
        return trimmed === "" ? null : trimmed;
      }),
    // The patient's objection to AI-assisted processing, captured at registration (V2-08 08-02, R-12, AI-03). Only the
    // registration commands write it; clearing it later is an owner or doctor action (migration 000094).
    ai_processing_objected: z.boolean().optional(),
  })
  .transform((data) => {
    let age = data.age ?? null;
    let dob = data.date_of_birth ?? null;

    if (dob && age === null) {
      age = calculateAgeFromDob(dob);
    } else if (age !== null && !dob) {
      dob = calculateDobFromAge(age);
    }

    return {
      ...data,
      age,
      date_of_birth: dob,
    };
  });

export type PatientInput = z.infer<typeof patientSchema>;

/** What a form sends for a new patient (before the schema's phone normalisation and age / date-of-birth derivation). */
export type NewPatientInput = z.input<typeof patientSchema>;

/**
 * The `p_new_patient` object of the front-desk commands (V2-07 07-03: `enqueue_walk_in`, `register_and_book`) from a
 * parsed {@link patientSchema} result: exactly the keys `private.patient_input_normalize` accepts, in the snake_case the
 * database reads. The database validates the same rules again; it never trusts this mapping.
 */
export function newPatientPayload(data: PatientInput): Record<string, unknown> {
  return {
    full_name: data.full_name,
    phone: data.phone,
    date_of_birth: data.date_of_birth,
    age: data.age,
    sex: data.sex ?? null,
    address: data.address ?? null,
    // V2-09c 09C-02 (R-8): nothing entered is "not recorded" (null), never "no known allergies" ([] is only an explicit choice of the allergy editor).
    allergies: data.allergies ?? null,
    chronic_conditions: data.chronic_conditions ?? [],
    emergency_contact: data.emergency_contact ?? null,
    abha_id: data.abha_id,
    ai_processing_objected: data.ai_processing_objected ?? false,
  };
}

export interface PatientVisitVitals {
  bp_sys?: number | null;
  bp_dia?: number | null;
  pulse?: number | null;
  temp?: number | null;
  spo2?: number | null;
  weight?: number | null;
  height?: number | null;
  bmi?: number | null;
  respiratory_rate?: number | null;
  notes?: string | null;
}

export interface PatientVisitChiefComplaint {
  complaint: string;
  duration?: string;
  duration_unit?: string;
  notes?: string | null;
}

export interface PatientVisitDiagnosis {
  id: string;
  diagnosis_name: string;
  icd11_code?: string | null;
  snomed_concept_id?: string | null;
  is_chronic: boolean;
  notes?: string | null;
}

export interface PatientVisitPrescriptionItem {
  id: string;
  medicine_name: string;
  generic_name?: string | null;
  dose_form?: string | null;
  dosage: string;
  timing?: string | null;
  duration: string;
  special_instructions?: string | null;
}

export interface PatientVisitPrescription {
  id: string;
  version: number;
  status: string;
  signed_at?: string | null;
  items: PatientVisitPrescriptionItem[];
}

export interface PatientVisitInvoice {
  id: string;
  invoice_number: string;
  total_amount: number;
  status: string;
  total_paid: number;
  balance_due: number;
}

export interface PatientVisitDoctor {
  id: string;
  full_name: string;
  qualifications?: string | null;
  medical_council_reg_no?: string | null;
  specialty?: string | null;
}

export interface PatientVisitHistoryItem {
  id: string;
  patient_id: string;
  scheduled_at: string | null;
  created_at: string;
  status: string;
  origin_type: string;
  specialty?: string | null;
  reason_for_visit?: string | null;
  clinical_notes?: string | null;
  investigations_advised?: string[];
  advice?: string[];
  vitals?: PatientVisitVitals | null;
  chief_complaints?: PatientVisitChiefComplaint[] | null;
  doctor: PatientVisitDoctor;
  token_number?: number | null;
  diagnoses: PatientVisitDiagnosis[];
  prescription?: PatientVisitPrescription | null;
  invoice?: PatientVisitInvoice | null;
  referral?: {
    id: string;
    status: string;
    referred_to_name: string;
  } | null;
}

