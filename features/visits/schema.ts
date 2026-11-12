import { z } from "zod";
import { addDaysYmd, dayWindowUtc, isYmd, rangeWindowUtc, startOfMonthYmd, todayInTz } from "@/lib/datetime";

export const datePresetEnum = z.enum([
  "today",
  "yesterday",
  "last_7_days",
  "this_month",
  "custom",
]);

export type DatePreset = z.infer<typeof datePresetEnum>;

export const visitsFilterSchema = z.object({
  datePreset: datePresetEnum.default("today"),
  startDate: z.string().optional().nullable(),
  endDate: z.string().optional().nullable(),
  doctorId: z.string().default("all"),
  status: z.string().default("all"),
  specialty: z.string().default("all"),
  searchQuery: z.string().default(""),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(5).max(100).default(25),
});

export type VisitsFilterInput = z.infer<typeof visitsFilterSchema>;

/**
 * Computes the half-open UTC window `[startIso, endIsoExclusive)` of a date preset or custom range, in clinic days of
 * zone `timeZone` (V2-03 03-05). An invalid custom date falls back to today.
 */
export function computeDateRange(
  preset: DatePreset,
  customStart: string | null | undefined,
  customEnd: string | null | undefined,
  timeZone: string,
  referenceDate: Date = new Date()
): { startIso: string; endIsoExclusive: string } {
  const today = todayInTz(timeZone, referenceDate);

  if (preset === "today") {
    return dayWindowUtc(today, timeZone);
  }

  if (preset === "yesterday") {
    return dayWindowUtc(addDaysYmd(today, -1), timeZone);
  }

  if (preset === "last_7_days") {
    return rangeWindowUtc(addDaysYmd(today, -6), today, timeZone);
  }

  if (preset === "this_month") {
    const first = startOfMonthYmd(today);
    const lastOfMonth = addDaysYmd(startOfMonthYmd(addDaysYmd(first, 31)), -1);
    return rangeWindowUtc(first, lastOfMonth, timeZone);
  }

  // Custom preset
  const start = isYmd(customStart) ? customStart : today;
  const end = isYmd(customEnd) ? customEnd : today;
  return rangeWindowUtc(start, end, timeZone);
}

export interface ClinicVisitRegisterItem {
  id: string; // visit_id
  patient: {
    id: string;
    full_name: string;
    phone: string;
    age: number | null;
    sex: string | null;
    abha_id?: string | null;
  };
  doctor: {
    id: string;
    full_name: string;
    qualifications?: string | null;
    specialty?: string | null;
  };
  scheduled_at: string | null;
  created_at: string;
  status: string;
  origin_type: string;
  specialty?: string | null;
  token_number?: number | null;
  reason_for_visit?: string | null;
  clinical_notes?: string | null;
  chief_complaints?: {
    complaint: string;
    duration?: string;
    duration_unit?: string;
  }[];
  diagnoses: {
    id: string;
    diagnosis_name: string;
    icd11_code?: string | null;
    snomed_concept_id?: string | null;
    is_chronic: boolean;
  }[];
  prescription?: {
    id: string;
    version: number;
    status: string;
    signed_at?: string | null;
    item_count: number;
    items?: {
      id: string;
      medicine_name: string;
      dose_form?: string | null;
      dosage: string;
      timing?: string | null;
      duration: string;
    }[];
  } | null;
  invoice?: {
    id: string;
    invoice_number: string;
    total_amount: number;
    status: string;
    total_paid: number;
    balance_due: number;
  } | null;
  vitals?: Record<string, unknown> | null;
  advice?: string[] | null;
}

export interface ClinicVisitsSummaryMetrics {
  totalVisits: number;
  completedVisits: number;
  inProgressVisits: number;
  waitingVisits: number;
  totalBilledRevenue: number;
}

export interface ClinicVisitsRegisterResult {
  visits: ClinicVisitRegisterItem[];
  metrics: ClinicVisitsSummaryMetrics;
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ActiveDoctorOption {
  id: string;
  user_id: string;
  full_name: string;
  qualifications?: string | null;
  specialty?: string | null;
}

export const bookAppointmentSchema = z.object({
  patient_id: z.string().uuid("Invalid patient ID"),
  doctor_id: z.string().uuid("Invalid doctor ID"),
  scheduled_at: z.string().datetime({ offset: true }),
  estimated_duration_minutes: z.number().int().min(5).max(180).default(15),
  reason_for_visit: z.string().max(500).nullable().optional(),
  is_overbooked: z.boolean().default(false),
  override_off_duty: z.boolean().optional().default(false),
  override_block: z.boolean().optional().default(false),
});

export type BookAppointmentInput = z.input<typeof bookAppointmentSchema>;

export const createScheduleBlockSchema = z.object({
  doctor_id: z.string().uuid("Invalid doctor ID").nullable().optional(),
  start_time: z.string().datetime({ offset: true }),
  end_time: z.string().datetime({ offset: true }),
  reason: z.string().max(500).nullable().optional(),
  all_day: z.boolean().default(false),
});

export type CreateScheduleBlockInput = z.input<typeof createScheduleBlockSchema>;

