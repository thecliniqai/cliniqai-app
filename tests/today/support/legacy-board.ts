/**
 * The ORACLE of the 09E-06 parity spec: the board read as it was before `today_board` (V2-09e 09E-06): seven or more reads on the caller's own client,
 * the model built in TypeScript. Test-only; the product reads `public.today_board`. Kept verbatim (renamed `legacyTodayBoard`) so the parity is checked
 * against the old behaviour for every role, not against a description of it.
 */
import { assertPerm, hasPerm, ROLE_PERMISSIONS } from "@/lib/permissions";
import type { ServiceContext } from "@/lib/auth/context";
import type { VisitStatus } from "@/lib/db/types";
import { clinicalNotesEmbed, embeddedClinicalNotes, CLINICAL_NOTES_EMBED_KEY } from "@/lib/db/clinical-notes";
import { addDaysYmd, clockOf, dayWindowUtc, todayInTz, ymdOf } from "@/lib/datetime";
import { getTenantTimeZone } from "@/lib/datetime/server";
import { formatAge } from "@/lib/ui/age";
import type { VitalsReading } from "@/lib/clinical/vitals";
import { errorTag, log } from "@/lib/log";
import { getRequestId } from "@/lib/log/request-id";
import { getTenantDoctorMap } from "@/features/staff/service";
import { rowActions } from "@/features/visits/state-machine";
import type { TodayBoard as NewBoard, TodayPriority, TodayRow as NewRow } from "@/features/today/schema";

/** The old model had no row versions (000123 added them to the board with 09E-06): the parity compares everything else. */
export type TodayRow = Omit<NewRow, "rowVersion" | "invoiceVersion">;
export type TodayBoard = Omit<NewBoard, "rows"> & { rows: TodayRow[] };

/**
 * Today's read model (V2-08 08-03a, R-10, M4.2): one clinic day of visits for the front desk, with explicit column lists
 * (no `select *`) and the role's own view of each row. Tenant and role come from `ctx` (ADR-0005 D1); every read is on the
 * user's JWT client, so RLS decides what a row may hold:
 * - allergy flag: only for a role with `vitals:view` or `consultations:view`;
 * - vitals (and "Vitals pending"): only for a role that reads `clinical_notes` (`consultations:view`);
 * - balance due: only for a role with `billing:view`; a completed visit with money due is "To bill".
 * The clinic day is the clinic's own: a booking belongs to the day of its appointment time, a walk-in (no appointment time)
 * to the day it was created, both in the clinic's zone (a visit created at 00:10 IST belongs to that IST date).
 * Cancelled and no-show visits stay in the list (Done lane, own chip) so the day reconciles.
 */
export interface LegacyBoardOptions {
  /** Only this doctor's visits (a doctor's own queue). */
  doctorId?: string;
  /** The screen mode (`front`, `triage`, `doctor`); 08-03a lists the same day for every mode. */
  mode?: "front" | "triage" | "doctor";
  /** The clinic's zone when the caller has just read it (the page reads it together with the live versions, 09E-04): skips the board's own zone read. */
  timeZone?: string;
  /** The clinic date to read (`YYYY-MM-DD`); defaults to the clinic's today. Tests only. */
  date?: string;
  now?: Date;
}

interface PatientEmbed {
  full_name: string;
  phone: string | null;
  sex: string | null;
  age: number | null;
  date_of_birth: string | null;
  allergies?: string[] | null;
}

interface TokenEmbed {
  token_number: number;
  priority: string;
  created_at: string;
}

interface VisitRowResult {
  id: string;
  patient_id: string;
  doctor_id: string;
  origin_type: "walk_in" | "scheduled";
  status: VisitStatus;
  scheduled_at: string | null;
  is_overbooked: boolean;
  created_at: string;
  signed_at: string | null;
  patients: PatientEmbed | PatientEmbed[] | null;
  queue_tokens: TokenEmbed | TokenEmbed[] | null;
  [CLINICAL_NOTES_EMBED_KEY]?: unknown;
}

const SEX_LETTER: Record<string, string> = { male: "M", female: "F", other: "O" };

const hhmm = (c: { hour: number; minute: number }) => `${String(c.hour).padStart(2, "0")}:${String(c.minute).padStart(2, "0")}`;

