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
