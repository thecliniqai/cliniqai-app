import { z } from "zod";

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
 * Computes ISO boundary strings for date presets or custom range.
 */
export function computeDateRange(
  preset: DatePreset,
  customStart?: string | null,
  customEnd?: string | null,
  referenceDate: Date = new Date()
): { startIso: string; endIso: string } {
  const ref = new Date(referenceDate);

  if (preset === "today") {
    const start = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate(), 0, 0, 0, 0));
    const end = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate(), 23, 59, 59, 999));
    return { startIso: start.toISOString(), endIso: end.toISOString() };
  }

  if (preset === "yesterday") {
    const yest = new Date(ref.getTime() - 24 * 60 * 60 * 1000);
    const start = new Date(Date.UTC(yest.getUTCFullYear(), yest.getUTCMonth(), yest.getUTCDate(), 0, 0, 0, 0));
    const end = new Date(Date.UTC(yest.getUTCFullYear(), yest.getUTCMonth(), yest.getUTCDate(), 23, 59, 59, 999));
    return { startIso: start.toISOString(), endIso: end.toISOString() };
  }

  if (preset === "last_7_days") {
    const past = new Date(ref.getTime() - 6 * 24 * 60 * 60 * 1000);
    const start = new Date(Date.UTC(past.getUTCFullYear(), past.getUTCMonth(), past.getUTCDate(), 0, 0, 0, 0));
    const end = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate(), 23, 59, 59, 999));
    return { startIso: start.toISOString(), endIso: end.toISOString() };
  }

  if (preset === "this_month") {
    const start = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), 1, 0, 0, 0, 0));
    const end = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() + 1, 0, 23, 59, 59, 999));
    return { startIso: start.toISOString(), endIso: end.toISOString() };
  }

  // Custom preset
  const start = customStart
    ? new Date(`${customStart}T00:00:00.000Z`)
    : new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate(), 0, 0, 0, 0));

  const end = customEnd
    ? new Date(`${customEnd}T23:59:59.999Z`)
    : new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate(), 23, 59, 59, 999));

  return { startIso: start.toISOString(), endIso: end.toISOString() };
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
