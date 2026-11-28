/**
 * The calendar views of the Schedule (V2-09f 09F): the month's six-week range, the month's day counts and the week time grid's layout. Client-safe and
 * pure: the screens and the specs share it. Every number comes from one `schedule_range` answer (the week with slots, the month without): no slot rule
 * here, no extra read.
 */
import { addDaysYmd, startOfMonthYmd, ymdOf, zonedDateTimeToUtcIso } from "@/lib/datetime";
import type { ScheduleRange } from "./range";
import { weekStart, type FreeSlot, type ScheduleAppointment, type ScheduleBlockView } from "./schema";

/** Days in the month grid: six Monday-to-Sunday weeks, which hold every month, and exactly the range cap (42 days). */
export const MONTH_GRID_DAYS = 42;

/** The range the month view reads: the six weeks from the Monday on or before the 1st of `date`'s month (42 days, inside the 42-day cap). */
export function rangeOfMonth(date: string): { from: string; to: string } {
  const from = weekStart(startOfMonthYmd(date));
  return { from, to: addDaysYmd(from, MONTH_GRID_DAYS - 1) };
}

/** The 1st of the month `delta` months from `date`'s month (the month view's previous and next). */
export function shiftMonth(date: string, delta: number): string {
  const [y, m] = startOfMonthYmd(date).split("-").map(Number) as [number, number];
  const index = y * 12 + (m - 1) + delta;
  return `${String(Math.floor(index / 12)).padStart(4, "0")}-${String((index % 12) + 1).padStart(2, "0")}-01`;
}

export interface MonthDay {
  date: string;
  /** In the month shown (the grid's first and last days may belong to the months around it). */
  inMonth: boolean;
  /** Appointments that day for the filter (the range holds no cancelled visit; missed ones are not counted, as in the week overview). */
  booked: number;
  /** A clinic-wide all-day block ("clinic"), the filtered doctor's own all-day block ("doctor"), or none. */
  closed: "clinic" | "doctor" | null;
}

/** The month grid of `date`'s month from a range that holds its six weeks; `doctor` is `all` or one clinician's id. */
export function buildMonthDays(range: Pick<ScheduleRange, "visits" | "blocks">, date: string, doctor: string, timeZone: string): MonthDay[] {
  const { from } = rangeOfMonth(date);
  const month = date.slice(0, 7);
  const counts = new Map<string, number>();
  for (const v of range.visits) {
    if (v.status === "no_show" || (doctor !== "all" && v.doctor_id !== doctor)) continue;
    const day = ymdOf(v.scheduled_at, timeZone);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  return Array.from({ length: MONTH_GRID_DAYS }, (_, i) => {
    const day = addDaysYmd(from, i);
    const start = Date.parse(zonedDateTimeToUtcIso(day, "00:00", timeZone));
    const end = Date.parse(zonedDateTimeToUtcIso(addDaysYmd(day, 1), "00:00", timeZone));
    const touching = range.blocks.filter((b) => b.all_day && Date.parse(b.start_time) < end && Date.parse(b.end_time) > start);
    const closed = touching.some((b) => b.doctor_id === null)
      ? "clinic"
      : doctor !== "all" && touching.some((b) => b.doctor_id === doctor)
        ? "doctor"
        : null;
    return { date: day, inMonth: day.slice(0, 7) === month, booked: counts.get(day) ?? 0, closed };
  });
}

/** Minutes from the clinic's local midnight of an `HH:mm`. */
export function minuteOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return h * 60 + m;
}

export interface GridAppointment {
  appointment: ScheduleAppointment;
  /** Start and end, in minutes from local midnight (an end at or before the start, past midnight, is the end of the day). */
  start: number;
  end: number;
  /** Its lane among the appointments it overlaps (0-based) and how many lanes that group has (an overbooked pair sits side by side). */
  lane: number;
  lanes: number;
}

export interface GridDay {
  date: string;
  appointments: GridAppointment[];
  /** The day's blocks (the doctor's and the clinic's), clipped to the day; an all-day block covers the whole axis. */
  blocks: { block: ScheduleBlockView; start: number; end: number }[];
  /** The day's free slots that have not started. */
  free: { slot: FreeSlot; start: number }[];
}

