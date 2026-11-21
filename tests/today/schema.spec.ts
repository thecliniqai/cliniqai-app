/**
 * V2-08 08-03a: the pure rules of the Today board: which lane a visit is in, the order inside a lane, the filter box, the
 * optimistic check-in and the ticking wait.
 */
import { describe, expect, it } from "vitest";
import {
  formatRupees,
  groupIntoLanes,
  laneOf,
  matchesQuery,
  TODAY_LANES,
  TODAY_LANE_IDS,
  waitNow,
  withPendingCheckIns,
  type TodayRow,
} from "@/features/today/schema";

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
    vitalsPending: false,
    balanceDue: null,
    billed: null,
    followUp: null,
    actions: ["check_in", "start", "reschedule", "no_show", "cancel"],
    ...over,
  };
}

describe("lanes", () => {
  it("has the five lanes with the contract's empty copy", () => {
    expect(TODAY_LANES.map((l) => l.empty)).toEqual([
      "No more appointments today",
      "Nobody waiting",
      "No one with a doctor",
      "Nothing to collect",
      "No finished visits yet",
    ]);
    expect(TODAY_LANE_IDS).toEqual(TODAY_LANES.map((l) => l.id));
  });

  it("puts every status in its lane; a completed visit is To bill only with money due", () => {
    expect(laneOf({ status: "booked", balanceDue: null })).toBe("booked");
    expect(laneOf({ status: "confirmed", balanceDue: null })).toBe("booked");
    expect(laneOf({ status: "waiting", balanceDue: null })).toBe("waiting");
    expect(laneOf({ status: "in_consultation", balanceDue: null })).toBe("with_doctor");
    expect(laneOf({ status: "completed", balanceDue: 70 })).toBe("to_bill");
    expect(laneOf({ status: "completed", balanceDue: 0 })).toBe("done");
    expect(laneOf({ status: "completed", balanceDue: null })).toBe("done");
    expect(laneOf({ status: "no_show", balanceDue: null })).toBe("done");
    expect(laneOf({ status: "cancelled", balanceDue: null })).toBe("done");
  });

  it("orders booked by time, waiting by priority then token, done newest token first", () => {
    const rows = [
      row({ visitId: "b2", name: "B", time: "11:00" }),
      row({ visitId: "b1", name: "A", time: "10:30" }),
      row({ visitId: "w3", status: "waiting", token: 3, priority: "normal" }),
      row({ visitId: "w5", status: "waiting", token: 5, priority: "urgent" }),
      row({ visitId: "w4", status: "waiting", token: 4, priority: "vip" }),
      row({ visitId: "d1", status: "completed", token: 1 }),
      row({ visitId: "d2", status: "completed", token: 2 }),
    ];
    const lanes = groupIntoLanes(rows);
    expect(lanes.booked.map((r) => r.visitId)).toEqual(["b1", "b2"]);
    expect(lanes.waiting.map((r) => r.visitId)).toEqual(["w5", "w4", "w3"]);
    expect(lanes.done.map((r) => r.visitId)).toEqual(["d2", "d1"]);
  });
});

describe("the filter box", () => {
  const r = row({ token: 14, name: "Ramesh Kumar", phone: "+919876543210" });
  it("matches a token of up to three digits exactly (not a fragment of it)", () => {
    expect(matchesQuery(r, "14")).toBe(true);
    expect(matchesQuery(r, "1")).toBe(false);
  });
  it("matches a mobile fragment of four or more digits", () => {
    expect(matchesQuery(r, "9876")).toBe(true);
    expect(matchesQuery(r, "98765 43210")).toBe(true);
    expect(matchesQuery(r, "+91 98765 43210")).toBe(true);
    expect(matchesQuery(r, "1111")).toBe(false);
  });
  it("matches every word of the query against the name, in any order, ignoring case", () => {
    expect(matchesQuery(r, "kumar ram")).toBe(true);
    expect(matchesQuery(r, "RAMESH")).toBe(true);
    expect(matchesQuery(r, "ramesh patil")).toBe(false);
  });
  it("an empty query matches everything", () => {
    expect(matchesQuery(r, "   ")).toBe(true);
  });
});

describe("the optimistic check-in", () => {
  it("moves a row that the server still has as booked, and only while it does", () => {
    const booked = row({ visitId: "v1" });
    const [moved] = withPendingCheckIns([booked], [{ visitId: "v1", from: "booked" }]);
    expect(moved.status).toBe("waiting");
    expect(moved.actions).toEqual(["start", "cancel"]);
    expect(laneOf(moved)).toBe("waiting");
    // The server caught up (it is waiting now) or the row changed otherwise: the override is not applied.
    expect(withPendingCheckIns([{ ...booked, status: "waiting" }], [{ visitId: "v1", from: "booked" }])[0].token).toBeNull();
    expect(withPendingCheckIns([{ ...booked, status: "confirmed" }], [{ visitId: "v1", from: "booked" }])[0].status).toBe("confirmed");
    // A rolled-back check-in (no entry) leaves the row alone.
    expect(withPendingCheckIns([booked], [])[0]).toBe(booked);
  });
});

describe("the wait", () => {
  it("adds the whole minutes since the board was received; null when not waiting", () => {
    expect(waitNow({ waitMinutes: 12 }, 1_000_000, 1_000_000 + 59_000)).toBe(12);
    expect(waitNow({ waitMinutes: 12 }, 1_000_000, 1_000_000 + 61_000)).toBe(13);
    expect(waitNow({ waitMinutes: 12 }, 1_000_000, 500)).toBe(12);
    expect(waitNow({ waitMinutes: null }, 0, 10 * 60_000)).toBeNull();
  });
});

describe("money", () => {
  it("formats rupees the Indian way", () => {
    expect(formatRupees(1250)).toBe("₹1,250");
    expect(formatRupees(125000)).toBe("₹1,25,000");
    expect(formatRupees(70.5)).toBe("₹70.5");
  });
});
