/**
 * V2-08 08-03b: Today's modes and row buttons. The buttons come only from the state machine (`rowActions` for the caller's
 * role), arranged by the mode; the unit checks run the real permission matrix, so a role can never be offered an action the
 * database would refuse (R-7).
 */
import { describe, expect, it } from "vitest";
import {
  groupIntoLanes,
  lanesOf,
  modesOf,
  nextUp,
  resolveMode,
  rowButtons,
  type RowButton,
  type TodayRow,
} from "@/features/today/schema";
import { rowActions } from "@/features/visits/state-machine";
import { hasPerm, ROLE_PERMISSIONS } from "@/lib/permissions";
import { readingToVitalsInput } from "@/features/visits/vitals-input";
import { recordVitalsInputSchema } from "@/features/consultation/schema";
import { toVitalsReading } from "@/features/today/queries";
import { toCheckoutTarget } from "@/components/today/checkout-target";
import { registerHref, splitTypedQuery } from "@/components/front-desk/patient-search";
import type { UserRole, VisitStatus } from "@/lib/db/types";

const NOW = new Date("2026-11-13T06:00:00.000Z"); // 11:30 IST
const TODAY_SLOT = "2026-11-13T04:30:00.000Z"; // 10:00 IST, passed
const ROLES: UserRole[] = ["owner", "admin", "doctor", "receptionist", "nurse"];
const STATUSES: VisitStatus[] = ["booked", "confirmed", "waiting", "in_consultation", "completed", "cancelled", "no_show"];

function buttons(role: UserRole, status: VisitStatus, mode: "front" | "triage" | "doctor"): RowButton["kind"][] {
  const actions = rowActions(ROLE_PERMISSIONS[role], { status, scheduledAt: status === "waiting" ? null : TODAY_SLOT }, NOW);
  return rowButtons(mode, { status, actions }, hasPerm(role, "consultations:edit")).map((b) => b.kind);
}

function row(over: Partial<TodayRow>): TodayRow {
  return {
    visitId: "v1",
    patientId: "p1",
    name: "Meena Pawar",
    age: "38 y",
    sex: "F",
    phone: "+919000000101",
    status: "waiting",
    signed: false,
    token: 3,
    priority: null,
    time: null,
    origin: "walk_in",
    overbooked: false,
    doctorId: "d1",
    doctorName: "Dr A Rao",
    arrivedAt: "10:00",
    waitMinutes: 5,
    hasAllergy: null,
    vitals: null,
    vitalsPending: false,
    balanceDue: null,
    billed: null,
    actions: [],
    ...over,
  };
}

describe("modes by role (R-14)", () => {
  it("the doctor has the doctor's queue, the nurse triage, the owner toggles front and doctor, the desk has the front", () => {
    expect(modesOf("doctor")).toEqual(["doctor"]);
    expect(modesOf("nurse")).toEqual(["triage"]);
    expect(modesOf("owner")).toEqual(["front", "doctor"]);
    expect(modesOf("receptionist")).toEqual(["front"]);
    expect(modesOf("admin")).toEqual(["front"]);
  });

  it("?mode= is honoured only when the role may use it; otherwise the role's default", () => {
    expect(resolveMode("owner", "doctor")).toBe("doctor");
    expect(resolveMode("owner", undefined)).toBe("front");
    expect(resolveMode("owner", "triage")).toBe("front");
    expect(resolveMode("receptionist", "doctor")).toBe("front");
    expect(resolveMode("doctor", "front")).toBe("doctor");
    expect(resolveMode("nurse", "doctor")).toBe("triage");
    expect(resolveMode("nurse", null)).toBe("triage");
  });
});

describe("row buttons come from the state machine, per mode", () => {
  it("front desk: Check in for a booking of today, Collect on a completed visit (billing:collect), never a consult action", () => {
    expect(buttons("receptionist", "booked", "front")).toEqual(["check_in"]);
    expect(buttons("receptionist", "waiting", "front")).toEqual([]);
    expect(buttons("receptionist", "completed", "front")).toEqual(["collect"]);
    expect(buttons("admin", "completed", "front")).toEqual(["collect"]);
    expect(buttons("owner", "booked", "front")).toEqual(["check_in"]);
    for (const status of STATUSES) {
      expect(buttons("receptionist", status, "front")).not.toContain("start");
      expect(buttons("receptionist", status, "front")).not.toContain("open_consult");
    }
  });

  it("triage: Record vitals first for a waiting visit, then Check in; no collect", () => {
    expect(buttons("nurse", "waiting", "triage")).toEqual(["record_vitals"]);
    expect(buttons("nurse", "booked", "triage")).toEqual(["check_in"]);
    expect(buttons("nurse", "completed", "triage")).toEqual([]);
    const primary = rowButtons("triage", { status: "waiting", actions: ["record_vitals"] }, false);
    expect(primary).toEqual([{ kind: "record_vitals", primary: true }]);
  });

  it("doctor: Call in a waiting patient (start), Start consultation from a booking, Open consult when with the doctor, vitals as a secondary", () => {
    expect(buttons("doctor", "waiting", "doctor")).toEqual(["start", "record_vitals"]);
    expect(buttons("doctor", "booked", "doctor")).toEqual(["start"]);
    expect(buttons("doctor", "no_show", "doctor")).toEqual(["start"]);
    expect(buttons("doctor", "in_consultation", "doctor")).toEqual(["open_consult", "record_vitals"]);
    expect(buttons("doctor", "completed", "doctor")).toEqual([]);
    expect(buttons("doctor", "cancelled", "doctor")).toEqual([]);
    expect(rowButtons("doctor", { status: "waiting", actions: ["start", "record_vitals"] }, true)[0]).toEqual({ kind: "start", primary: true });
  });

  it("only a role that may consult is offered a consult action, in any mode", () => {
    for (const role of ROLES) {
      for (const status of STATUSES) {
        for (const mode of ["front", "triage", "doctor"] as const) {
          const kinds = buttons(role, status, mode);
          if (!hasPerm(role, "consultations:edit")) {
            expect(kinds, `${role} ${status} ${mode}`).not.toContain("start");
            expect(kinds, `${role} ${status} ${mode}`).not.toContain("open_consult");
          }
        }
      }
    }
  });

  it("never a button the state machine did not list", () => {
    for (const role of ROLES) {
      for (const status of STATUSES) {
        const listed = rowActions(ROLE_PERMISSIONS[role], { status, scheduledAt: TODAY_SLOT }, NOW);
        for (const mode of ["front", "triage", "doctor"] as const) {
          for (const kind of buttons(role, status, mode)) {
            if (kind === "open_consult") continue;
            expect(listed, `${role} ${status} ${mode} ${kind}`).toContain(kind);
          }
        }
      }
    }
  });
});

