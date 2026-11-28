/**
 * V2-09f (09F): the calendar views' pure model: the month's six-week range (inside the 42-day cap), the months around it, the month's day counts (doctor
 * filter, missed visits left out, closed days), the week time grid (axis, rows of the doctor's slot length, overlap lanes, blocks clipped to the axis) and
 * the ranges a view reads ahead (so switching week and month needs no call). Synthetic ids and names only.
 */
import { describe, expect, it } from "vitest";
import { buildMonthDays, buildWeekGrid, MONTH_GRID_DAYS, rangeOfMonth, shiftMonth } from "@/features/schedule/calendar";
import { buildScheduleData, isRangeOk, parseScheduleRange, rangeOfDate, rangesFor, type ScheduleRange } from "@/features/schedule/range";
import type { ScheduleAppointment } from "@/features/schedule/schema";

const A = "00000000-0000-4000-8000-0000000000b1";
const B = "00000000-0000-4000-8000-0000000000b2";
const visit = (id: string, doctor: string, at: string, status = "booked", minutes: number | null = 15) => ({
  id,
  patient_id: `p-${id}`,
  doctor_id: doctor,
  status,
  scheduled_at: at,
  estimated_duration_minutes: minutes,
  is_overbooked: false,
  signed_at: null,
  row_version: 1,
  clinic_confirmed: null,
  patient_confirmed: null,
  patient_name: `Synthetic ${id}`,
});

