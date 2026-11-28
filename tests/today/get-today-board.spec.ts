/**
 * V2-08 08-03a (R-10, M4.2): `getTodayBoard`, Today's read model, over the real database with each role's own client.
 *
 * - the projection: exactly the keys of `TODAY_ROW_KEYS`, no address, ABHA, allergy names or full clinical note;
 * - role differences (RLS and the plan): allergy flag only for `vitals:view` or `consultations:view`; vitals and "Vitals
 *   pending" only where `clinical_notes` is readable; balance due (and so To bill) only with `billing:view`;
 * - the clinic day is the clinic's own: a visit created at 00:10 IST belongs to that IST date, a booking to the day of its
 *   appointment; yesterday's and another clinic's visits are not listed;
 * - to_bill, wait minutes, priority, doctor filter, row actions from the state machine. Synthetic data only.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { getTodayBoard } from "@/features/today/queries";
import { TODAY_ROW_KEYS, groupIntoLanes, laneOf, type TodayRow } from "@/features/today/schema";
import { addDaysYmd, todayInTz, zonedDateTimeToUtcIso } from "@/lib/datetime";
import type { UserRole } from "@/lib/db/types";
import { hasPerm } from "@/lib/permissions";
import { ctxFor } from "../helpers/context";
import { getAdminClient } from "../helpers/supabase-admin";
import { insertReturningId } from "../helpers/db";
import { seedVisit } from "../helpers/billing-commands";
import { seedClinicalNotes } from "../helpers/clinical-notes";
import { addMemberToTenant, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";

const TZ = "Asia/Kolkata";
const ROLES: UserRole[] = ["owner", "admin", "doctor", "nurse", "receptionist"];

let tenantA: SeededTenant;
let tenantB: SeededTenant;
const members = {} as Record<UserRole, SeededTenant>;
const ids = {} as Record<"booked" | "waiting" | "withDoctor" | "toBill" | "paid" | "cancelled" | "yesterday" | "other" | "noShow" | "unbilled", string>;
const today = todayInTz(TZ);

// The board is read at a fixed clinic time (12:00 IST today), so the waits and the 'appointment time has passed' rule do not depend on when the suite runs.
const NOW = new Date(zonedDateTimeToUtcIso(today, "12:00", TZ));

async function token(t: SeededTenant, visitId: string, number: number, priority: string, createdAt: string) {
  await insertReturningId(getAdminClient(), "queue_tokens", {
    tenant_id: t.tenantId,
    visit_id: visitId,
    token_number: number,
    date: today,
    priority,
    created_at: createdAt,
  });
}

async function invoice(t: SeededTenant, visitId: string, patientId: string, total: number, paid: number) {
  const admin = getAdminClient();
  const invoiceId = await insertReturningId(admin, "invoices", {
    tenant_id: t.tenantId,
    visit_id: visitId,
    patient_id: patientId,
    invoice_number: `TB-${Math.random().toString(36).slice(2, 9)}`,
    subtotal: total,
    total_amount: total,
  });
  if (paid > 0) {
    const { error } = await admin
      .from("payments")
      .insert({ tenant_id: t.tenantId, invoice_id: invoiceId, amount: paid, payment_method: "cash", recorded_by: t.userId });
    if (error) throw new Error(error.message);
  }
}

beforeAll(async () => {
  tenantA = await seedTenantWithOwner("CI Today Clinic A");
  tenantB = await seedTenantWithOwner("CI Today Clinic B");
  members.owner = tenantA;
  for (const role of ROLES.filter((r) => r !== "owner")) members[role] = await addMemberToTenant(tenantA.tenantId, role);
  const admin = getAdminClient();
  const doctorId = members.doctor.userId;

  const booked = await seedVisit(tenantA, doctorId, { scheduledAt: zonedDateTimeToUtcIso(today, "12:30", TZ), overbooked: true });
  ids.booked = booked.visitId;
  await admin.from("patients").update({ allergies: ["Penicillin"], age: null, date_of_birth: "1990-03-04", sex: "female" }).eq("id", booked.patientId);

  const waiting = await seedVisit(tenantA, doctorId, { status: "waiting" });
  ids.waiting = waiting.visitId;
  await token(tenantA, waiting.visitId, 14, "urgent", new Date(NOW.getTime() - 25 * 60_000).toISOString());

  const withDoctor = await seedVisit(tenantA, doctorId, { status: "in_consultation" });
  ids.withDoctor = withDoctor.visitId;
  await token(tenantA, withDoctor.visitId, 12, "normal", new Date(NOW.getTime() - 40 * 60_000).toISOString());
  await seedClinicalNotes(withDoctor.visitId, { vitals: { systolic: 150, diastolic: 95, pulse: 88, temperature: 98.6 } });

  const toBill = await seedVisit(tenantA, doctorId, { status: "completed" });
  ids.toBill = toBill.visitId;
  await token(tenantA, toBill.visitId, 9, "normal", new Date(NOW.getTime() - 90 * 60_000).toISOString());
  await invoice(tenantA, toBill.visitId, toBill.patientId, 1000, 400);

  const paid = await seedVisit(tenantA, doctorId, { status: "completed" });
  ids.paid = paid.visitId;
  await token(tenantA, paid.visitId, 8, "normal", new Date(NOW.getTime() - 95 * 60_000).toISOString());
  await invoice(tenantA, paid.visitId, paid.patientId, 500, 500);

  // A-4: signed without "sign and bill", so no invoice at all.
  const unbilled = await seedVisit(tenantA, doctorId, { status: "completed" });
  ids.unbilled = unbilled.visitId;
  await token(tenantA, unbilled.visitId, 7, "normal", new Date(NOW.getTime() - 100 * 60_000).toISOString());

  const cancelled = await seedVisit(tenantA, doctorId, { status: "cancelled", scheduledAt: zonedDateTimeToUtcIso(today, "11:00", TZ), overbooked: true });
  ids.cancelled = cancelled.visitId;
  const noShow = await seedVisit(tenantA, doctorId, { status: "no_show", scheduledAt: zonedDateTimeToUtcIso(today, "09:00", TZ), overbooked: true });
  ids.noShow = noShow.visitId;

  const yesterday = await seedVisit(tenantA, doctorId, {
    scheduledAt: zonedDateTimeToUtcIso(addDaysYmd(today, -1), "10:30", TZ),
    overbooked: true,
  });
  ids.yesterday = yesterday.visitId;

  ids.other = (await seedVisit(tenantB, undefined, { status: "waiting" })).visitId;
});


async function boardOf(role: UserRole, options: Parameters<typeof getTodayBoard>[1] = {}): Promise<TodayRow[]> {
  const result = await getTodayBoard(ctxFor(members[role]), { now: NOW, ...options });
  if (!result.ok) throw new Error("board failed");
  return result.board.rows;
}
const byId = (rows: TodayRow[], id: string) => rows.find((r) => r.visitId === id);

describe("getTodayBoard: the day and the projection", () => {
  it("lists the clinic's day: today's booking and queue, cancelled and no-show included, not yesterday's, not another clinic's", async () => {
    const rows = await boardOf("owner");
    const listed = new Set(rows.map((r) => r.visitId));
    for (const id of [ids.booked, ids.waiting, ids.withDoctor, ids.toBill, ids.paid, ids.cancelled, ids.noShow]) expect(listed.has(id)).toBe(true);
    expect(listed.has(ids.yesterday)).toBe(false);
    expect(listed.has(ids.other)).toBe(false);
  });

  it("every row has exactly the projection keys, and no unlisted personal field", async () => {
    for (const role of ROLES) {
      const rows = await boardOf(role);
      expect(rows.length, role).toBeGreaterThan(0);
      for (const row of rows) {
        expect(Object.keys(row).sort(), role).toEqual([...TODAY_ROW_KEYS].sort());
      }
      const text = JSON.stringify(rows);
      expect(text).not.toContain("Penicillin");
      expect(text).not.toMatch(/abha|address|specialty|chief_complaints/i);
    }
  });

  it("the lanes: booked (and the late no-show who can still be checked in, A-10), waiting (urgent token), with doctor, to bill (money due, or no invoice, A-4), done (paid, cancelled)", async () => {
    const lanes = groupIntoLanes(await boardOf("owner"));
    expect(lanes.booked.map((r) => r.visitId)).toEqual([ids.noShow, ids.booked]);
    expect(lanes.waiting.map((r) => r.visitId)).toEqual([ids.waiting]);
    expect(lanes.with_doctor.map((r) => r.visitId)).toEqual([ids.withDoctor]);
    expect(new Set(lanes.to_bill.map((r) => r.visitId))).toEqual(new Set([ids.toBill, ids.unbilled]));
    expect(new Set(lanes.done.map((r) => r.visitId))).toEqual(new Set([ids.paid, ids.cancelled]));
  });

  it("A-4: a completed visit with no invoice is Not billed and in To bill; a settled one is Nothing due and Done; roles without billing:view see neither", async () => {
    for (const role of ["owner", "admin", "receptionist"] as const) {
      const rows = await boardOf(role);
      expect(byId(rows, ids.unbilled), role).toMatchObject({ billed: false, balanceDue: 0 });
      expect(byId(rows, ids.paid), role).toMatchObject({ billed: true, balanceDue: 0 });
      expect(byId(rows, ids.toBill), role).toMatchObject({ billed: true, balanceDue: 600 });
      const lanes = groupIntoLanes(rows);
      expect(lanes.to_bill.map((r) => r.visitId), role).toContain(ids.unbilled);
      expect(lanes.done.map((r) => r.visitId), role).not.toContain(ids.unbilled);
      expect(byId(rows, ids.waiting)!.billed, role).toBeNull();
    }
    for (const role of ["nurse", "doctor"] as const) {
      const rows = await boardOf(role);
      expect(byId(rows, ids.unbilled)!.billed, role).toBeNull();
      expect(groupIntoLanes(rows).to_bill, role).toEqual([]);
    }
  });

  it("A-10: a no-show whose time passed today is in Booked for a role that can check it in, Done for one that cannot", async () => {
    expect(groupIntoLanes(await boardOf("receptionist")).booked.map((r) => r.visitId)).toContain(ids.noShow);
    const nurse = await boardOf("nurse");
    const nurseNoShow = byId(nurse, ids.noShow)!;
    expect(laneOf(nurseNoShow)).toBe(nurseNoShow.actions.includes("check_in") ? "booked" : "done");
  });

  it("row facts: token, priority, wait minutes from the token, appointment time in clinic time, age from the date of birth, sex letter", async () => {
    const rows = await boardOf("owner");
    const waiting = byId(rows, ids.waiting)!;
    expect(waiting).toMatchObject({ token: 14, priority: "urgent", status: "waiting", origin: "walk_in", time: null });
    expect(waiting.waitMinutes).toBe(25);
    expect(waiting.arrivedAt).toBe("11:35");
    const booked = byId(rows, ids.booked)!;
    expect(booked).toMatchObject({ time: "12:30", origin: "scheduled", token: null, waitMinutes: null, sex: "F" });
    expect(booked.age).toMatch(/^\d+ y$/);
    expect(byId(rows, ids.toBill)!.balanceDue).toBe(600);
    expect(byId(rows, ids.paid)!.balanceDue).toBe(0);
  });

  it("the doctor filter keeps one doctor's rows", async () => {
    const mine = await boardOf("owner", { doctorId: members.doctor.userId });
    expect(mine.length).toBe((await boardOf("owner")).length);
    const none = await boardOf("owner", { doctorId: members.nurse.userId });
    expect(none).toEqual([]);
  });
});

describe("getTodayBoard: what each role sees", () => {
  it("receptionist: balance due and To bill, no allergy flag, no vitals", async () => {
    const rows = await boardOf("receptionist");
    expect(byId(rows, ids.toBill)!.balanceDue).toBe(600);
    for (const row of rows) {
      expect(row.hasAllergy).toBeNull();
      expect(row.vitals).toBeNull();
      expect(row.vitalsPending).toBe(false);
    }
    expect(new Set(groupIntoLanes(rows).to_bill.map((r) => r.visitId))).toEqual(new Set([ids.toBill, ids.unbilled]));
  });

  it("nurse and doctor: allergy flag, vitals (v1 'temperature' read as °F) and 'Vitals pending'; no balance, so nothing is To bill", async () => {
    for (const role of ["nurse", "doctor"] as const) {
      const rows = await boardOf(role);
      expect(byId(rows, ids.booked)!.hasAllergy, role).toBe(true);
      expect(byId(rows, ids.waiting)!.hasAllergy, role).toBe(false);
      expect(byId(rows, ids.withDoctor)!.vitals, role).toMatchObject({ systolic: 150, diastolic: 95, pulse: 88, temperatureF: 98.6 });
      expect(byId(rows, ids.withDoctor)!.vitalsPending, role).toBe(false);
      expect(byId(rows, ids.waiting)!.vitalsPending, role).toBe(true);
      for (const row of rows) expect(row.balanceDue, role).toBeNull();
      expect(groupIntoLanes(rows).to_bill, role).toEqual([]);
    }
  });

  it("admin: balance only; owner: everything", async () => {
    const admin = await boardOf("admin");
    expect(byId(admin, ids.toBill)!.balanceDue).toBe(600);
    expect(byId(admin, ids.booked)!.hasAllergy).toBeNull();
    expect(byId(admin, ids.withDoctor)!.vitals).toBeNull();
    const owner = await boardOf("owner");
    expect(byId(owner, ids.toBill)!.balanceDue).toBe(600);
    expect(byId(owner, ids.booked)!.hasAllergy).toBe(true);
    expect(byId(owner, ids.withDoctor)!.vitals).not.toBeNull();
  });

  it("row actions follow the state machine and the role: a receptionist checks a booking in but may not start a consult", async () => {
    const reception = await boardOf("receptionist");
    expect(byId(reception, ids.booked)!.actions).toEqual(["check_in", "reschedule", "cancel"]);
    expect(byId(reception, ids.waiting)!.actions).toEqual(["cancel"]);
    expect(byId(reception, ids.noShow)!.actions).toEqual(["check_in", "reschedule"]);
    const doctor = await boardOf("doctor");
    expect(byId(doctor, ids.booked)!.actions).toEqual(["check_in", "start", "reschedule", "cancel"]);
    expect(byId(doctor, ids.waiting)!.actions).toEqual(["start", "record_vitals", "cancel"]);
  });
});

describe("getTodayBoard: the clinic day is the clinic's own", () => {
  it("a walk-in created at 00:10 IST belongs to that IST date, not the UTC date before it", async () => {
    const { visitId } = await seedVisit(tenantA, members.doctor.userId, { status: "waiting" });
    await getAdminClient().from("visits").update({ created_at: "2026-11-20T18:40:00.000Z" }).eq("id", visitId);
    const onTheIstDay = await boardOf("owner", { date: "2026-11-21" });
    const dayBefore = await boardOf("owner", { date: "2026-11-20" });
    expect(onTheIstDay.some((r) => r.visitId === visitId)).toBe(true);
    expect(dayBefore.some((r) => r.visitId === visitId)).toBe(false);
  });

  it("a booking at 23:50 IST belongs to its own IST day and reads 23:50", async () => {
    const at = zonedDateTimeToUtcIso("2026-11-22", "23:50", TZ);
    const { visitId } = await seedVisit(tenantA, members.doctor.userId, { scheduledAt: at, overbooked: true });
    const rows = await boardOf("owner", { date: "2026-11-22" });
    expect(byId(rows, visitId)).toMatchObject({ time: "23:50" });
    expect((await boardOf("owner", { date: "2026-11-23" })).some((r) => r.visitId === visitId)).toBe(false);
  });
});

describe("getTodayBoard: isolation", () => {
  it("clinic B's own board lists only its visit", async () => {
    const result = await getTodayBoard(ctxFor(tenantB), { now: NOW });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.board.rows.map((r) => r.visitId)).toEqual([ids.other]);
  });
});

describe("getTodayBoard: invoices (A-4)", () => {
  // Last in the file: it adds a completed visit to the shared clinic, which the lane expectations above must not see.
  it("A-4: a cancelled invoice does not count as billed", async () => {
    const extra = await seedVisit(tenantA, members.doctor.userId, { status: "completed" });
    await invoice(tenantA, extra.visitId, extra.patientId, 300, 0);
    await getAdminClient().from("invoices").update({ status: "cancelled" }).eq("visit_id", extra.visitId);
    expect(byId(await boardOf("owner"), extra.visitId)).toMatchObject({ billed: false });
  });
});

describe("getTodayBoard: the recommended follow-up of a completed visit (V2-09b 09B-04b, R-15, Q-14)", () => {
  it("a role that may book sees the follow-up date and whether it is booked; the rule is three days before the date, same doctor, booked or confirmed", async () => {
    const admin = getAdminClient();
    const doctorId = members.doctor.userId;
    // The completed 'to bill' visit gets a follow-up in 5 days; nothing is booked yet.
    const date = addDaysYmd(today, 5);
    const added = await admin
      .from("follow_ups")
      .insert({ tenant_id: tenantA.tenantId, visit_id: ids.toBill, patient_id: (await patientOf(ids.toBill)), doctor_id: doctorId, follow_up_date: date });
    expect(added.error).toBeNull();

    const row = async (role: UserRole) => byId(await boardOf(role), ids.toBill)!;
    expect((await row("receptionist")).followUp).toEqual({ date, booked: false });
    expect((await row("owner")).followUp).toEqual({ date, booked: false });
    // A visit that is not completed, and a completed one without a follow-up, carry none.
    const rows = await boardOf("receptionist");
    expect(byId(rows, ids.paid)!.followUp).toBeNull();
    expect(byId(rows, ids.waiting)!.followUp).toBeNull();
    // A role that may not book is not given it.
    for (const role of ROLES) {
      const expected = hasPerm(role, "appointments:edit") ? { date, booked: false } : null;
      expect((await row(role)).followUp, role).toEqual(expected);
    }

    const patientId = await patientOf(ids.toBill);
    const book = async (offset: number, doctor: string, status: "booked" | "confirmed" | "cancelled") => {
      const inserted = await admin.from("visits").insert({
        tenant_id: tenantA.tenantId,
        patient_id: patientId,
        doctor_id: doctor,
        origin_type: "scheduled",
        status,
        scheduled_at: zonedDateTimeToUtcIso(addDaysYmd(today, offset), "11:00", TZ),
        is_overbooked: true,
        created_by: tenantA.userId,
      }).select("id").single();
      expect(inserted.error).toBeNull();
      return inserted.data!.id as string;
    };
    // Not counted: another doctor's visit, a cancelled one, one more than three days before the date (day 1 is four days before day 5).
    await book(6, members.owner.userId, "booked");
    await book(5, doctorId, "cancelled");
    await book(1, doctorId, "booked");
    expect((await row("receptionist")).followUp).toEqual({ date, booked: false });
    // Counted: a booked visit with the same doctor on day 2 (three days before the date) or later.
    const counted = await book(2, doctorId, "confirmed");
    expect((await row("receptionist")).followUp).toEqual({ date, booked: true });
    expect((await admin.from("visits").update({ status: "cancelled" }).eq("id", counted)).error).toBeNull();
    expect((await row("receptionist")).followUp).toEqual({ date, booked: false });
    await book(7, doctorId, "booked");
    expect((await row("receptionist")).followUp).toEqual({ date, booked: true });
  });
});

async function patientOf(visitId: string): Promise<string> {
  const { data, error } = await getAdminClient().from("visits").select("patient_id").eq("id", visitId).single();
  if (error) throw new Error(error.message);
  return data.patient_id as string;
}
