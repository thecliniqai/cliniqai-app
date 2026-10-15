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
});

export type ClinicSettingsInput = z.infer<typeof clinicSettingsSchema>;
