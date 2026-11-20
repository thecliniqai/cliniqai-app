/**
 * V2-08 08-01b (R-7): the visit state machine is written twice. `features/visits/state-machine.ts` drives which buttons a
 * row shows; `private.visit_transition_allowed` plus the `visits_status_transition_guard` trigger (migration 000100) are the
 * guarantee. This spec compares the two over every status x status x signed combination, then checks what a row offers.
 * Synthetic data only.
 */
import { describe, expect, it } from "vitest";
import { psql } from "../helpers/sql";
import { canTransition, rowActions, VISIT_STATUSES, VISIT_TRANSITIONS } from "@/features/visits/state-machine";
import { ROLE_PERMISSIONS } from "@/lib/permissions";

describe("state machine parity: TypeScript table = database function", () => {
  it("canTransition equals private.visit_transition_allowed for all 7 x 7 x signed combinations", () => {
    const rows = psql(
      `select f.s || ',' || t.s || ',' || sg::text || ',' || private.visit_transition_allowed(f.s, t.s, sg)::text ` +
        `from unnest(array['booked','confirmed','waiting','in_consultation','completed','cancelled','no_show']) f(s) ` +
        `cross join unnest(array['booked','confirmed','waiting','in_consultation','completed','cancelled','no_show']) t(s) ` +
        `cross join (values (false), (true)) b(sg)`
    );
    expect(rows).toHaveLength(98);
    const mismatches = rows.filter((row) => {
      const [from, to, signed, db] = row.split(",");
      return canTransition(from as never, to as never, signed === "true") !== (db === "t" || db === "true");
    });
    expect(mismatches).toEqual([]);
  });

  it("lists every status once and nothing leaves cancelled; completed leaves only through the signed reopen", () => {
    expect([...VISIT_STATUSES].sort()).toEqual(Object.keys(VISIT_TRANSITIONS).sort());
    expect(VISIT_TRANSITIONS.cancelled).toEqual([]);
    expect(canTransition("completed", "in_consultation")).toBe(false);
    expect(canTransition("completed", "in_consultation", true)).toBe(true);
    expect(canTransition("in_consultation", "cancelled")).toBe(false);
    expect(canTransition("no_show", "waiting")).toBe(true);
  });
});

describe("rowActions: what a row offers", () => {
  // 2026-11-21 10:00 IST (04:30 UTC)
  const now = new Date("2026-11-21T04:30:00Z");
  const today = (hhmm: string) => `2026-11-21T${hhmm}:00+05:30`;
  const perms = (role: keyof typeof ROLE_PERMISSIONS) => ROLE_PERMISSIONS[role];

  it("the receptionist checks in, reschedules and cancels a booking of today; no-show only once its time has passed", () => {
    expect(rowActions(perms("receptionist"), { status: "booked", scheduledAt: today("11:00") }, now)).toEqual(["check_in", "reschedule", "cancel"]);
    expect(rowActions(perms("receptionist"), { status: "confirmed", scheduledAt: today("09:00") }, now)).toEqual([
      "check_in",
      "reschedule",
      "no_show",
      "cancel",
    ]);
  });

  it("a booking of another day cannot be checked in or started (R-8) but can be rescheduled or cancelled", () => {
    expect(rowActions(perms("owner"), { status: "booked", scheduledAt: "2026-11-22T10:00:00+05:30" }, now)).toEqual(["reschedule", "cancel"]);
  });

  it("the day boundary is the clinic's zone, not UTC: 00:30 IST on the 21st is today at 20:00 UTC on the 20th", () => {
    const earlyNow = new Date("2026-11-20T20:00:00Z"); // 01:30 IST on the 21st
    expect(rowActions(perms("receptionist"), { status: "booked", scheduledAt: "2026-11-21T00:30:00+05:30" }, earlyNow)).toContain("check_in");
  });

  it("a no-show that arrives late can be checked in; a walk-in has no day to miss", () => {
    expect(rowActions(perms("receptionist"), { status: "no_show", scheduledAt: today("08:00") }, now)).toEqual(["check_in", "reschedule"]);
    expect(rowActions(perms("receptionist"), { status: "waiting", scheduledAt: null }, now)).toEqual(["cancel"]);
  });

  it("only owner and doctor start a consultation; the nurse records vitals of a waiting visit", () => {
    const waiting = { status: "waiting", scheduledAt: null } as const;
    expect(rowActions(perms("doctor"), waiting, now)).toEqual(["start", "record_vitals", "cancel"]);
    expect(rowActions(perms("nurse"), waiting, now)).toEqual(["record_vitals", "cancel"]);
    expect(rowActions(perms("receptionist"), waiting, now)).not.toContain("start");
  });

  it("a visit in consultation offers no cancel; a completed one offers collect to billing roles only", () => {
    expect(rowActions(perms("doctor"), { status: "in_consultation", scheduledAt: null }, now)).toEqual(["record_vitals"]);
    expect(rowActions(perms("receptionist"), { status: "completed", scheduledAt: null }, now)).toEqual(["collect"]);
    expect(rowActions(perms("doctor"), { status: "completed", scheduledAt: null }, now)).toEqual([]);
    expect(rowActions(perms("owner"), { status: "cancelled", scheduledAt: today("09:00") }, now)).toEqual([]);
  });
});
