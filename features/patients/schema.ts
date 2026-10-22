import { z } from "zod";

/**
 * Normalizes Indian and standard mobile numbers.
 */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) {
    return `+91${digits}`;
  }
  if (digits.length === 12 && digits.startsWith("91")) {
    return `+${digits}`;
  }
  return phone.trim();
}

/**
 * Calculates age in whole years from an ISO date string (YYYY-MM-DD).
 */
export function calculateAgeFromDob(dobStr: string): number | null {
  if (!dobStr) return null;
  const birthDate = new Date(dobStr);
  if (isNaN(birthDate.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age >= 0 ? age : 0;
}

/**
 * Derives a synthetic Jan 01 birth date from an age in years.
 */
export function calculateDobFromAge(age: number): string {
  const currentYear = new Date().getFullYear();
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
      .min(8, "Phone number must be at least 8 digits.")
      .max(15, "Phone number is too long.")
      .transform(normalizePhone),
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
    chronic_conditions: z.array(z.string()).optional(),
    emergency_contact: z.record(z.unknown()).optional().nullable(),
    abha_id: z
      .string()
      .optional()
      .nullable()
      .transform((val) => {
        if (val === undefined || val === null) return null;
        const trimmed = val.trim();
        return trimmed === "" ? null : trimmed;
      }),
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

