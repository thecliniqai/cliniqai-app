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
import { TODAY_ROW_KEYS, groupIntoLanes, type TodayRow } from "@/features/today/schema";
import { addDaysYmd, todayInTz, zonedDateTimeToUtcIso } from "@/lib/datetime";
import type { UserRole } from "@/lib/db/types";
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
const ids = {} as Record<"booked" | "waiting" | "withDoctor" | "toBill" | "paid" | "cancelled" | "yesterday" | "other" | "noShow", string>;
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

  it("the lanes: booked, waiting (urgent token), with doctor, to bill (money due), done (paid, cancelled, no-show)", async () => {
    const lanes = groupIntoLanes(await boardOf("owner"));
    expect(lanes.booked.map((r) => r.visitId)).toEqual([ids.booked]);
    expect(lanes.waiting.map((r) => r.visitId)).toEqual([ids.waiting]);
    expect(lanes.with_doctor.map((r) => r.visitId)).toEqual([ids.withDoctor]);
    expect(lanes.to_bill.map((r) => r.visitId)).toEqual([ids.toBill]);
    expect(new Set(lanes.done.map((r) => r.visitId))).toEqual(new Set([ids.paid, ids.cancelled, ids.noShow]));
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
    expect(groupIntoLanes(rows).to_bill.map((r) => r.visitId)).toEqual([ids.toBill]);
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
