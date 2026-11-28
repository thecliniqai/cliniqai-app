/**
 * The Schedule's range read (V2-09e 09E-12, R-10): the shape `public.schedule_range` answers, its parser, the range a view reads and the pure builder that
 * turns a range into what the Schedule shows for one date (`ScheduleData`). Client-safe (no server import): the page, the route, the client query and the
 * specs share it. No slot rule lives here: the free slots are the database's own list (`available_slots` inside `schedule_range`); the only client step is
 * hiding a slot whose start has passed, by the device clock corrected by its offset to the server's `server_now` (display only; the commands refuse a past
 * or taken slot themselves).
 */
import type { UserRole, VisitStatus } from "@/lib/db/types";
import { addDaysYmd, clockOf, isYmd, resolveTimeZone, todayInTz, ymdOf, zonedDateTimeToUtcIso } from "@/lib/datetime";
import { emptyVersions, type Versions } from "@/lib/live/domains";
import { hasPerm, ROLE_PERMISSIONS } from "@/lib/permissions";
import { formatDoctorDisplayName } from "@/features/staff/formatters";
import { rowActions } from "@/features/visits/state-machine";
import { buildMonthDays, buildWeekGrid, rangeOfMonth, shiftMonth } from "./calendar";
import { weekStart, type FreeSlot, type ScheduleAppointment, type ScheduleBlockView, type ScheduleData, type WaitlistView, type WeekDayCount } from "./schema";

/** The longest range one read serves (the SQL refuses more). */
export const MAX_RANGE_DAYS = 42;

