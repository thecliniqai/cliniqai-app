import { z } from "zod";

/**
 * Normalizes Indian and standard mobile numbers.
 */
function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) {
    return `+91${digits}`;
  }
  if (digits.length === 12 && digits.startsWith("91")) {
    return `+${digits}`;
  }
  return phone.trim();
}

export const patientSchema = z.object({
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
  abha_id: z
    .string()
    .optional()
    .nullable()
    .transform((val) => {
      if (val === undefined || val === null) return null;
      const trimmed = val.trim();
      return trimmed === "" ? null : trimmed;
    }),
});

export type PatientInput = z.infer<typeof patientSchema>;
