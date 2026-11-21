import { describe, expect, it } from "vitest";
import {
  columnEntries,
  isScheduleView,
  scheduleHref,
  sortAgenda,
  weekStart,
  type FreeSlot,
  type ScheduleAppointment,
  type ScheduleBlockView,
} from "@/features/schedule/schema";
import { rowMenuItems } from "@/components/front-desk/row-menu";
import { rowActions } from "@/features/visits/state-machine";
import { ROLE_PERMISSIONS } from "@/lib/permissions";

const appt = (over: Partial<ScheduleAppointment>): ScheduleAppointment => ({
  visitId: "v",
  patientId: "p",
  name: "Synthetic Patient",
  doctorId: "d1",
  doctorName: "Dr. One",
  time: "10:00",
  endTime: "10:15",
  minutes: 15,
  status: "booked",
  overbooked: false,
  confirmed: false,
  actions: [],
  canConfirm: false,
  ...over,
});
const free = (doctorId: string, ...times: string[]): FreeSlot[] => times.map((time) => ({ doctorId, time, minutes: 15 }));
const block = (over: Partial<ScheduleBlockView>): ScheduleBlockView => ({ id: "b", doctorId: "d1", time: "11:00", endTime: "12:00", allDay: false, reason: null, ...over });

describe("columnEntries (the doctor's day, chronological)", () => {
  it("merges appointments, blocks and runs of free slots; a busy entry cuts a run", () => {
    const entries = columnEntries("d1", {
      appointments: [appt({ visitId: "a", time: "10:30" }), appt({ visitId: "other", doctorId: "d2", time: "10:00" })],
      blocks: [block({ time: "11:15", endTime: "11:45" })],
      free: [...free("d1", "10:00", "10:15", "10:45", "11:00", "12:00"), ...free("d2", "09:00")],
    });
    expect(entries.map((e) => `${e.kind}@${e.time}`)).toEqual(["free@10:00", "appointment@10:30", "free@10:45", "block@11:15", "free@12:00"]);
    expect(entries[0]).toMatchObject({ kind: "free", slots: [{ time: "10:00" }, { time: "10:15" }] });
    expect(entries[2]).toMatchObject({ kind: "free", slots: [{ time: "10:45" }, { time: "11:00" }] });
  });

  it("shows another doctor's block never, and the clinic's block always; an all-day block comes first", () => {
    const entries = columnEntries("d1", {
      appointments: [appt({ time: "09:00" })],
      blocks: [block({ id: "mine", doctorId: "d2" }), block({ id: "clinic", doctorId: null, allDay: true, time: "00:00", endTime: "00:00" })],
      free: [],
    });
    expect(entries.map((e) => (e.kind === "block" ? e.block.id : e.kind))).toEqual(["clinic", "appointment"]);
  });

  it("an empty day is an empty column", () => {
    expect(columnEntries("d1", { appointments: [], blocks: [], free: [] })).toEqual([]);
  });
});

describe("weekStart, views and addresses", () => {
  it("the week starts on Monday (a Sunday belongs to the week before it)", () => {
    expect(weekStart("2026-11-23")).toBe("2026-11-23"); // Monday
    expect(weekStart("2026-11-26")).toBe("2026-11-23"); // Thursday
    expect(weekStart("2026-11-29")).toBe("2026-11-23"); // Sunday
  });

  it("knows its views and builds short addresses", () => {
    expect(isScheduleView("week")).toBe(true);
    expect(isScheduleView("month")).toBe(false);
    expect(scheduleHref({ date: "2026-11-23", today: "2026-11-23" })).toBe("/schedule");
    expect(scheduleHref({ date: "2026-11-24", view: "week", doctor: "abc", today: "2026-11-23" })).toBe("/schedule?date=2026-11-24&view=week&doctor=abc");
    expect(scheduleHref({ date: "2026-11-24", doctor: "all", today: "2026-11-23" })).toBe("/schedule?date=2026-11-24");
  });

  it("the agenda lists by time, then doctor", () => {
    const list = sortAgenda([appt({ visitId: "b", time: "10:15" }), appt({ visitId: "a", time: "10:00", doctorName: "Dr. Two" }), appt({ visitId: "c", time: "10:00", doctorName: "Dr. One" })]);
    expect(list.map((a) => a.visitId)).toEqual(["c", "a", "b"]);
  });
});

describe("the row menu offers what the state machine lists", () => {
  const now = new Date("2026-11-23T08:00:00Z");
  it("a receptionist moves and cancels a booked visit of today, and may mark a missed one", () => {
    const perms = ROLE_PERMISSIONS.receptionist;
    expect(rowMenuItems(rowActions(perms, { status: "booked", scheduledAt: "2026-11-23T09:00:00Z" }, now))).toEqual(["reschedule", "cancel"]);
    expect(rowMenuItems(rowActions(perms, { status: "booked", scheduledAt: "2026-11-23T05:00:00Z" }, now))).toEqual(["reschedule", "no_show", "cancel"]);
    expect(rowMenuItems(rowActions(perms, { status: "no_show", scheduledAt: "2026-11-23T05:00:00Z" }, now))).toEqual(["reschedule"]);
    expect(rowMenuItems(rowActions(perms, { status: "in_consultation", scheduledAt: "2026-11-23T05:00:00Z" }, now))).toEqual([]);
  });

  it("a role without appointments:edit gets no menu", () => {
    expect(rowMenuItems(rowActions([], { status: "booked", scheduledAt: "2026-11-23T09:00:00Z" }, now))).toEqual([]);
  });
});