export interface RangeClinician {
  id: string;
  full_name: string | null;
  specialty: string | null;
  slot_minutes: number;
  schedule: unknown;
}
export interface RangeBlock {
  id: string;
  doctor_id: string | null;
  start_time: string;
  end_time: string;
  all_day: boolean;
  reason: string | null;
}
export interface RangeVisit {
  id: string;
  patient_id: string;
  doctor_id: string;
  status: VisitStatus;
  scheduled_at: string;
  estimated_duration_minutes: number | null;
  is_overbooked: boolean;
  signed_at: string | null;
  row_version: number;
  clinic_confirmed: string | null;
  patient_confirmed: string | null;
  patient_name: string | null;
}
export interface RangeWaitlistEntry {
  id: string;
  target_date: string;
  doctor_id: string | null;
  priority: number;
  time_window: string | null;
  created_at: string;
  patient_name: string | null;
}
export interface RangeSlots {
  doctor_id: string;
  date: string;
  /** [start minute from the clinic's local midnight, length in minutes], by start. */
  slots: [number, number][];
}
export interface ScheduleRange {
  /** The clinic dates the range covers (set by the reader: the SQL answer does not repeat them). */
  from: string;
  to: string;
  zone: string | null;
  server_now: string;
  versions: { schedule: number | null; queue: number | null } | null;
  clinicians: RangeClinician[];
  blocks: RangeBlock[];
  visits: RangeVisit[];
  waitlist: RangeWaitlistEntry[];
  /** Absent when the range was read without slots. */
  slots?: RangeSlots[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The SQL answer with the range it was asked for, or null when it is not a range answer (a NULL: refused or out of bounds). */
export function parseScheduleRange(raw: unknown, from: string, to: string): ScheduleRange | null {
  if (!isObj(raw)) return null;
  const { zone, server_now, versions, clinicians, blocks, visits, waitlist, slots } = raw;
  if (typeof server_now !== "string" || !Array.isArray(clinicians) || !Array.isArray(blocks) || !Array.isArray(visits) || !Array.isArray(waitlist)) return null;
  if (slots !== undefined && !Array.isArray(slots)) return null;
  return {
    from,
    to,
    zone: typeof zone === "string" ? zone : null,
    server_now,
    versions: isObj(versions) ? { schedule: typeof versions.schedule === "number" ? versions.schedule : null, queue: typeof versions.queue === "number" ? versions.queue : null } : null,
    clinicians: clinicians as RangeClinician[],
    blocks: blocks as RangeBlock[],
    visits: visits as RangeVisit[],
    waitlist: waitlist as RangeWaitlistEntry[],
    ...(slots !== undefined ? { slots: slots as RangeSlots[] } : {}),
  };
}

/** The versions a range reflects, as the live core's basis (null when either was missing: no basis, one extra re-read at most). */
export function rangeVersions(range: Pick<ScheduleRange, "versions">): Versions | null {
  if (!range.versions || range.versions.schedule == null || range.versions.queue == null) return null;
  return { ...emptyVersions(), schedule: range.versions.schedule, queue: range.versions.queue };
}

/** The range one Schedule address reads: the Monday-to-Sunday week that holds `date` (the day, agenda and week views all draw from it). */
export function rangeOfDate(date: string): { from: string; to: string } {
  const from = weekStart(date);
  return { from, to: addDaysYmd(from, 6) };
}

/** The ranges prefetched once the visible one settled: the week before and the week after (B-9: the next day and the next week show with 0 calls). */
export function adjacentRanges(range: { from: string; to: string }): { from: string; to: string }[] {
  return [
    { from: addDaysYmd(range.from, -7), to: addDaysYmd(range.to, -7) },
    { from: addDaysYmd(range.from, 7), to: addDaysYmd(range.to, 7) },
  ];
}

/**
 * The range a view reads and the ranges read ahead once it settles (V2-09f): a week (with slots) reads ahead the weeks around it and the month of the
 * date (counts only); the month (six weeks, no slots) reads ahead the week of the date and the months around it.
 */
export interface RangeRequest {
  from: string;
  to: string;
  withSlots: boolean;
}

export function rangesFor(date: string, month: boolean): { range: RangeRequest; ahead: RangeRequest[] } {
  if (month) {
    const range = { ...rangeOfMonth(date), withSlots: false };
    return {
      range,
      ahead: [
        { ...rangeOfDate(date), withSlots: true },
        { ...rangeOfMonth(shiftMonth(date, -1)), withSlots: false },
        { ...rangeOfMonth(shiftMonth(date, 1)), withSlots: false },
      ],
    };
  }
  const week = rangeOfDate(date);
  return {
    range: { ...week, withSlots: true },
    ahead: [...adjacentRanges(week).map((r) => ({ ...r, withSlots: true })), { ...rangeOfMonth(date), withSlots: false }],
  };
}

/** A well-formed range request: two clinic dates, in order, at most 42 days. */
export function isRangeOk(from: string, to: string): boolean {
  return isYmd(from) && isYmd(to) && to >= from && to <= addDaysYmd(from, MAX_RANGE_DAYS - 1);
}

const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (c: { hour: number; minute: number }) => `${pad(c.hour)}:${pad(c.minute)}`;
const minuteText = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

export interface BuildOptions {
  /** The clinic date shown. */
  date: string;
  /** `all` or one doctor's id (an unknown id is `all`). */
  doctor: string;
  /** Build the week overview for the selected doctor. */
  week: boolean;
  /** Build the month grid (V2-09f; the range holds the month's six weeks). */
  month?: boolean;
  role: UserRole;
  userId: string;
  /** The device's clock now, corrected by its offset to the server (display only). */
  now: Date;
}

/** The clinicians as the Schedule names them (`Dr. …`, or `Doctor N` for an unnamed one, by position: the directory's rule). */
export function clinicianNames(range: Pick<ScheduleRange, "clinicians">): { id: string; name: string; specialty: string | null }[] {
  return range.clinicians.map((c, index) => ({ id: c.id, name: formatDoctorDisplayName(c.full_name, index + 1), specialty: c.specialty || "general_physician" }));
}

/** The free slots of one clinician on one date that have not started at `now`, as the Schedule's `FreeSlot`s. */
export function freeSlotsOf(range: ScheduleRange, doctorId: string, date: string, timeZone: string, now: Date): FreeSlot[] {
  const entry = range.slots?.find((s) => s.doctor_id === doctorId && s.date === date);
  if (!entry) return [];
  const out: FreeSlot[] = [];
  for (const [start, minutes] of entry.slots) {
    const time = minuteText(start);
    if (Date.parse(zonedDateTimeToUtcIso(date, time, timeZone)) < now.getTime()) continue;
    out.push({ doctorId, time, minutes });
  }
  return out;
}

interface DayContext {
  timeZone: string;
  nameOf: Map<string, string>;
  permissions: (typeof ROLE_PERMISSIONS)[UserRole];
  canEdit: boolean;
  now: Date;
}

/** One clinic date of a range for a doctor filter: its appointments, its blocks (clipped to the day) and the shown doctors' free slots. */
function dayParts(
  range: ScheduleRange,
  date: string,
  doctorFilter: string,
  shown: { id: string }[],
  ctx: DayContext,
): { appointments: ScheduleAppointment[]; blocks: ScheduleBlockView[]; free: FreeSlot[] } {
  const { timeZone, nameOf, canEdit } = ctx;
  const appointments: ScheduleAppointment[] = range.visits
    .filter((v) => ymdOf(v.scheduled_at, timeZone) === date && (doctorFilter === "all" || v.doctor_id === doctorFilter))
    .map((v) => {
      const minutes = v.estimated_duration_minutes ?? 15;
      const confirmed = v.status === "confirmed" || v.clinic_confirmed === "true" || v.patient_confirmed === "true";
      return {
        visitId: v.id,
        patientId: v.patient_id,
        name: v.patient_name ?? "Patient",
        doctorId: v.doctor_id,
        doctorName: nameOf.get(v.doctor_id) ?? "Doctor",
        time: hhmm(clockOf(v.scheduled_at, timeZone)),
        endTime: hhmm(clockOf(new Date(Date.parse(v.scheduled_at) + minutes * 60_000), timeZone)),
        minutes,
        status: v.status,
        overbooked: v.is_overbooked,
        confirmed,
        actions: rowActions(ctx.permissions, { status: v.status, scheduledAt: v.scheduled_at, signed: v.signed_at != null }, ctx.now, timeZone),
        canConfirm: canEdit && v.status === "booked" && !confirmed,
        rowVersion: v.row_version,
      };
    });

  const dayStart = zonedDateTimeToUtcIso(date, "00:00", timeZone);
  const dayEnd = zonedDateTimeToUtcIso(addDaysYmd(date, 1), "00:00", timeZone);
  const blocks: ScheduleBlockView[] = range.blocks
    .filter((b) => Date.parse(b.start_time) < Date.parse(dayEnd) && Date.parse(b.end_time) >= Date.parse(dayStart))
    .filter((b) => b.doctor_id === null || doctorFilter === "all" || b.doctor_id === doctorFilter)
    .map((b) => ({
      id: b.id,
      doctorId: b.doctor_id,
      time: hhmm(clockOf(Date.parse(b.start_time) < Date.parse(dayStart) ? dayStart : b.start_time, timeZone)),
      endTime: hhmm(clockOf(Date.parse(b.end_time) > Date.parse(dayEnd) ? dayEnd : b.end_time, timeZone)),
      allDay: b.all_day,
      reason: b.reason,
    }));

  const free: FreeSlot[] = shown.flatMap((d) => freeSlotsOf(range, d.id, date, timeZone, ctx.now));

  return { appointments, blocks, free };
}

/** What the Schedule shows for one date of a range (the read model `getSchedule` used to build from eight or more calls). */
export function buildScheduleData(range: ScheduleRange, options: BuildOptions): ScheduleData {
  const timeZone = resolveTimeZone(range.zone);
  const today = todayInTz(timeZone, options.now);
  const date = options.date;
  const doctors = clinicianNames(range);
  const known = new Set(doctors.map((d) => d.id));
  const doctorFilter = known.has(options.doctor) ? options.doctor : "all";
  const nameOf = new Map(doctors.map((d) => [d.id, d.name]));
  const shown = doctorFilter === "all" ? doctors : doctors.filter((d) => d.id === doctorFilter);
  const permissions = ROLE_PERMISSIONS[options.role];
  const canEdit = hasPerm(options.role, "appointments:edit");
  const manages = hasPerm(options.role, "clinic:manage");
  const ownsColumn = canEdit && known.has(options.userId);
  const block = { allowed: manages || ownsColumn, doctorId: manages || !ownsColumn ? null : options.userId };
  const ctx: DayContext = { timeZone, nameOf, permissions, canEdit, now: options.now };

  const { appointments, blocks, free } = dayParts(range, date, doctorFilter, shown, ctx);

  const waitlist: WaitlistView[] = range.waitlist
    .filter((w) => w.target_date === date && (doctorFilter === "all" || w.doctor_id === null || w.doctor_id === doctorFilter))
    .map((w) => ({
      id: w.id,
      patientName: w.patient_name ?? "Patient",
      doctorId: w.doctor_id,
      doctorName: w.doctor_id ? (nameOf.get(w.doctor_id) ?? "Doctor") : null,
      priority: w.priority,
      timeWindow: w.time_window,
    }));

  let week: ScheduleData["week"] = null;
  if (options.week) {
    const doctorId = doctorFilter !== "all" ? doctorFilter : (doctors[0]?.id ?? "");
    if (doctorId) {
      const start = weekStart(date);
      const days: WeekDayCount[] = Array.from({ length: 7 }, (_, i) => addDaysYmd(start, i)).map((day) => ({
        date: day,
        booked: range.visits.filter((v) => v.doctor_id === doctorId && v.status !== "no_show" && ymdOf(v.scheduled_at, timeZone) === day).length,
        free: freeSlotsOf(range, doctorId, day, timeZone, options.now).length,
      }));
      const clinician = range.clinicians.find((c) => c.id === doctorId);
      const grid = range.slots
        ? buildWeekGrid(
            doctorId,
            clinician?.slot_minutes ?? 15,
            days.map((d) => ({ date: d.date, ...dayParts(range, d.date, doctorId, doctors.filter((x) => x.id === doctorId), ctx) })),
          )
        : null;
      week = { doctorId, days, grid };
    }
  }

  const month = options.month ? buildMonthDays(range, date, doctorFilter, timeZone) : null;

  return { date, today, timeZone, doctors, doctorFilter, appointments, blocks, free, waitlist, week, month, canEdit, block };
}

const offsets = new WeakMap<ScheduleRange, number>();

/**
 * The device clock corrected by its offset to the server's `server_now` (display only: which slots have started). The offset of a range is taken the first
 * time this device sees it (right after it arrived, by fetch or by hydration), so a fast or slow device clock does not hide or show the wrong slots.
 */
export function serverNowOf(range: ScheduleRange, deviceNow: number = Date.now()): Date {
  let offset = offsets.get(range);
  if (offset === undefined) {
    const server = Date.parse(range.server_now);
    offset = Number.isFinite(server) ? server - deviceNow : 0;
    offsets.set(range, offset);
  }
  return new Date(deviceNow + offset);
}
