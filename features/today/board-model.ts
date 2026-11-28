/**
 * Today's board from `public.today_board` (V2-09e 09E-06, R-9, R-12): the one read answers the clinic's zone, the clinic versions it reflects, the clinic's
 * doctors and the day's visits with the fields a row shows; this module parses that answer (a part that is not the documented shape is dropped, never
 * guessed) and builds the `TodayBoard` the screen already took. The rules that depend on the clock and on the role (age text, the wait, the row actions,
 * the balance) stay in TypeScript where they were; the database decides only which rows and which parts the caller may read. Pure: no I/O, no React.
 */
import { z } from "zod";
import type { VisitStatus } from "@/lib/db/types";
import type { VitalsReading } from "@/lib/clinical/vitals";
import { clockOf, resolveTimeZone, todayInTz } from "@/lib/datetime";
import { formatAge } from "@/lib/ui/age";
import { formatDoctorDisplayName } from "@/features/staff/formatters";
import { rowActions } from "@/features/visits/state-machine";
import { hasPerm, ROLE_PERMISSIONS } from "@/lib/permissions";
import type { UserRole } from "@/lib/db/types";
import { LIVE_DOMAINS, type Versions } from "@/lib/live/domains";
import type { TodayBoard, TodayPriority, TodayRow } from "./schema";

const SEX_LETTER: Record<string, string> = { male: "M", female: "F", other: "O" };

const hhmm = (c: { hour: number; minute: number }) => `${String(c.hour).padStart(2, "0")}:${String(c.minute).padStart(2, "0")}`;

/** The stored vitals as a reading: v1 wrote `temperature` (°F), the V2 form writes `temperatureF`. */
export function toVitalsReading(raw: unknown): VitalsReading | null {
  if (!raw || typeof raw !== "object") return null;
  const v = raw as Record<string, unknown>;
  const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
  const reading: VitalsReading = {
    systolic: num(v.systolic),
    diastolic: num(v.diastolic),
    pulse: num(v.pulse),
    temperatureF: num(v.temperatureF) ?? num(v.temperature),
    spo2: num(v.spo2),
    respRate: num(v.respRate) ?? num(v.respiratory_rate),
    weight: num(v.weight),
    height: num(v.height),
    sugar: num(v.sugar),
    sugarType: ([v.sugarType, v.sugar_type].find((t) => t === "random" || t === "fasting" || t === "pp") as VitalsReading["sugarType"]) ?? null,
  };
  return Object.values(reading).some((x) => x !== null) ? reading : null;
}

const VISIT_STATUSES = ["booked", "confirmed", "waiting", "in_consultation", "completed", "cancelled", "no_show"] as const;

const numeric = z.union([z.number(), z.string()]).transform((v) => Number(v));

const visitSchema = z.object({
  id: z.string(),
  patient_id: z.string(),
  doctor_id: z.string(),
  origin_type: z.enum(["walk_in", "scheduled"]),
  status: z.enum(VISIT_STATUSES),
  scheduled_at: z.string().nullable(),
  is_overbooked: z.boolean(),
  signed_at: z.string().nullable(),
  row_version: z.number().int().nonnegative(),
  patient: z
    .object({
      full_name: z.string(),
      phone: z.string().nullable(),
      sex: z.string().nullable(),
      age: z.number().nullable(),
      date_of_birth: z.string().nullable(),
    })
    .nullable(),
  has_allergy: z.boolean().nullable(),
  token: z.object({ token_number: z.number(), priority: z.string(), created_at: z.string() }).nullable(),
  vitals: z.unknown().optional(),
  invoice: z.object({ total_amount: numeric, paid: numeric, row_version: z.number().int().nonnegative() }).nullable().optional(),
  follow_up: z.object({ date: z.string(), booked: z.boolean() }).nullable().optional(),
});

const answerSchema = z.object({
  time_zone: z.string().nullable(),
  versions: z.record(z.string(), z.number()).nullable(),
  doctors: z.array(z.object({ id: z.string(), full_name: z.string().nullable() })),
  visits: z.array(z.unknown()),
});

