import "server-only";

import { assertPerm, hasPerm, ROLE_PERMISSIONS } from "@/lib/permissions";
import type { ServiceContext } from "@/lib/auth/context";
import type { VisitStatus } from "@/lib/db/types";
import { addDaysYmd, clockOf, dayWindowUtc, rangeWindowUtc, todayInTz, ymdOf } from "@/lib/datetime";
import { getTenantTimeZone } from "@/lib/datetime/server";
import { errorTag, log } from "@/lib/log";
import { getRequestId } from "@/lib/log/request-id";
import { getTenantDoctorDirectory } from "@/features/staff/service";
import { rowActions } from "@/features/visits/state-machine";
import { getAvailableSlots } from "@/features/visits/scheduling-service";
import { weekStart, type FreeSlot, type ScheduleAppointment, type ScheduleBlockView, type ScheduleData, type WaitlistView, type WeekDayCount } from "./schema";

/**
 * Schedule read model (V2-08 08-04b, P1-31): one clinic day for the Schedule screen, with explicit column lists (no
 * `select *`), on the caller's own session so RLS decides, `appointments:view`. Appointments are the day's scheduled visits
 * that are not cancelled (a no-show stays, with its own chip); free slots are the database's own list
 * (`available_slots`, the one the booking command checks, so the grid and the booking agree, R-9); blocks are the doctor's
 * and the clinic-wide ones that touch the day. The week overview counts one doctor's seven days from Monday.
 */
export interface ScheduleOptions {
  date?: string;
  /** `all` or one doctor's user id. */
  doctor?: string;
  /** Read the week overview for the selected doctor. */
  week?: boolean;
  now?: Date;
}

const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (c: { hour: number; minute: number }) => `${pad(c.hour)}:${pad(c.minute)}`;
const one = <T>(value: T | T[] | null | undefined): T | null => (Array.isArray(value) ? (value[0] ?? null) : (value ?? null));

interface VisitRow {
  id: string;
  patient_id: string;
  doctor_id: string;
  status: VisitStatus;
  scheduled_at: string;
  estimated_duration_minutes: number | null;
  is_overbooked: boolean;
  signed_at: string | null;
  clinic_confirmed: string | null;
  patient_confirmed: string | null;
  patients: { full_name: string } | { full_name: string }[] | null;
}

const VISIT_COLUMNS =
  "id, patient_id, doctor_id, status, scheduled_at, estimated_duration_minutes, is_overbooked, signed_at, " +
  "clinic_confirmed:metadata->>clinic_confirmed, patient_confirmed:metadata->>patient_confirmed, patients(full_name)";

