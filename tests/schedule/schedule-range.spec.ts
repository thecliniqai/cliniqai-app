/**
 * V2-09e 09E-12 (R-10): the Schedule's range read model on the device: the range a date reads, the adjacent ranges, the range check the route applies, the
 * parser of the SQL answer, and the builder that turns one range into what the day, agenda and week views show (the job `getSchedule` did with eight or more
 * calls). Pure; synthetic ids and names only. The slots are taken as the database gave them: the only device rule is hiding a slot that has started.
 */
import { describe, expect, it } from "vitest";
import {
  adjacentRanges,
  buildScheduleData,
  freeSlotsOf,
  isRangeOk,
  parseScheduleRange,
  rangeOfDate,
  rangeVersions,
  serverNowOf,
  type ScheduleRange,
} from "@/features/schedule/range";
import { queryKeys } from "@/lib/query/keys";

const OWNER = "00000000-0000-4000-8000-0000000000a1";
const DOC = "00000000-0000-4000-8000-0000000000a2";
const RECEPTION = "00000000-0000-4000-8000-0000000000a3";

// 2031-03-03 is a Monday.
const raw = {
  zone: "Asia/Kolkata",
  server_now: "2031-03-03T03:00:00Z", // 08:30 IST
  versions: { schedule: 7, queue: 3 },
  clinicians: [
    { id: OWNER, full_name: "Synthetic Owner", specialty: null, slot_minutes: 15, schedule: {} },
    { id: DOC, full_name: null, specialty: "pediatrics", slot_minutes: 15, schedule: {} },
  ],
  blocks: [
    { id: "b1", doctor_id: null, start_time: "2031-03-03T04:30:00Z", end_time: "2031-03-03T05:30:00Z", all_day: false, reason: "Synthetic meeting" },
    { id: "b2", doctor_id: DOC, start_time: "2031-03-04T18:30:00Z", end_time: "2031-03-05T18:30:00Z", all_day: true, reason: null },
  ],
  visits: [
    { id: "v1", patient_id: "p1", doctor_id: OWNER, status: "booked", scheduled_at: "2031-03-03T05:30:00Z", estimated_duration_minutes: 20, is_overbooked: false, signed_at: null, row_version: 4, clinic_confirmed: null, patient_confirmed: "true", patient_name: "Synthetic Patient One" },
    { id: "v2", patient_id: "p2", doctor_id: DOC, status: "no_show", scheduled_at: "2031-03-03T06:00:00Z", estimated_duration_minutes: null, is_overbooked: false, signed_at: null, row_version: 2, clinic_confirmed: null, patient_confirmed: null, patient_name: null },
    { id: "v3", patient_id: "p1", doctor_id: DOC, status: "booked", scheduled_at: "2031-03-04T19:00:00Z", estimated_duration_minutes: 15, is_overbooked: false, signed_at: null, row_version: 1, clinic_confirmed: null, patient_confirmed: null, patient_name: "Synthetic Patient One" },
  ],
  waitlist: [
    { id: "w1", target_date: "2031-03-03", doctor_id: null, priority: 2, time_window: "morning", created_at: "2031-03-01T00:00:00Z", patient_name: "Synthetic Waiting" },
    { id: "w2", target_date: "2031-03-04", doctor_id: OWNER, priority: 0, time_window: null, created_at: "2031-03-01T00:00:00Z", patient_name: "Synthetic Later" },
  ],
  slots: [
    { doctor_id: OWNER, date: "2031-03-03", slots: [[480, 15], [600, 15], [615, 15]] },
    { doctor_id: DOC, date: "2031-03-03", slots: [[600, 15]] },
    { doctor_id: OWNER, date: "2031-03-05", slots: [[600, 15], [615, 15]] },
  ],
};

const range = (over: Partial<typeof raw> = {}): ScheduleRange => parseScheduleRange({ ...raw, ...over }, "2031-03-03", "2031-03-09")!;
const NOW = new Date("2031-03-03T03:00:00Z");
const opts = { date: "2031-03-03", doctor: "all", week: false, role: "receptionist" as const, userId: RECEPTION, now: NOW };

