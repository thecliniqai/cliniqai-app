/**
 * V2-09e 09E-08 (R-11): the board's own writes. A reversible move shows at once (`withPendingCheckIns`: Waiting for a check-in, With doctor for a start) and
 * is taken back by dropping it; a command's answer is written into the board (`withCheckedIn`, `withStatus`, `withVitals`) with the version it returned.
 * The next live read replaces any of these with the database's row.
 */
import { describe, expect, it } from "vitest";
import { groupIntoLanes, withCheckedIn, withPendingCheckIns, withStatus, withVitals, type TodayBoard, type TodayRow } from "@/features/today/schema";

function row(over: Partial<TodayRow>): TodayRow {
  return {
    visitId: "v1",
    patientId: "p1",
    name: "Meena Pawar",
    age: "38 y",
    sex: "F",
    phone: "+919000000101",
    status: "booked",
    signed: false,
    token: null,
    priority: null,
    time: "10:30",
    origin: "scheduled",
    overbooked: false,
    doctorId: "d1",
    doctorName: "Dr A Rao",
    arrivedAt: null,
    waitMinutes: null,
    hasAllergy: null,
    vitals: null,
    vitalsPending: true,
    balanceDue: null,
    billed: null,
    followUp: null,
    rowVersion: 4,
    invoiceVersion: null,
    actions: ["check_in", "start", "record_vitals", "reschedule", "no_show", "cancel"],
    ...over,
  };
}
const board = (rows: TodayRow[]): TodayBoard => ({ rows, generatedAt: "2026-11-25T05:00:00.000Z", today: "2026-11-25", timeZone: "Asia/Kolkata" });

describe("a reversible move on the board", () => {
  it("a check-in shows Waiting at once, with the actions that no longer apply gone, and is taken back by dropping it", () => {
    const rows = [row({})];
    const moved = withPendingCheckIns(rows, [{ visitId: "v1", from: "booked" }]);
    expect(moved[0]).toMatchObject({ status: "waiting", waitMinutes: 0 });
    expect(moved[0]!.actions).toEqual(["start", "record_vitals", "cancel"]);
    expect(groupIntoLanes(moved).waiting.map((r) => r.visitId)).toEqual(["v1"]);
    // Rolled back: no pending entry, the rows are the board's own again (same objects).
    expect(withPendingCheckIns(rows, [])).toBe(rows);
  });

  it("a start shows With doctor at once and keeps only the vitals action", () => {
    const moved = withPendingCheckIns([row({ status: "waiting", actions: ["start", "record_vitals", "cancel"] })], [{ visitId: "v1", from: "waiting", to: "in_consultation" }]);
    expect(moved[0]).toMatchObject({ status: "in_consultation", waitMinutes: null });
    expect(moved[0]!.actions).toEqual(["record_vitals"]);
    expect(groupIntoLanes(moved).with_doctor).toHaveLength(1);
  });

  it("a row the server has already moved is left as the server has it (the overlay applies only while the status is the one the move started from)", () => {
    const moved = withPendingCheckIns([row({ status: "waiting", token: 7 })], [{ visitId: "v1", from: "booked" }]);
    expect(moved[0]).toMatchObject({ status: "waiting", token: 7, waitMinutes: null });
  });
});

describe("a command's answer written into the board", () => {
  it("a check-in's answer: Waiting, the token the command issued, its arrival time and the version it returned", () => {
    const next = withCheckedIn(board([row({}), row({ visitId: "v2" })]), "v1", { tokenNumber: 12, rowVersion: 5 }, "10:41");
    expect(next.rows[0]).toMatchObject({ status: "waiting", token: 12, arrivedAt: "10:41", waitMinutes: 0, rowVersion: 5 });
    expect(next.rows[0]!.actions).not.toContain("check_in");
    expect(next.rows[1]).toMatchObject({ status: "booked", rowVersion: 4 });
  });

  it("a check-in's answer for a row that is already Waiting (a signal got there first) changes nothing", () => {
    const b = board([row({ status: "waiting", token: 3, rowVersion: 6 })]);
    expect(withCheckedIn(b, "v1", { tokenNumber: 3, rowVersion: 5 }, "10:41")).toBe(b);
  });

  it("cancel and no-show: the status, the version, and only the actions that still make sense", () => {
    const cancelled = withStatus(board([row({})]), "v1", "cancelled", 9);
    expect(cancelled.rows[0]).toMatchObject({ status: "cancelled", rowVersion: 9, actions: [] });
    const missed = withStatus(board([row({})]), "v1", "no_show", 9);
    expect(missed.rows[0]).toMatchObject({ status: "no_show", rowVersion: 9 });
    expect(missed.rows[0]!.actions).toEqual(["check_in", "start", "record_vitals", "reschedule", "cancel"]);
    const unknown = board([row({})]);
    expect(withStatus(unknown, "nope", "cancelled")).toBe(unknown);
  });

  it("vitals: the readings the database holds, only on a row of a role that reads them", () => {
    const reading = { systolic: 120, diastolic: 80, pulse: 72 };
    const next = withVitals(board([row({})]), "v1", reading);
    expect(next.rows[0]).toMatchObject({ vitals: reading, vitalsPending: false });
    const blind = board([row({ vitals: null, vitalsPending: false })]);
    expect(withVitals(blind, "v1", reading)).toBe(blind);
  });
});
