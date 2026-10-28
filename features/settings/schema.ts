import { z } from "zod";
import { INDIAN_MOBILE_REGEX, toE164, extractTenDigits } from "@/lib/utils/phone";

export const optionalIndianPhone = z
  .string()
  .optional()
  .nullable()
  .transform((val) => {
    if (val === undefined) return undefined;
    if (val === null || val.trim() === "") return null;
    return extractTenDigits(val);
  })
  .refine(
    (val) => val === undefined || val === null || INDIAN_MOBILE_REGEX.test(val),
    {
      message: "Please enter a valid 10-digit Indian mobile number starting with 6, 7, 8, or 9.",
    }
  )
  .transform((val) => {
    if (val === undefined) return undefined;
    if (val === null) return null;
    return toE164(val);
  });

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
  doctor_phone: optionalIndianPhone,
  medical_council_reg_no: z.string().optional().nullable(),
  qualifications: z.string().optional().nullable(),
  default_specialty: z.string().default("general_physician"),
});

export type ClinicSettingsInput = z.infer<typeof clinicSettingsSchema>;

export const userProfileSchema = z.object({
  full_name: z.string().min(2, "Full name must be at least 2 characters."),
  phone: optionalIndianPhone,
  medical_council_reg_no: z.string().optional().nullable(),
  qualifications: z.string().optional().nullable(),
  default_specialty: z.string().default("general_physician"),
  default_slot_duration_minutes: z.coerce.number().min(5).max(180).optional(),
  availability_schedule: z.any().optional().nullable(),
});

export type UserProfileInput = z.infer<typeof userProfileSchema>;

export const staffEditSchema = z.object({
  membership_id: z.string().uuid("Invalid membership ID"),
  full_name: z.string().min(2, "Full name must be at least 2 characters."),
  phone: optionalIndianPhone,
  role: z.enum(["owner", "admin", "doctor", "receptionist", "nurse"]),
  medical_council_reg_no: z.string().optional().nullable(),
  qualifications: z.string().optional().nullable(),
  default_specialty: z.string().default("general_physician"),
  default_slot_duration_minutes: z.coerce.number().min(5).max(180).optional(),
  availability_schedule: z.any().optional().nullable(),
});

export type StaffEditInput = z.infer<typeof staffEditSchema>;

// Doctor shift and weekly schedule schemas
export const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;

export const shiftSchema = z
  .object({
    start: z.string().regex(timeRegex, "Invalid start time format (HH:mm)"),
    end: z.string().regex(timeRegex, "Invalid end time format (HH:mm)"),
  })
  .refine((shift) => shift.start < shift.end, {
    message: "Shift end time must be after start time",
  });

export type ShiftInput = z.infer<typeof shiftSchema>;

export const dayAvailabilitySchema = z
  .object({
    enabled: z.boolean(),
    shifts: z.array(shiftSchema),
  })
  .refine(
    (day) => {
      if (!day.enabled || day.shifts.length <= 1) return true;
      const sorted = [...day.shifts].sort((a, b) => a.start.localeCompare(b.start));
      for (let i = 0; i < sorted.length - 1; i++) {
        if (sorted[i].end > sorted[i + 1].start) {
          return false;
        }
      }
      return true;
    },
    { message: "Shifts within the same day cannot overlap" }
  );

export type DayAvailabilityInput = z.infer<typeof dayAvailabilitySchema>;

export const doctorWeeklyScheduleSchema = z.object({
  monday: dayAvailabilitySchema,
  tuesday: dayAvailabilitySchema,
  wednesday: dayAvailabilitySchema,
  thursday: dayAvailabilitySchema,
  friday: dayAvailabilitySchema,
  saturday: dayAvailabilitySchema,
  sunday: dayAvailabilitySchema,
});

export type DoctorWeeklyScheduleInput = z.infer<typeof doctorWeeklyScheduleSchema>;