describe("the range a view reads", () => {
  it("is the Monday-to-Sunday week that holds the date, and the weeks before and after are the adjacent ones", () => {
    expect(rangeOfDate("2031-03-03")).toEqual({ from: "2031-03-03", to: "2031-03-09" });
    expect(rangeOfDate("2031-03-09")).toEqual({ from: "2031-03-03", to: "2031-03-09" });
    expect(rangeOfDate("2031-03-10")).toEqual({ from: "2031-03-10", to: "2031-03-16" });
    expect(adjacentRanges({ from: "2031-03-03", to: "2031-03-09" })).toEqual([
      { from: "2031-02-24", to: "2031-03-02" },
      { from: "2031-03-10", to: "2031-03-16" },
    ]);
  });

  it("is checked as the route checks it: real dates, in order, at most 42 days", () => {
    expect(isRangeOk("2031-03-03", "2031-03-03")).toBe(true);
    expect(isRangeOk("2031-03-01", "2031-04-11")).toBe(true); // 42 days
    expect(isRangeOk("2031-03-01", "2031-04-12")).toBe(false); // 43
    expect(isRangeOk("2031-03-09", "2031-03-03")).toBe(false);
    expect(isRangeOk("2031-02-29", "2031-03-03")).toBe(false); // not a date
    expect(isRangeOk("2031-3-3", "2031-03-03")).toBe(false);
    expect(isRangeOk("", "")).toBe(false);
  });

  it("has a query key of the clinic, the two dates and the mode only", () => {
    expect(queryKeys.scheduleRange("t-a", "2031-03-03", "2031-03-09", true)).toEqual(["t-a", "schedule", "2031-03-03", "2031-03-09", "slots"]);
    expect(queryKeys.scheduleRange("t-a", "2031-03-03", "2031-03-09", false)).toEqual(["t-a", "schedule", "2031-03-03", "2031-03-09", "counts"]);
  });
});

describe("the SQL answer", () => {
  it("is parsed with the range it was asked for; a NULL or a wrong shape is no range", () => {
    expect(range().from).toBe("2031-03-03");
    expect(parseScheduleRange(null, "a", "b")).toBeNull();
    expect(parseScheduleRange({ ...raw, visits: null }, "a", "b")).toBeNull();
    expect(parseScheduleRange({ ...raw, slots: "x" }, "a", "b")).toBeNull();
    expect(parseScheduleRange({ ...raw, slots: undefined }, "a", "b")!.slots).toBeUndefined();
  });

  it("gives the live core its versions as the basis (schedule and queue), or none when one is missing", () => {
    expect(rangeVersions(range())).toEqual({ schedule: 7, queue: 3, billing: 0, settings: 0 });
    expect(rangeVersions(range({ versions: { schedule: 7, queue: null as unknown as number } }))).toBeNull();
  });
});