describe("the month's range", () => {
  it("is the six Monday-first weeks from the Monday on or before the 1st: 42 days, inside the range cap", () => {
    // 1 Dec 2026 is a Tuesday: the grid starts Monday 30 Nov.
    expect(rangeOfMonth("2026-12-17")).toEqual({ from: "2026-11-30", to: "2027-01-10" });
    // 1 Mar 2027 is a Monday: the grid starts on it.
    expect(rangeOfMonth("2027-03-31")).toEqual({ from: "2027-03-01", to: "2027-04-11" });
    for (const d of ["2026-02-14", "2026-11-28", "2027-08-01"]) {
      const r = rangeOfMonth(d);
      expect(isRangeOk(r.from, r.to)).toBe(true);
      expect(r.from <= `${d.slice(0, 7)}-01`).toBe(true);
    }
    expect(MONTH_GRID_DAYS).toBe(42);
  });

  it("moves a month at a time to the 1st, across years", () => {
    expect(shiftMonth("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftMonth("2027-01-15", -1)).toBe("2026-12-01");
    expect(shiftMonth("2026-03-31", -13)).toBe("2025-02-01");
  });

  it("a week reads ahead the weeks around it and its month (no slots); the month reads ahead the week of its date and the months around it", () => {
    const week = rangesFor("2026-12-02", false);
    expect(week.range).toEqual({ ...rangeOfDate("2026-12-02"), withSlots: true });
    expect(week.ahead).toContainEqual({ ...rangeOfMonth("2026-12-02"), withSlots: false });
    expect(week.ahead.filter((r) => r.withSlots)).toHaveLength(2);
    const month = rangesFor("2026-12-02", true);
    expect(month.range).toEqual({ ...rangeOfMonth("2026-12-02"), withSlots: false });
    // Month to week and week to month are each other's read-ahead.
    expect(month.ahead).toContainEqual(week.range);
    expect(month.ahead).toContainEqual({ ...rangeOfMonth("2026-11-01"), withSlots: false });
    expect(month.ahead).toContainEqual({ ...rangeOfMonth("2027-01-01"), withSlots: false });
  });
});

describe("the month's day counts", () => {
  const zone = "Asia/Kolkata";
  const data = {
    visits: [
      visit("v1", A, "2026-12-01T04:30:00Z"),
      visit("v2", A, "2026-12-01T05:30:00Z"),
      visit("v3", B, "2026-12-01T06:30:00Z"),
      visit("v4", A, "2026-12-01T07:30:00Z", "no_show"),
      // 23:45 IST on 2 Dec is still 2 Dec in the clinic (18:15 UTC).
      visit("v5", B, "2026-12-02T18:15:00Z"),
    ],
    blocks: [
      { id: "c", doctor_id: null, start_time: "2026-12-24T18:30:00Z", end_time: "2026-12-25T18:30:00Z", all_day: true, reason: null },
      { id: "d", doctor_id: A, start_time: "2026-12-30T18:30:00Z", end_time: "2026-12-31T18:30:00Z", all_day: true, reason: null },
      { id: "p", doctor_id: null, start_time: "2026-12-10T08:00:00Z", end_time: "2026-12-10T09:00:00Z", all_day: false, reason: null },
    ],
  } as unknown as Pick<ScheduleRange, "visits" | "blocks">;
  const byDate = (doctor: string) => new Map(buildMonthDays(data, "2026-12-15", doctor, zone).map((d) => [d.date, d]));

  it("counts every doctor's visits by clinic date, leaves missed visits out, and marks the days outside the month", () => {
    const days = buildMonthDays(data, "2026-12-15", "all", zone);
    expect(days).toHaveLength(42);
    expect(days[0]).toMatchObject({ date: "2026-11-30", inMonth: false, booked: 0 });
    const all = byDate("all");
    expect(all.get("2026-12-01")?.booked).toBe(3);
    expect(all.get("2026-12-02")?.booked).toBe(1);
    expect(all.get("2026-12-03")?.booked).toBe(0);
  });

  it("applies the doctor filter", () => {
    expect(byDate(A).get("2026-12-01")?.booked).toBe(2);
    expect(byDate(B).get("2026-12-01")?.booked).toBe(1);
    expect(byDate(A).get("2026-12-02")?.booked).toBe(0);
  });

  it("marks a clinic-wide all-day block for everyone and a doctor's own all-day block only under that doctor; a part-day block marks nothing", () => {
    expect(byDate("all").get("2026-12-25")?.closed).toBe("clinic");
    expect(byDate(B).get("2026-12-25")?.closed).toBe("clinic");
    expect(byDate("all").get("2026-12-31")?.closed).toBeNull();
    expect(byDate(A).get("2026-12-31")?.closed).toBe("doctor");
    expect(byDate(B).get("2026-12-31")?.closed).toBeNull();
    expect(byDate("all").get("2026-12-10")?.closed).toBeNull();
  });
});

describe("the week time grid", () => {
  const appt = (id: string, time: string, endTime: string): ScheduleAppointment =>
    ({ visitId: id, name: `Synthetic ${id}`, time, endTime, minutes: 0 }) as unknown as ScheduleAppointment;
  const day = (date: string, over: Partial<Parameters<typeof buildWeekGrid>[2][number]> = {}) => ({ date, appointments: [], blocks: [], free: [], ...over });

  it("spans whole hours around the slots and appointments, with rows of the doctor's slot length", () => {
    const grid = buildWeekGrid(A, 15, [
      day("2026-12-07", { free: [{ doctorId: A, time: "09:15", minutes: 15 }] }),
      day("2026-12-08", { appointments: [appt("x", "16:40", "17:10")] }),
    ]);
    expect(grid).toMatchObject({ doctorId: A, slotMinutes: 15, startMinute: 9 * 60, endMinute: 18 * 60 });
    expect(grid.days[1]!.appointments[0]).toMatchObject({ start: 16 * 60 + 40, end: 17 * 60 + 10, lane: 0, lanes: 1 });
  });

  it("is a usual clinic day when the week has nothing to place, and never has rows shorter than 5 minutes", () => {
    expect(buildWeekGrid(A, 2, [day("2026-12-07")])).toMatchObject({ slotMinutes: 5, startMinute: 540, endMinute: 1080 });
  });

  it("puts overlapping appointments side by side and reuses a lane once it is free", () => {
    const grid = buildWeekGrid(A, 15, [
      day("2026-12-07", {
        appointments: [appt("a", "10:00", "10:30"), appt("b", "10:15", "10:30"), appt("c", "10:30", "10:45"), appt("d", "11:00", "11:15")],
      }),
    ]);
    const lanes = Object.fromEntries(grid.days[0]!.appointments.map((g) => [g.appointment.visitId, [g.lane, g.lanes]]));
    expect(lanes).toEqual({ a: [0, 2], b: [1, 2], c: [0, 1], d: [0, 1] });
  });

  it("judges overlap on the drawn block (one row at least): back-to-back short visits under a longer row sit side by side (review M-3)", () => {
    const grid = buildWeekGrid(A, 30, [day("2026-12-07", { appointments: [appt("s1", "10:00", "10:15"), appt("s2", "10:15", "10:30"), appt("s3", "10:30", "10:45")] })]);
    const lanes = Object.fromEntries(grid.days[0]!.appointments.map((g) => [g.appointment.visitId, [g.lane, g.lanes]]));
    expect(lanes).toEqual({ s1: [0, 2], s2: [1, 2], s3: [0, 2] });
  });

  it("clips blocks to the axis: an all-day block covers it, one that ended at the midnight the day began shows nothing", () => {
    const grid = buildWeekGrid(A, 15, [
      day("2026-12-07", {
        free: [{ doctorId: A, time: "10:00", minutes: 15 }],
        blocks: [
          { id: "all", doctorId: null, time: "00:00", endTime: "00:00", allDay: true, reason: null },
          { id: "lunch", doctorId: A, time: "10:30", endTime: "11:30", allDay: false, reason: "Synthetic lunch" },
          { id: "carry", doctorId: A, time: "00:00", endTime: "00:00", allDay: false, reason: null },
        ],
      }),
    ]);
    expect(grid.startMinute).toBe(600);
    expect(grid.days[0]!.blocks.map((b) => [b.block.id, b.start, b.end])).toEqual([
      ["all", 600, 660],
      ["lunch", 630, 660],
    ]);
  });

  it("is built from one week range for the chosen doctor, with that doctor's slot length, and only when the range carries slots", () => {
    const raw = {
      zone: "Asia/Kolkata",
      server_now: "2031-03-03T02:30:00Z",
      versions: { schedule: 1, queue: 1 },
      clinicians: [
        { id: A, full_name: "Synthetic A", specialty: null, slot_minutes: 20, schedule: {} },
        { id: B, full_name: "Synthetic B", specialty: null, slot_minutes: 15, schedule: {} },
      ],
      blocks: [],
      visits: [visit("w1", A, "2031-03-04T04:30:00Z", "booked", 20), visit("w2", B, "2031-03-04T04:30:00Z")],
      waitlist: [],
      slots: [{ doctor_id: A, date: "2031-03-05", slots: [[600, 20]] }],
    };
    const opts = { date: "2031-03-03", doctor: A, week: true, role: "receptionist" as const, userId: B, now: new Date("2031-03-03T02:30:00Z") };
    const data = buildScheduleData(parseScheduleRange(raw, "2031-03-03", "2031-03-09")!, opts);
    const grid = data.week!.grid!;
    expect(grid.slotMinutes).toBe(20);
    expect(grid.days.map((d) => d.date)).toEqual(["2031-03-03", "2031-03-04", "2031-03-05", "2031-03-06", "2031-03-07", "2031-03-08", "2031-03-09"]);
    expect(grid.days[1]!.appointments.map((a) => a.appointment.visitId)).toEqual(["w1"]);
    expect(grid.days[2]!.free.map((f) => f.slot.time)).toEqual(["10:00"]);
    const noSlots = { ...raw, slots: undefined };
    expect(buildScheduleData(parseScheduleRange(noSlots, "2031-03-03", "2031-03-09")!, opts).week!.grid).toBeNull();
    expect(buildScheduleData(parseScheduleRange(noSlots, "2031-03-03", "2031-03-09")!, { ...opts, week: false, month: true }).month).toHaveLength(42);
  });
});