const one = <T>(value: T | T[] | null | undefined): T | null => (Array.isArray(value) ? (value[0] ?? null) : (value ?? null));

/** The stored vitals as a reading: v1 wrote `temperature` (°F), the V2 form writes `temperatureF`. */
function toVitalsReading(raw: unknown): VitalsReading | null {
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
    sugarType: [v.sugarType, v.sugar_type].find((t) => t === "random" || t === "fasting" || t === "pp") as VitalsReading["sugarType"] ?? null,
  };
  return Object.values(reading).some((x) => x !== null) ? reading : null;
}

export async function legacyTodayBoard(
  ctx: ServiceContext,
  options: LegacyBoardOptions = {}
): Promise<{ ok: true; board: TodayBoard } | { ok: false }> {
  assertPerm(ctx.role, "appointments:view");
  const now = options.now ?? new Date();
  const timeZone = options.timeZone ?? (await getTenantTimeZone(ctx.db, ctx.tenantId));
  const today = options.date ?? todayInTz(timeZone, now);
  const { startIso, endIsoExclusive } = dayWindowUtc(today, timeZone);

  const sees = {
    allergies: hasPerm(ctx.role, "vitals:view") || hasPerm(ctx.role, "consultations:view"),
    vitals: hasPerm(ctx.role, "consultations:view"),
    billing: hasPerm(ctx.role, "billing:view"),
  };

  const patientColumns = ["full_name", "phone", "sex", "age", "date_of_birth", ...(sees.allergies ? ["allergies"] : [])].join(", ");
  const columns = [
    "id, patient_id, doctor_id, origin_type, status, scheduled_at, is_overbooked, created_at, signed_at",
    `patients(${patientColumns})`,
    "queue_tokens(token_number, priority, created_at)",
    ...(sees.vitals ? [clinicalNotesEmbed(["vitals"])] : []),
  ].join(", ");

  const window =
    `and(scheduled_at.gte.${startIso},scheduled_at.lt.${endIsoExclusive}),` +
    `and(scheduled_at.is.null,created_at.gte.${startIso},created_at.lt.${endIsoExclusive})`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (ctx.db.from("visits") as any).select(columns).eq("tenant_id", ctx.tenantId).or(window);
  if (options.doctorId) query = query.eq("doctor_id", options.doctorId);
  const { data, error } = (await query) as { data: VisitRowResult[] | null; error: { message: string } | null };
  if (error || !data) {
    log.error({ event: "today.board.failed", code: errorTag(error), requestId: await getRequestId(), tenantId: ctx.tenantId });
    return { ok: false };
  }

  // Money due, for completed visits only (a visit that is not completed cannot be "To bill").
  const balances = new Map<string, number>();
  const invoiced = new Set<string>();
  const completedIds = data.filter((v) => v.status === "completed").map((v) => v.id);
  if (sees.billing && completedIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: invoices } = await (ctx.db.from("invoices") as any)
      .select("id, visit_id, total_amount")
      .eq("tenant_id", ctx.tenantId)
      .in("visit_id", completedIds)
      .neq("status", "cancelled");
    const list = (invoices ?? []) as { id: string; visit_id: string; total_amount: number | string }[];
    const paid = new Map<string, number>();
    if (list.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: payments } = await (ctx.db.from("payments") as any)
        .select("invoice_id, amount")
        .eq("tenant_id", ctx.tenantId)
        .in("invoice_id", list.map((i) => i.id));
      for (const p of (payments ?? []) as { invoice_id: string; amount: number | string }[]) {
        paid.set(p.invoice_id, (paid.get(p.invoice_id) ?? 0) + Number(p.amount));
      }
    }
    for (const inv of list) {
      invoiced.add(inv.visit_id);
      balances.set(inv.visit_id, Math.max(0, (Number(inv.total_amount) || 0) - (paid.get(inv.id) ?? 0)));
    }
  }

  const followUps = hasPerm(ctx.role, "appointments:edit") ? await readFollowUps(ctx, data, startIso, timeZone) : new Map<string, { date: string; booked: boolean }>();

  const doctors = await getTenantDoctorMap(ctx);
  const permissions = ROLE_PERMISSIONS[ctx.role];
  const todayYmd = todayInTz(timeZone, now);

  const rows: TodayRow[] = data.map((v) => {
    const patient = one(v.patients);
    const token = one(v.queue_tokens);
    const vitals = sees.vitals ? toVitalsReading(embeddedClinicalNotes(v)?.vitals) : null;
    const age = patient?.date_of_birth
      ? formatAge(patient.date_of_birth, todayYmd)
      : typeof patient?.age === "number"
        ? `${patient.age} y`
        : null;
    const clock = v.scheduled_at ? clockOf(v.scheduled_at, timeZone) : null;
    const priority = token && (token.priority === "urgent" || token.priority === "vip" || token.priority === "normal")
      ? (token.priority as TodayPriority)
      : null;
    return {
      visitId: v.id,
      patientId: v.patient_id,
      name: patient?.full_name ?? "Patient",
      age,
      sex: (patient?.sex && SEX_LETTER[patient.sex]) || null,
      phone: patient?.phone ?? null,
      status: v.status,
      signed: v.signed_at != null,
      token: token?.token_number ?? null,
      priority,
      time: clock ? hhmm(clock) : null,
      origin: v.origin_type,
      overbooked: v.is_overbooked,
      doctorId: v.doctor_id,
      doctorName: doctors[v.doctor_id] ?? "Doctor",
      arrivedAt: token ? hhmm(clockOf(token.created_at, timeZone)) : null,
      waitMinutes:
        v.status === "waiting" && token ? Math.max(0, Math.floor((now.getTime() - new Date(token.created_at).getTime()) / 60_000)) : null,
      hasAllergy: sees.allergies ? (patient?.allergies?.length ?? 0) > 0 : null,
      vitals,
      vitalsPending: sees.vitals && vitals === null,
      balanceDue: sees.billing && v.status === "completed" ? (balances.get(v.id) ?? 0) : null,
      billed: sees.billing && v.status === "completed" ? invoiced.has(v.id) : null,
      actions: rowActions(permissions, { status: v.status, scheduledAt: v.scheduled_at, signed: v.signed_at != null }, now, timeZone),
      followUp: followUps.get(v.id) ?? null,
    };
  });

  return { ok: true, board: { rows, generatedAt: now.toISOString(), today, timeZone } };
}