export async function getSchedule(ctx: ServiceContext, options: ScheduleOptions = {}): Promise<{ ok: true; data: ScheduleData } | { ok: false }> {
  assertPerm(ctx.role, "appointments:view");
  const now = options.now ?? new Date();
  const timeZone = await getTenantTimeZone(ctx.db, ctx.tenantId);
  const today = todayInTz(timeZone, now);
  const date = options.date ?? today;
  const requestId = await getRequestId();
  const fail = (event: `${string}.${string}`, error: unknown) => {
    log.error({ event, code: errorTag(error), requestId, tenantId: ctx.tenantId });
    return { ok: false as const };
  };

  const directory = await getTenantDoctorDirectory(ctx);
  const doctors = directory.map((d) => ({ id: d.id, name: d.name, specialty: d.specialty ?? null }));
  const known = new Set(doctors.map((d) => d.id));
  const doctorFilter = options.doctor && known.has(options.doctor) ? options.doctor : "all";
  const shown = doctorFilter === "all" ? doctors : doctors.filter((d) => d.id === doctorFilter);
  const nameOf = new Map(directory.map((d) => [d.id, d.name]));

  const { startIso, endIsoExclusive } = dayWindowUtc(date, timeZone);
  const permissions = ROLE_PERMISSIONS[ctx.role];
  const canEdit = hasPerm(ctx.role, "appointments:edit");
  // `createScheduleBlock`: another doctor's time or the whole clinic needs clinic:manage; a doctor may block their own.
  const manages = hasPerm(ctx.role, "clinic:manage");
  const ownsColumn = hasPerm(ctx.role, "appointments:edit") && known.has(ctx.userId);
  const block = { allowed: manages || ownsColumn, doctorId: manages || !ownsColumn ? null : ctx.userId };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let visitQuery = (ctx.db.from("visits") as any)
    .select(VISIT_COLUMNS)
    .eq("tenant_id", ctx.tenantId)
    .gte("scheduled_at", startIso)
    .lt("scheduled_at", endIsoExclusive)
    .neq("status", "cancelled");
  if (doctorFilter !== "all") visitQuery = visitQuery.eq("doctor_id", doctorFilter);
  const { data: visits, error: visitsError } = (await visitQuery) as { data: VisitRow[] | null; error: { message: string } | null };
  if (visitsError || !visits) return fail("schedule.visits.failed", visitsError);

  const appointments: ScheduleAppointment[] = visits.map((v) => {
    const start = clockOf(v.scheduled_at, timeZone);
    const minutes = v.estimated_duration_minutes ?? 15;
    const end = clockOf(new Date(Date.parse(v.scheduled_at) + minutes * 60_000), timeZone);
    const confirmed = v.status === "confirmed" || v.clinic_confirmed === "true" || v.patient_confirmed === "true";
    return {
      visitId: v.id,
      patientId: v.patient_id,
      name: one(v.patients)?.full_name ?? "Patient",
      doctorId: v.doctor_id,
      doctorName: nameOf.get(v.doctor_id) ?? "Doctor",
      time: hhmm(start),
      endTime: hhmm(end),
      minutes,
      status: v.status,
      overbooked: v.is_overbooked,
      confirmed,
      actions: rowActions(permissions, { status: v.status, scheduledAt: v.scheduled_at, signed: v.signed_at != null }, now, timeZone),
      canConfirm: canEdit && v.status === "booked" && !confirmed,
    };
  });

  // Blocks that touch the day: the shown doctors' own and the clinic-wide ones.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: blockRows, error: blocksError } = await (ctx.db.from("schedule_blocks") as any)
    .select("id, doctor_id, start_time, end_time, all_day, reason")
    .eq("tenant_id", ctx.tenantId)
    .lt("start_time", endIsoExclusive)
    .gte("end_time", startIso);
  if (blocksError || !blockRows) return fail("schedule.blocks.failed", blocksError);
  const blocks: ScheduleBlockView[] = (blockRows as { id: string; doctor_id: string | null; start_time: string; end_time: string; all_day: boolean; reason: string | null }[])
    .filter((b) => b.doctor_id === null || doctorFilter === "all" || b.doctor_id === doctorFilter)
    .map((b) => ({
      id: b.id,
      doctorId: b.doctor_id,
      time: hhmm(clockOf(b.start_time < startIso ? startIso : b.start_time, timeZone)),
      endTime: hhmm(clockOf(b.end_time > endIsoExclusive ? endIsoExclusive : b.end_time, timeZone)),
      allDay: b.all_day,
      reason: b.reason,
    }));

  // V2-09d: `available_slots` takes one doctor and one date, so the grid needs one call per (doctor, date). They are sent
  // together (one round trip of latency, not one per call), and a (doctor, date) the day grid and the week strip both
  // need is asked once.
  const slotCalls = new Map<string, ReturnType<typeof getAvailableSlots>>();
  const slotsOf = (doctorId: string, day: string) => {
    const key = `${doctorId}|${day}`;
    let call = slotCalls.get(key);
    if (!call) {
      call = getAvailableSlots(ctx, doctorId, day);
      slotCalls.set(key, call);
    }
    return call;
  };
  const weekDoctorId = options.week ? (doctorFilter !== "all" ? doctorFilter : (doctors[0]?.id ?? "")) : "";
  const weekDates = weekDoctorId ? Array.from({ length: 7 }, (_, i) => addDaysYmd(weekStart(date), i)) : [];
  const daySlots = await Promise.all(shown.map((doctor) => slotsOf(doctor.id, date)));
  const weekSlots = await Promise.all(weekDates.map((day) => slotsOf(weekDoctorId, day)));

  // Free slots: the database's own list for each shown doctor.
  const free: FreeSlot[] = [];
  for (const [index, doctor] of shown.entries()) {
    const slots = daySlots[index]!;
    if (!slots.ok) return fail("schedule.slots.failed", slots.error);
    for (const s of slots.value) {
      // A slot that has started is not offered (the command refuses a time that has passed).
      if (Date.parse(s.start) < now.getTime()) continue;
      free.push({ doctorId: doctor.id, time: hhmm(clockOf(s.start, timeZone)), minutes: Math.round((Date.parse(s.end) - Date.parse(s.start)) / 60_000) });
    }
  }

  // The day's waitlist (explicit columns; the patient's name only).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let waitQuery = (ctx.db.from("waitlist_entries") as any)
    .select("id, doctor_id, priority, time_window, patients(full_name)")
    .eq("tenant_id", ctx.tenantId)
    .eq("target_date", date)
    .eq("status", "waiting")
    .order("priority", { ascending: false })
    .order("created_at", { ascending: true });
  if (doctorFilter !== "all") waitQuery = waitQuery.or(`doctor_id.eq.${doctorFilter},doctor_id.is.null`);
  const { data: waitRows, error: waitError } = (await waitQuery) as {
    data: { id: string; doctor_id: string | null; priority: number; time_window: string | null; patients: { full_name: string } | { full_name: string }[] | null }[] | null;
    error: { message: string } | null;
  };
  if (waitError || !waitRows) return fail("schedule.waitlist.failed", waitError);
  const waitlist: WaitlistView[] = waitRows.map((w) => ({
    id: w.id,
    patientName: one(w.patients)?.full_name ?? "Patient",
    doctorId: w.doctor_id,
    doctorName: w.doctor_id ? (nameOf.get(w.doctor_id) ?? "Doctor") : null,
    priority: w.priority,
    timeWindow: w.time_window,
  }));

  let week: ScheduleData["week"] = null;
  if (options.week) {
    const doctorId = weekDoctorId;
    if (doctorId) {
      const dates = weekDates;
      const window = rangeWindowUtc(dates[0]!, dates[6]!, timeZone);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: weekVisits, error: weekError } = await (ctx.db.from("visits") as any)
        .select("scheduled_at, status")
        .eq("tenant_id", ctx.tenantId)
        .eq("doctor_id", doctorId)
        .gte("scheduled_at", window.startIso)
        .lt("scheduled_at", window.endIsoExclusive)
        .not("status", "in", "(cancelled,no_show)");
      if (weekError || !weekVisits) return fail("schedule.week.failed", weekError);
      const booked = new Map<string, number>();
      for (const v of weekVisits as { scheduled_at: string }[]) {
        const day = ymdOf(v.scheduled_at, timeZone);
        booked.set(day, (booked.get(day) ?? 0) + 1);
      }
      const days: WeekDayCount[] = [];
      for (const [index, day] of dates.entries()) {
        const slots = weekSlots[index]!;
        if (!slots.ok) return fail("schedule.week_slots.failed", slots.error);
        days.push({ date: day, booked: booked.get(day) ?? 0, free: slots.value.length });
      }
      week = { doctorId, days };
    }
  }

  return { ok: true, data: { date, today, timeZone, doctors, doctorFilter, appointments, blocks, free, waitlist, week, canEdit, block } };
}