describe("buildScheduleData: one date of a range", () => {
  it("lists the date's visits with the card's fields, names the doctors as the directory does and keeps row_version", () => {
    const data = buildScheduleData(range(), opts);
    expect(data.timeZone).toBe("Asia/Kolkata");
    expect(data.today).toBe("2031-03-03");
    expect(data.doctors).toEqual([
      { id: OWNER, name: "Dr. Synthetic Owner", specialty: "general_physician" },
      { id: DOC, name: "Doctor (2)", specialty: "pediatrics" },
    ]);
    expect(data.appointments.map((a) => [a.visitId, a.time, a.endTime, a.minutes, a.name, a.doctorName, a.confirmed, a.rowVersion])).toEqual([
      ["v1", "11:00", "11:20", 20, "Synthetic Patient One", "Dr. Synthetic Owner", true, 4],
      ["v2", "11:30", "11:45", 15, "Patient", "Doctor (2)", false, 2],
    ]);
  });

  it("puts a visit on its clinic date, not its UTC date (19:00 UTC on the 4th is 00:30 IST on the 5th)", () => {
    expect(buildScheduleData(range(), { ...opts, date: "2031-03-04" }).appointments).toEqual([]);
    expect(buildScheduleData(range(), { ...opts, date: "2031-03-05" }).appointments.map((a) => [a.visitId, a.time])).toEqual([["v3", "00:30"]]);
  });

  it("shows the free slots the database gave, minus the ones that have started by the server-corrected clock", () => {
    const data = buildScheduleData(range(), opts);
    expect(data.free).toEqual([
      { doctorId: OWNER, time: "08:00", minutes: 15 },
      { doctorId: OWNER, time: "10:00", minutes: 15 },
      { doctorId: OWNER, time: "10:15", minutes: 15 },
      { doctorId: DOC, time: "10:00", minutes: 15 },
    ].filter((s) => s.time !== "08:00")); // 08:00 IST started before 08:30 IST
    const later = buildScheduleData(range(), { ...opts, now: new Date("2031-03-03T04:40:00Z") }); // 10:10 IST
    expect(later.free.map((s) => `${s.doctorId === OWNER ? "o" : "d"}${s.time}`)).toEqual(["o10:15"]);
  });

  it("filters by doctor: their visits, slots and blocks plus the clinic's; an unknown doctor is everyone", () => {
    const one = buildScheduleData(range(), { ...opts, doctor: DOC });
    expect(one.doctorFilter).toBe(DOC);
    expect(one.appointments.map((a) => a.visitId)).toEqual(["v2"]);
    expect(one.free.map((s) => s.doctorId)).toEqual([DOC]);
    expect(one.blocks.map((b) => b.id)).toEqual(["b1"]);
    expect(buildScheduleData(range(), { ...opts, doctor: "nobody" }).doctorFilter).toBe("all");
  });

  it("clips blocks to the day in clinic time; an all-day block is shown on its day only", () => {
    const monday = buildScheduleData(range(), opts);
    expect(monday.blocks).toEqual([{ id: "b1", doctorId: null, time: "10:00", endTime: "11:00", allDay: false, reason: "Synthetic meeting" }]);
    const wednesday = buildScheduleData(range(), { ...opts, date: "2031-03-05" });
    expect(wednesday.blocks.map((b) => [b.id, b.time, b.allDay])).toEqual([["b2", "00:00", true]]);
  });

  it("lists the date's waiting entries only", () => {
    expect(buildScheduleData(range(), opts).waitlist.map((w) => [w.id, w.patientName, w.doctorName])).toEqual([["w1", "Synthetic Waiting", null]]);
    expect(buildScheduleData(range(), { ...opts, date: "2031-03-04" }).waitlist.map((w) => [w.id, w.doctorName])).toEqual([["w2", "Dr. Synthetic Owner"]]);
  });

  it("counts the week of one doctor: booked (not missed) and free from the database's slots", () => {
    const week = buildScheduleData(range(), { ...opts, week: true, doctor: OWNER }).week!;
    expect(week.doctorId).toBe(OWNER);
    expect(week.days.map((d) => `${d.date.slice(8)}:${d.booked}/${d.free}`)).toEqual(["03:1/2", "04:0/0", "05:0/2", "06:0/0", "07:0/0", "08:0/0", "09:0/0"]);
    const doc = buildScheduleData(range(), { ...opts, week: true, doctor: DOC }).week!;
    expect(doc.days.slice(0, 3).map((d) => d.booked)).toEqual([0, 0, 1]); // v2 is a no-show (not counted); v3 is on the 5th
  });

  it("gives each role what it may do, as the server's read did (edit, block: a doctor blocks their own column only)", () => {
    expect(buildScheduleData(range(), opts)).toMatchObject({ canEdit: true, block: { allowed: false, doctorId: null } });
    expect(buildScheduleData(range(), { ...opts, role: "doctor", userId: DOC })).toMatchObject({ canEdit: true, block: { allowed: true, doctorId: DOC } });
    expect(buildScheduleData(range(), { ...opts, role: "owner", userId: OWNER })).toMatchObject({ canEdit: true, block: { allowed: true, doctorId: null } });
    expect(buildScheduleData(range(), { ...opts, role: "nurse", userId: RECEPTION })).toMatchObject({ canEdit: true, block: { allowed: false, doctorId: null } });
  });

  it("names a missing (doctor, date) as no slots", () => {
    expect(freeSlotsOf(range(), DOC, "2031-03-06", "Asia/Kolkata", NOW)).toEqual([]);
    expect(freeSlotsOf(range({ slots: undefined }), OWNER, "2031-03-03", "Asia/Kolkata", NOW)).toEqual([]);
  });
});

describe("the server-corrected clock", () => {
  it("keeps the offset between the device and the server taken when the range was first seen", () => {
    const r = range();
    const device = Date.parse("2031-03-03T02:59:00Z"); // the device is a minute slow
    expect(serverNowOf(r, device).toISOString()).toBe("2031-03-03T03:00:00.000Z");
    expect(serverNowOf(r, device + 60_000).toISOString()).toBe("2031-03-03T03:01:00.000Z");
  });
});