describe("the doctor's lanes", () => {
  it("fold To bill into Seen today and say Waiting (mine) and With me; the other modes keep five lanes", () => {
    expect(lanesOf("front").map((l) => l.id)).toEqual(["booked", "waiting", "with_doctor", "to_bill", "done"]);
    expect(lanesOf("doctor").map((l) => [l.id, l.label])).toEqual([
      ["booked", "Booked"],
      ["waiting", "Waiting (mine)"],
      ["with_doctor", "With me"],
      ["done", "Seen today"],
    ]);
    const lanes = groupIntoLanes([row({ visitId: "a", status: "completed", balanceDue: 100 })], "doctor");
    expect(lanes.to_bill).toEqual([]);
    expect(lanes.done.map((r) => r.visitId)).toEqual(["a"]);
    expect(groupIntoLanes([row({ visitId: "a", status: "completed", balanceDue: 100 })], "front").to_bill).toHaveLength(1);
  });

  it("triage lists waiting patients with vitals still to take first; the next patient is the first waiting", () => {
    const rows = [
      row({ visitId: "taken", token: 1, vitalsPending: false }),
      row({ visitId: "pending", token: 2, vitalsPending: true }),
    ];
    expect(groupIntoLanes(rows, "triage").waiting.map((r) => r.visitId)).toEqual(["pending", "taken"]);
    expect(groupIntoLanes(rows, "front").waiting.map((r) => r.visitId)).toEqual(["taken", "pending"]);
    expect(nextUp(groupIntoLanes(rows, "doctor"))?.visitId).toBe("taken");
    expect(nextUp(groupIntoLanes([], "doctor"))).toBeNull();
  });
});

describe("triage vitals are stored in the shape the consult and Today read", () => {
  it("maps the form's reading to the recorded shape and back", () => {
    const input = readingToVitalsInput({
      systolic: 128,
      diastolic: 84,
      pulse: 76,
      temperatureF: 99.1,
      spo2: 98,
      respRate: 16,
      weight: 70,
      height: 172,
      sugar: 110,
      sugarType: "fasting",
    });
    const parsed = recordVitalsInputSchema.safeParse(input);
    expect(parsed.success).toBe(true);
    expect(input).toMatchObject({ temperature: 99.1, respiratory_rate: 16, sugar: 110, sugar_type: "fasting" });
    expect(toVitalsReading(parsed.success ? parsed.data : null)).toMatchObject({
      systolic: 128,
      diastolic: 84,
      temperatureF: 99.1,
      respRate: 16,
      sugar: 110,
      sugarType: "fasting",
    });
  });

  it("an empty field is null, and a sugar value without a type is stored as random", () => {
    expect(readingToVitalsInput({ systolic: 120, diastolic: 80 })).toMatchObject({ pulse: null, temperature: null, sugar: null, sugar_type: null });
    expect(readingToVitalsInput({ sugar: 90 }).sugar_type).toBe("random");
  });
});

describe("Collect opens the checkout drawer for the row's visit", () => {
  it("builds the drawer's visit from a Today row", () => {
    const target = toCheckoutTarget(row({ visitId: "v9", patientId: "p9", status: "completed", token: 7, age: "42 y", sex: "M" }));
    expect(target).toEqual({
      visit: { id: "v9", status: "completed" },
      patient: { id: "p9", full_name: "Meena Pawar", sex: "male", age: 42, phone: "+919000000101" },
      queueToken: { token_number: 7 },
      doctorName: "Dr A Rao",
    });
    expect(toCheckoutTarget(row({ age: "8 m", sex: null, token: null })).patient.age).toBeNull();
    expect(toCheckoutTarget(row({ token: null })).queueToken).toBeNull();
  });
});

describe("what the walk-in search box held becomes the register form's fields", () => {
  it("digits are the mobile number (the last ten), anything else is the name; the register link carries only that", () => {
    expect(splitTypedQuery("98765 43210")).toEqual({ phone: "9876543210" });
    expect(splitTypedQuery("+91 98765-43210")).toEqual({ phone: "9876543210" });
    expect(splitTypedQuery("Meena Pawar")).toEqual({ name: "Meena Pawar" });
    expect(splitTypedQuery("  ")).toEqual({});
    expect(splitTypedQuery("ab")).toEqual({ name: "ab" });
    expect(splitTypedQuery("x".repeat(300)).name).toHaveLength(120);
    expect(registerHref("98765 43210", "/today")).toBe("/today?new=1&phone=9876543210");
    expect(registerHref("Meena", "/today")).toBe("/today?new=1&name=Meena");
    expect(registerHref("")).toBe("/patients?new=1");
  });
});