/**
 * The follow-ups of the day's completed visits and whether each is already booked (V2-09b 09B-04b, R-15, Q-14). Two reads on the user's own client under
 * RLS (appointments:view): the follow-up rows of the completed visits, then the future booked or confirmed visits of those patients. A follow-up counts as
 * booked when the patient has such a visit with the same doctor on or after three days before the follow-up date. A failed read is "no follow-up".
 */
async function readFollowUps(
  ctx: ServiceContext,
  visits: VisitRowResult[],
  windowStartIso: string,
  timeZone: string,
): Promise<Map<string, { date: string; booked: boolean }>> {
  const out = new Map<string, { date: string; booked: boolean }>();
  const completed = visits.filter((v) => v.status === "completed");
  if (completed.length === 0) return out;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rows, error } = await (ctx.db.from("follow_ups") as any)
    .select("visit_id, follow_up_date")
    .eq("tenant_id", ctx.tenantId)
    .in("visit_id", completed.map((v) => v.id));
  if (error || !rows || rows.length === 0) return out;
  const dates = new Map<string, string>((rows as { visit_id: string; follow_up_date: string }[]).map((r) => [r.visit_id, r.follow_up_date]));
  const patientIds = [...new Set(completed.filter((v) => dates.has(v.id)).map((v) => v.patient_id))];
  const since = new Date(new Date(windowStartIso).getTime() - 3 * 86_400_000).toISOString();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: future } = await (ctx.db.from("visits") as any)
    .select("patient_id, doctor_id, scheduled_at")
    .eq("tenant_id", ctx.tenantId)
    .in("patient_id", patientIds)
    .in("status", ["booked", "confirmed"])
    .gte("scheduled_at", since);
  const booked = (future ?? []) as { patient_id: string; doctor_id: string; scheduled_at: string | null }[];
  for (const v of completed) {
    const date = dates.get(v.id);
    if (!date) continue;
    const from = addDaysYmd(date, -3);
    const isBooked = booked.some(
      (b) => b.patient_id === v.patient_id && b.doctor_id === v.doctor_id && b.scheduled_at !== null && ymdOf(b.scheduled_at, timeZone) >= from,
    );
    out.set(v.id, { date, booked: isBooked });
  }
  return out;
}