export interface WeekGrid {
  doctorId: string;
  /** One grid row: the doctor's slot length (at least 5 minutes). */
  slotMinutes: number;
  /** The axis, whole hours, in minutes from local midnight. */
  startMinute: number;
  endMinute: number;
  days: GridDay[];
}

/** The axis when the week has nothing to place (no slot, no appointment): a usual clinic day. */
const DEFAULT_AXIS = { start: 9 * 60, end: 18 * 60 };
const DAY_END = 24 * 60;

/**
 * Lanes for one day's appointments: a greedy pass in start order; a group of overlapping ones shares a lane count. Overlap is judged on the DRAWN extent
 * (a block is at least one row tall, review M-3), so two back-to-back short visits under a longer row sit side by side instead of covering each other.
 */
function layOut(appointments: ScheduleAppointment[], rowMinutes: number): GridAppointment[] {
  const items = appointments
    .map((appointment) => {
      const start = minuteOf(appointment.time);
      const end = Math.max(start + 5, minuteOf(appointment.endTime) <= start ? DAY_END : minuteOf(appointment.endTime));
      return { appointment, start, end, lane: 0, lanes: 1 };
    })
    .sort((a, b) => a.start - b.start || a.end - b.end || a.appointment.name.localeCompare(b.appointment.name));
  const drawnEnd = (item: (typeof items)[number]) => Math.max(item.end, item.start + rowMinutes);
  let group: typeof items = [];
  let groupEnd = -1;
  const close = () => {
    const lanes = Math.max(1, ...group.map((g) => g.lane + 1));
    for (const g of group) g.lanes = lanes;
    group = [];
  };
  for (const item of items) {
    if (item.start >= groupEnd) {
      close();
      groupEnd = -1;
    }
    const laneEnds: number[] = [];
    for (const g of group) laneEnds[g.lane] = Math.max(laneEnds[g.lane] ?? -1, drawnEnd(g));
    let lane = laneEnds.findIndex((e) => e <= item.start);
    if (lane === -1) lane = laneEnds.length;
    item.lane = lane;
    group.push(item);
    groupEnd = Math.max(groupEnd, drawnEnd(item));
  }
  close();
  return items;
}

/** The week grid of one doctor from the seven days' parts (built by `buildScheduleData` per day). */
export function buildWeekGrid(
  doctorId: string,
  slotMinutes: number,
  days: { date: string; appointments: ScheduleAppointment[]; blocks: ScheduleBlockView[]; free: FreeSlot[] }[],
): WeekGrid {
  let lo = Infinity;
  let hi = -Infinity;
  const built: GridDay[] = days.map((d) => {
    const appointments = layOut(d.appointments, Math.max(5, slotMinutes));
    const free = d.free.map((slot) => ({ slot, start: minuteOf(slot.time) }));
    for (const a of appointments) {
      lo = Math.min(lo, a.start);
      hi = Math.max(hi, a.end);
    }
    for (const f of free) {
      lo = Math.min(lo, f.start);
      hi = Math.max(hi, f.start + f.slot.minutes);
    }
    const blocks = d.blocks.map((block) => {
      if (block.allDay) return { block, start: 0, end: DAY_END };
      const start = minuteOf(block.time);
      // An end at midnight is the day's end, except for a block that ended at the midnight this day began (clipped to 00:00 to 00:00: nothing today).
      const end = minuteOf(block.endTime) <= start ? (start === 0 ? 0 : DAY_END) : minuteOf(block.endTime);
      return { block, start, end };
    });
    return { date: d.date, appointments, blocks, free };
  });
  const startMinute = Number.isFinite(lo) ? Math.floor(lo / 60) * 60 : DEFAULT_AXIS.start;
  const endMinute = Number.isFinite(hi) ? Math.min(DAY_END, Math.ceil(hi / 60) * 60) : DEFAULT_AXIS.end;
  // Blocks are clipped to the axis (a block outside it shows nothing).
  for (const day of built) {
    day.blocks = day.blocks
      .map((b) => ({ ...b, start: Math.max(b.start, startMinute), end: Math.min(b.end, endMinute) }))
      .filter((b) => b.end > b.start);
  }
  return { doctorId, slotMinutes: Math.max(5, slotMinutes), startMinute, endMinute: Math.max(endMinute, startMinute + 60), days: built };
}