/** The clinic versions of the answer: all four domains or null (a basis is never guessed). */
function versionsOf(raw: Record<string, number> | null): Versions | null {
  if (!raw) return null;
  const out = {} as Versions;
  for (const domain of LIVE_DOMAINS) {
    const v = raw[domain];
    if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0) return null;
    out[domain] = v;
  }
  return out;
}

export interface BuiltBoard {
  board: TodayBoard;
  /** The clinic versions in the same snapshot as the rows (an exact basis for the live core); null when the read could not give all four. */
  versions: Versions | null;
}

/** `null` for a NULL answer (no permission, another clinic) or one that is not the documented shape. */
export function buildTodayBoard(raw: unknown, role: UserRole, options: { now?: Date; today?: string } = {}): BuiltBoard | null {
  const parsed = answerSchema.safeParse(raw);
  if (!parsed.success) return null;
  const answer = parsed.data;
  const now = options.now ?? new Date();
  const timeZone = resolveTimeZone(answer.time_zone);
  const todayYmd = todayInTz(timeZone, now);
  const permissions = ROLE_PERMISSIONS[role];
  const sees = {
    allergies: hasPerm(role, "vitals:view") || hasPerm(role, "consultations:view"),
    vitals: hasPerm(role, "consultations:view"),
    billing: hasPerm(role, "billing:view"),
  };

  // The directory's numbering of a doctor with no name is the position in the list.
  const doctors: Record<string, string> = {};
  answer.doctors.forEach((d, index) => {
    doctors[d.id] = formatDoctorDisplayName(d.full_name, index + 1);
  });

  const rows: TodayRow[] = [];
  for (const item of answer.visits) {
    const parsedVisit = visitSchema.safeParse(item);
    if (!parsedVisit.success) continue;
    const v = parsedVisit.data;
    const status = v.status as VisitStatus;
    const patient = v.patient;
    const token = v.token;
    const vitals = sees.vitals ? toVitalsReading(v.vitals) : null;
    const age = patient?.date_of_birth
      ? formatAge(patient.date_of_birth, todayYmd)
      : typeof patient?.age === "number"
        ? `${patient.age} y`
        : null;
    const clock = v.scheduled_at ? clockOf(v.scheduled_at, timeZone) : null;
    const priority =
      token && (token.priority === "urgent" || token.priority === "vip" || token.priority === "normal") ? (token.priority as TodayPriority) : null;
    const invoice = v.invoice ?? null;
    const completed = status === "completed";
    rows.push({
      visitId: v.id,
      patientId: v.patient_id,
      name: patient?.full_name ?? "Patient",
      age,
      sex: (patient?.sex && SEX_LETTER[patient.sex]) || null,
      phone: patient?.phone ?? null,
      status,
      signed: v.signed_at != null,
      token: token?.token_number ?? null,
      priority,
      time: clock ? hhmm(clock) : null,
      origin: v.origin_type,
      overbooked: v.is_overbooked,
      doctorId: v.doctor_id,
      doctorName: doctors[v.doctor_id] ?? "Doctor",
      arrivedAt: token ? hhmm(clockOf(token.created_at, timeZone)) : null,
      waitMinutes: status === "waiting" && token ? Math.max(0, Math.floor((now.getTime() - new Date(token.created_at).getTime()) / 60_000)) : null,
      hasAllergy: sees.allergies ? (v.has_allergy ?? false) : null,
      vitals,
      vitalsPending: sees.vitals && vitals === null,
      balanceDue: sees.billing && completed ? (invoice ? Math.max(0, (Number(invoice.total_amount) || 0) - (Number(invoice.paid) || 0)) : 0) : null,
      billed: sees.billing && completed ? invoice !== null : null,
      actions: rowActions(permissions, { status, scheduledAt: v.scheduled_at, signed: v.signed_at != null }, now, timeZone),
      followUp: hasPerm(role, "appointments:edit") ? (v.follow_up ?? null) : null,
      rowVersion: v.row_version,
      invoiceVersion: sees.billing && completed ? (invoice?.row_version ?? null) : null,
    });
  }

  return {
    board: { rows, generatedAt: now.toISOString(), today: options.today ?? todayYmd, timeZone },
    versions: versionsOf(answer.versions),
  };
}
