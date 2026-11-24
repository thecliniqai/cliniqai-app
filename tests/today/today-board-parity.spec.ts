/**
 * V2-09e 09E-06 (R-9, R-12): `today_board` (one SQL read) against the board the old service built (seven reads, the model built in TypeScript; kept
 * verbatim in `support/legacy-board.ts` as the oracle).
 *
 * - parity: front-desk and doctor mode, owner, doctor, receptionist and nurse (and admin), a day with booked, waiting, in consultation, completed and
 *   billed, completed and unbilled, cancelled and no-show visits, a follow-up, a doctor with no name: the view model deep-equals the old one (the row
 *   versions are the only new fields; they are checked on their own);
 * - stored expectations (the second block): the facts each role must see, written down, so the spec still says something when the old path is gone;
 * - the versions in the answer are the clinic's own versions in the same snapshot; the doctor's mode is that doctor's visits only.
 * Synthetic data only.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { getTodayBoard } from "@/features/today/queries";
import type { TodayRow } from "@/features/today/schema";
import { addDaysYmd, todayInTz, zonedDateTimeToUtcIso } from "@/lib/datetime";
import type { UserRole } from "@/lib/db/types";
import { ctxFor } from "../helpers/context";
import { getAdminClient } from "../helpers/supabase-admin";
import { insertReturningId } from "../helpers/db";
import { seedVisit } from "../helpers/billing-commands";
import { seedClinicalNotes } from "../helpers/clinical-notes";
import { addMemberToTenant, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { legacyTodayBoard } from "./support/legacy-board";

const TZ = "Asia/Kolkata";
const ROLES: UserRole[] = ["owner", "admin", "doctor", "nurse", "receptionist"];
const today = todayInTz(TZ);
const NOW = new Date(zonedDateTimeToUtcIso(today, "12:00", TZ));

let tenant: SeededTenant;
let other: SeededTenant;
const members = {} as Record<UserRole, SeededTenant>;
let secondDoctor: SeededTenant;
const ids = {} as Record<"booked" | "waiting" | "withDoctor" | "billed" | "paid" | "unbilled" | "cancelled" | "noShow" | "second" | "ownerVisit" | "foreign", string>;

async function token(visitId: string, number: number, priority: string, createdAt: string) {
  await insertReturningId(getAdminClient(), "queue_tokens", { tenant_id: tenant.tenantId, visit_id: visitId, token_number: number, date: today, priority, created_at: createdAt });
}
async function invoice(visitId: string, patientId: string, total: number, paid: number) {
  const admin = getAdminClient();
  const invoiceId = await insertReturningId(admin, "invoices", {
    tenant_id: tenant.tenantId,
    visit_id: visitId,
    patient_id: patientId,
    invoice_number: `PR-${Math.random().toString(36).slice(2, 9)}`,
    total_amount: total,
  });
  for (const amount of paid > 0 ? [paid / 2, paid / 2] : []) {
    const { error } = await admin.from("payments").insert({ tenant_id: tenant.tenantId, invoice_id: invoiceId, amount, payment_method: "cash", recorded_by: tenant.userId });
    if (error) throw new Error(error.message);
  }
}

beforeAll(async () => {
  tenant = await seedTenantWithOwner("CI Board Parity A");
  other = await seedTenantWithOwner("CI Board Parity B");
  members.owner = tenant;
  for (const role of ROLES.filter((r) => r !== "owner")) members[role] = await addMemberToTenant(tenant.tenantId, role);
  secondDoctor = await addMemberToTenant(tenant.tenantId, "doctor");
  const admin = getAdminClient();
  // A named doctor, and one with no name (the directory numbers it by position).
  await admin.from("memberships").update({ full_name: "Parity Doctor" }).eq("tenant_id", tenant.tenantId).eq("user_id", members.doctor.userId);
  await admin.from("memberships").update({ full_name: null }).eq("tenant_id", tenant.tenantId).eq("user_id", secondDoctor.userId);
  const doctorId = members.doctor.userId;

  const booked = await seedVisit(tenant, doctorId, { scheduledAt: zonedDateTimeToUtcIso(today, "12:30", TZ), overbooked: true });
  ids.booked = booked.visitId;
  await admin.from("patients").update({ allergies: ["Penicillin"], age: null, date_of_birth: "1990-03-04", sex: "female" }).eq("id", booked.patientId);
  const waiting = await seedVisit(tenant, doctorId, { status: "waiting" });
  ids.waiting = waiting.visitId;
  await token(waiting.visitId, 14, "urgent", new Date(NOW.getTime() - 25 * 60_000).toISOString());
  const withDoctor = await seedVisit(tenant, doctorId, { status: "in_consultation" });
  ids.withDoctor = withDoctor.visitId;
  await token(withDoctor.visitId, 12, "vip", new Date(NOW.getTime() - 40 * 60_000).toISOString());
  await seedClinicalNotes(withDoctor.visitId, { vitals: { systolic: 150, diastolic: 95, pulse: 88, temperature: 98.6 } });
  const billed = await seedVisit(tenant, doctorId, { status: "completed" });
  ids.billed = billed.visitId;
  await token(billed.visitId, 9, "normal", new Date(NOW.getTime() - 90 * 60_000).toISOString());
  await invoice(billed.visitId, billed.patientId, 1000, 400);
  const paid = await seedVisit(tenant, doctorId, { status: "completed" });
  ids.paid = paid.visitId;
  await token(paid.visitId, 8, "normal", new Date(NOW.getTime() - 95 * 60_000).toISOString());
  await invoice(paid.visitId, paid.patientId, 500, 500);
  const unbilled = await seedVisit(tenant, doctorId, { status: "completed" });
  ids.unbilled = unbilled.visitId;
  await token(unbilled.visitId, 7, "normal", new Date(NOW.getTime() - 100 * 60_000).toISOString());
  ids.cancelled = (await seedVisit(tenant, doctorId, { status: "cancelled", scheduledAt: zonedDateTimeToUtcIso(today, "11:00", TZ), overbooked: true })).visitId;
  ids.noShow = (await seedVisit(tenant, doctorId, { status: "no_show", scheduledAt: zonedDateTimeToUtcIso(today, "09:00", TZ), overbooked: true })).visitId;
  // The second (nameless) doctor's visit, the owner's own visit, and one of yesterday's that must not be listed.
  ids.second = (await seedVisit(tenant, secondDoctor.userId, { status: "waiting" })).visitId;
  await token(ids.second, 15, "normal", new Date(NOW.getTime() - 5 * 60_000).toISOString());
  ids.ownerVisit = (await seedVisit(tenant, tenant.userId, { scheduledAt: zonedDateTimeToUtcIso(today, "16:00", TZ), overbooked: true })).visitId;
  await seedVisit(tenant, doctorId, { scheduledAt: zonedDateTimeToUtcIso(addDaysYmd(today, -1), "10:30", TZ), overbooked: true });
  ids.foreign = (await seedVisit(other, undefined, { status: "waiting" })).visitId;
  // A follow-up on the billed visit, booked by a later visit with the same doctor.
  const follow = addDaysYmd(today, 5);
  const { error } = await admin
    .from("follow_ups")
    .insert({ tenant_id: tenant.tenantId, visit_id: billed.visitId, patient_id: billed.patientId, doctor_id: doctorId, follow_up_date: follow });
  if (error) throw new Error(error.message);
  await admin.from("visits").insert({
    tenant_id: tenant.tenantId,
    patient_id: billed.patientId,
    doctor_id: doctorId,
    origin_type: "scheduled",
    status: "booked",
    scheduled_at: zonedDateTimeToUtcIso(follow, "11:00", TZ),
    is_overbooked: true,
    created_by: tenant.userId,
  });
});

// The number of a nameless doctor ("Doctor (3)") is its position in the directory. The old read left that order to the heap (an UPDATE moved a row), the new
// one is the membership's creation order (a deliberate fix, listed in the notes), so only the shape of the fallback is compared.
const strip = (rows: readonly Partial<TodayRow>[]) =>
  [...rows]
    .map((row) => {
      const copy: Partial<TodayRow> = { ...row };
      delete copy.rowVersion;
      delete copy.invoiceVersion;
      return { ...copy, doctorName: copy.doctorName?.replace(/^Doctor \(\d+\)$/, "Doctor (n)") };
    })
    .sort((a, b) => String(a.visitId).localeCompare(String(b.visitId)));

async function both(role: UserRole, mode: "front" | "triage" | "doctor", doctorId?: string) {
  const ctx = ctxFor(members[role]);
  const next = await getTodayBoard(ctx, { now: NOW, mode, doctorId });
  const old = await legacyTodayBoard(ctx, { now: NOW, mode, doctorId });
  if (!next.ok || !old.ok) throw new Error("board failed");
  return { next: next.board, old: old.board };
}

describe("today_board parity with the old service", () => {
  const cases: Array<[UserRole, "front" | "triage" | "doctor"]> = [
    ["owner", "front"],
    ["admin", "front"],
    ["receptionist", "front"],
    ["nurse", "triage"],
    ["doctor", "doctor"],
    ["owner", "doctor"],
  ];
  for (const [role, mode] of cases) {
    it(`${role} in ${mode} mode: the view model deep-equals the old one`, async () => {
      const doctorId = mode === "doctor" ? members[role].userId : undefined;
      const { next, old } = await both(role, mode, doctorId);
      expect(strip(next.rows)).toEqual(strip(old.rows));
      expect({ today: next.today, timeZone: next.timeZone }).toEqual({ today: old.today, timeZone: old.timeZone });
    });
  }
  it("the front-desk day lists every visit of the clinic day and nothing of yesterday or another clinic", async () => {
    const { next, old } = await both("owner", "front");
    expect(next.rows.map((r) => r.visitId).sort()).toEqual(old.rows.map((r) => r.visitId).sort());
    expect(next.rows).toHaveLength(10);
    expect(next.rows.some((r) => r.visitId === ids.foreign)).toBe(false);
  });
});

describe("today_board stored expectations", () => {
  const rowOf = async (role: UserRole, mode: "front" | "triage" | "doctor", id: string, doctorId?: string) => {
    const result = await getTodayBoard(ctxFor(members[role]), { now: NOW, mode, doctorId });
    if (!result.ok) throw new Error("board failed");
    return result.board.rows.find((r) => r.visitId === id);
  };

  it("front desk (receptionist): money and tokens, no clinical flags, the nameless doctor is numbered", async () => {
    expect(await rowOf("receptionist", "front", ids.billed)).toMatchObject({
      status: "completed", token: 9, balanceDue: 600, billed: true, hasAllergy: null, vitals: null, vitalsPending: false,
      doctorName: "Dr. Parity Doctor", followUp: { date: addDaysYmd(today, 5), booked: true },
    });
    expect(await rowOf("receptionist", "front", ids.unbilled)).toMatchObject({ balanceDue: 0, billed: false });
    expect(await rowOf("receptionist", "front", ids.paid)).toMatchObject({ balanceDue: 0, billed: true });
    expect((await rowOf("receptionist", "front", ids.second))!.doctorName).toMatch(/^Doctor \(\d+\)$/);
    expect(await rowOf("receptionist", "front", ids.waiting)).toMatchObject({ token: 14, priority: "urgent", waitMinutes: 25, arrivedAt: "11:35", billed: null });
    expect(await rowOf("receptionist", "front", ids.booked)).toMatchObject({ time: "12:30", sex: "F", origin: "scheduled", overbooked: true });
  });

  it("nurse and doctor: allergy flag (never the allergen), vitals, vitals pending, no balance", async () => {
    for (const role of ["nurse", "doctor"] as const) {
      const mode = role === "nurse" ? "triage" : "front";
      expect(await rowOf(role, mode, ids.booked), role).toMatchObject({ hasAllergy: true, balanceDue: null, billed: null });
      expect(await rowOf(role, mode, ids.withDoctor), role).toMatchObject({ vitals: { systolic: 150, diastolic: 95, pulse: 88, temperatureF: 98.6 }, vitalsPending: false, priority: "vip" });
      expect(await rowOf(role, mode, ids.waiting), role).toMatchObject({ vitalsPending: true, hasAllergy: false });
    }
    const result = await getTodayBoard(ctxFor(members.nurse), { now: NOW, mode: "triage" });
    if (!result.ok) throw new Error("board failed");
    expect(JSON.stringify(result.board)).not.toContain("Penicillin");
  });

  it("doctor mode lists that doctor's visits only", async () => {
    const result = await getTodayBoard(ctxFor(members.doctor), { now: NOW, mode: "doctor", doctorId: members.doctor.userId });
    if (!result.ok) throw new Error("board failed");
    const listed = new Set(result.board.rows.map((r) => r.visitId));
    expect(listed.has(ids.second)).toBe(false);
    expect(listed.has(ids.ownerVisit)).toBe(false);
    expect(listed.has(ids.waiting)).toBe(true);
    expect(result.board.rows.every((r) => r.doctorId === members.doctor.userId)).toBe(true);
  });

  it("row versions: a visit and a live invoice carry theirs; a role without billing:view has no invoice version", async () => {
    const owner = await rowOf("owner", "front", ids.billed);
    expect(owner!.rowVersion).toBeGreaterThanOrEqual(0);
    expect(owner!.invoiceVersion).toBe(0);
    expect((await rowOf("owner", "front", ids.unbilled))!.invoiceVersion).toBeNull();
    expect((await rowOf("nurse", "triage", ids.billed))!.invoiceVersion).toBeNull();
    const { error } = await getAdminClient().from("visits").update({ is_overbooked: false }).eq("id", ids.booked);
    expect(error).toBeNull();
    expect((await rowOf("owner", "front", ids.booked))!.rowVersion).toBeGreaterThan(0);
  });

  it("the versions of the answer are the clinic's own, from the same read", async () => {
    const result = await getTodayBoard(ctxFor(members.receptionist), { now: NOW, mode: "front" });
    if (!result.ok) throw new Error("board failed");
    const { data } = await members.receptionist.client.from("clinic_versions").select("domain, version").eq("tenant_id", tenant.tenantId);
    const stored = Object.fromEntries((data ?? []).map((r) => [r.domain as string, Number(r.version)]));
    expect(result.versions).toEqual(stored);
  });

  it("another clinic's board never lists this clinic's visits, and a forged tenant is refused", async () => {
    const result = await getTodayBoard(ctxFor(other), { now: NOW, mode: "front" });
    if (!result.ok) throw new Error("board failed");
    expect(result.board.rows.map((r) => r.visitId)).toEqual([ids.foreign]);
    const forged = await getTodayBoard({ ...ctxFor(other), tenantId: tenant.tenantId }, { now: NOW, mode: "front" });
    expect(forged.ok).toBe(false);
  });
});
