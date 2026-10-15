import { z } from "zod";

export const clinicSettingsSchema = z.object({
  name: z.string().min(2, "Clinic name must be at least 2 characters."),
  address: z.string().optional().nullable(),
  specialties: z.array(z.string()).default([]),
  timezone: z.string().default("Asia/Kolkata"),
  owner_is_practicing_doctor: z.boolean().default(true),
  default_consultation_fee: z.coerce.number().min(0, "Fee cannot be negative").default(500),
  default_followup_fee: z.coerce.number().min(0, "Fee cannot be negative").default(300),
  accepted_payment_methods: z.array(z.enum(["cash", "upi", "card"])).min(1, "Select at least one payment method").default(["cash", "upi", "card"]),
  
  // Owner doctor clinical profile (configured when owner is practicing doctor)
  doctor_name: z.string().optional().nullable(),
  doctor_phone: z.string().optional().nullable(),
  medical_council_reg_no: z.string().optional().nullable(),
  qualifications: z.string().optional().nullable(),
  default_specialty: z.string().default("general_physician"),
});

export type ClinicSettingsInput = z.infer<typeof clinicSettingsSchema>;

export const userProfileSchema = z.object({
  full_name: z.string().min(2, "Full name must be at least 2 characters."),
  phone: z.string().optional().nullable(),
  medical_council_reg_no: z.string().optional().nullable(),
  qualifications: z.string().optional().nullable(),
  default_specialty: z.string().default("general_physician"),
});

export type UserProfileInput = z.infer<typeof userProfileSchema>;

export const staffEditSchema = z.object({
  membership_id: z.string().uuid("Invalid membership ID"),
  full_name: z.string().min(2, "Full name must be at least 2 characters."),
  phone: z.string().optional().nullable(),
  role: z.enum(["owner", "admin", "doctor", "receptionist", "nurse"]),
  medical_council_reg_no: z.string().optional().nullable(),
  qualifications: z.string().optional().nullable(),
  default_specialty: z.string().default("general_physician"),
});

export type StaffEditInput = z.infer<typeof staffEditSchema>;
