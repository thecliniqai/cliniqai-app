/**
 * Schedule model (V2-08 08-04b; IA §3.4): what the Schedule screen shows for one clinic day and one week, and the pure rules
 * that arrange it. Client-safe (no server import): the screens, the read model and the unit specs share one definition.
 * Times are clinic wall-clock `HH:mm`; dates are clinic `YYYY-MM-DD`. Nothing here is free text except a block's reason (shown
 * to staff who may block time) and the waitlist's time window.
 */
import type { RowAction } from "@/features/visits/state-machine";
import type { MonthDay, WeekGrid } from "./calendar";
import type { VisitStatus } from "@/lib/db/types";
import { addDaysYmd, weekdayOfYmd } from "@/lib/datetime";

export const SCHEDULE_VIEWS = ["day", "agenda", "week", "month"] as const;
export type ScheduleView = (typeof SCHEDULE_VIEWS)[number];

export function isScheduleView(value: unknown): value is ScheduleView {
  return typeof value === "string" && (SCHEDULE_VIEWS as readonly string[]).includes(value);
}

export interface ScheduleDoctor {
  id: string;
  name: string;
  specialty: string | null;
}

export interface ScheduleAppointment {
  visitId: string;
  patientId: string;
  name: string;
  doctorId: string;
  doctorName: string;
  /** Clinic `HH:mm` of the start and of the end (start plus the visit's duration). */
  time: string;
  endTime: string;
  minutes: number;
  status: VisitStatus;
  overbooked: boolean;
  /** The clinic or the patient confirmed it (status `confirmed`, or the confirmation flags on a booked visit). */
  confirmed: boolean;
  /** The state machine's actions for the caller's role now (`rowActions`). */
  actions: RowAction[];
  /** Offered a Confirm button: booked, not yet confirmed, and the role may edit appointments. */
  canConfirm: boolean;
  /** The visit's `row_version` as read with the day (09E-07, R-19): the commands of the row (Confirm, Mark as no-show, Cancel) send it. */
  rowVersion: number;
}

export interface ScheduleBlockView {
  id: string;
  /** null = the whole clinic. */
  doctorId: string | null;
  time: string;
  endTime: string;
  allDay: boolean;
  reason: string | null;
}

export interface FreeSlot {
  doctorId: string;
  time: string;
  minutes: number;
}

export interface WaitlistView {
  id: string;
  patientName: string;
  /** null = any doctor. */
  doctorId: string | null;
  doctorName: string | null;
  priority: number;
  timeWindow: string | null;
}

export interface WeekDayCount {
  date: string;
  /** Booked appointments of the doctor that day (cancelled and missed ones are not counted). */
  booked: number;
  /** Free slots left that day. */
  free: number;
}

export interface ScheduleData {
  /** The clinic date shown, today's date and the clinic's zone. */
  date: string;
  today: string;
  timeZone: string;
  doctors: ScheduleDoctor[];
  /** The doctor filter (`all` or one doctor's id). */
  doctorFilter: string;
  appointments: ScheduleAppointment[];
  blocks: ScheduleBlockView[];
  /** Free slots of the shown doctors that day (the database's `available_slots`). */
  free: FreeSlot[];
  waitlist: WaitlistView[];
  /**
   * Week overview: the seven days from `weekStart` for the one selected doctor (empty unless the week view was asked for). `grid` (V2-09f) is the same
   * week as a time grid (the 768 px and up week view); absent when the range was read without slots.
   */
  week: { doctorId: string; days: WeekDayCount[]; grid: WeekGrid | null } | null;
  /** The month grid (V2-09f; six weeks, counts for the doctor filter), only when the month view was asked for. */
  month: MonthDay[] | null;
  canEdit: boolean;
  /**
   * Who may block time (the service's rule, `createScheduleBlock`): `clinic:manage` blocks any doctor or the whole clinic
   * (`doctorId` null); a doctor blocks only their own time (`doctorId` is theirs); every other role sees no button
   * (V2-08 08-06a, A-8).
   */
  block: { allowed: boolean; doctorId: string | null };
}

/** A line of a doctor's column on the day view, in time order. */
export type ColumnEntry =
  | { kind: "appointment"; time: string; appointment: ScheduleAppointment }
  | { kind: "block"; time: string; block: ScheduleBlockView }
  | { kind: "free"; time: string; slots: FreeSlot[] };

const kindRank = { block: 0, appointment: 1, free: 2 } as const;

/**
 * One doctor's day, chronological: appointments, the doctor's own blocks and the clinic-wide ones, and runs of free slots
 * (consecutive free slots with no appointment or block between them share one entry, so a quiet morning is one line of
 * chips, not thirty buttons). An all-day block comes first.
 */
export function columnEntries(doctorId: string, data: Pick<ScheduleData, "appointments" | "blocks" | "free">): ColumnEntry[] {
  const entries: ColumnEntry[] = [];
  for (const a of data.appointments) if (a.doctorId === doctorId) entries.push({ kind: "appointment", time: a.time, appointment: a });
  for (const b of data.blocks) if (b.doctorId === null || b.doctorId === doctorId) entries.push({ kind: "block", time: b.allDay ? "00:00" : b.time, block: b });
  const sorted = (list: ColumnEntry[]) =>
    [...list].sort((x, y) => x.time.localeCompare(y.time) || kindRank[x.kind] - kindRank[y.kind]);
  const busy = sorted(entries);
  const free = data.free.filter((f) => f.doctorId === doctorId).sort((x, y) => x.time.localeCompare(y.time));
  // A run of free slots is cut by the next busy entry that starts after the run's first slot.
  const out: ColumnEntry[] = [];
  let run: FreeSlot[] = [];
  const flush = () => {
    if (run.length > 0) out.push({ kind: "free", time: run[0]!.time, slots: run });
    run = [];
  };
  let b = 0;
  for (const slot of free) {
    while (b < busy.length && busy[b]!.time <= slot.time) {
      flush();
      out.push(busy[b]!);
      b++;
    }
    run.push(slot);
  }
  flush();
  while (b < busy.length) out.push(busy[b++]!);
  return out;
}

/** The Monday of the week that contains `date` (the week overview starts there). */
export function weekStart(date: string): string {
  const order = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
  return addDaysYmd(date, -order.indexOf(weekdayOfYmd(date) as (typeof order)[number]));
}

/** A one-line summary of a day's appointments for the agenda: they are listed by time, then by doctor. */
export function sortAgenda(appointments: readonly ScheduleAppointment[]): ScheduleAppointment[] {
  return [...appointments].sort((a, b) => a.time.localeCompare(b.time) || a.doctorName.localeCompare(b.doctorName) || a.name.localeCompare(b.name));
}

/** The query string of a Schedule address; unset values are left out so URLs stay short and shareable. */
export function scheduleHref(params: { date?: string; view?: ScheduleView | null; doctor?: string | null; today?: string }): string {
  const q = new URLSearchParams();
  if (params.date && params.date !== params.today) q.set("date", params.date);
  if (params.view) q.set("view", params.view);
  if (params.doctor && params.doctor !== "all") q.set("doctor", params.doctor);
  const s = q.toString();
  return s ? `/schedule?${s}` : "/schedule";
}
