/**
 * V2-08 08-04a (R-9, R-16, P1-20): the patient's self-reschedule link uses the slots staff use.
 *
 * `GET /api/reschedule/[token]` no longer builds slots (the UTC loop and the TypeScript default are gone): it asks
 * `get_reschedule_slots`, which reads the doctor's schedule (a NULL schedule is the default hours), the schedule blocks and the
 * booked visits in the clinic's time zone, for the visit's own duration, the visit itself never blocking itself.
 * `POST` runs `consume_reschedule_token`, which validates the same rules (slot_unavailable, slot_taken) and moves the visit.
 * Called through the route handlers; rows are seeded and read with the service-role client. Synthetic data only.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET as getRescheduleRoute, POST as postRescheduleRoute } from "@/app/api/reschedule/[token]/route";
import { generateRescheduleToken } from "@/features/appointments/system";
import { addDaysYmd, todayInTz, weekdayOfYmd } from "@/lib/datetime";
import { addMemberToTenant, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { getAdminClient } from "../helpers/supabase-admin";
import { seedBlock, seedBookedVisit, seedPatient, setSchedule, weekSchedule } from "../helpers/front-desk-commands";

const admin = getAdminClient();

let tenantA: SeededTenant;
let tenantNy: SeededTenant;
let patientA: string;

// A Tuesday two to three weeks ahead in the clinic's zone (the link takes nothing beyond 90 days, so the day is relative to today),
// and the Sunday after it.
const DAY = (() => {
  let ymd = addDaysYmd(todayInTz("Asia/Kolkata"), 14);
  while (weekdayOfYmd(ymd) !== "tuesday") ymd = addDaysYmd(ymd, 1);
  return ymd;
})();
const SUNDAY = addDaysYmd(DAY, 5);

/** The instant of wall-clock `h:mm` on `day` in an IANA zone (the clinic's, DST included). */
function zoned(day: string, h: number, mm: number, tz: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mm);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(guess));
  const part = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const asUtc = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"));
  return new Date(guess - (asUtc - guess)).toISOString();
}

/** The instant of wall-clock `h:mm` on `day` in a zone `offsetMinutes` east of UTC. */
function at(day: string, h: number, mm: number, offsetMinutes = 330): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, h, mm) - offsetMinutes * 60_000).toISOString();
}

async function doctorWith(schedule: unknown, slotMinutes = 15): Promise<string> {
  const doc = await addMemberToTenant(tenantA.tenantId, "doctor");
  await setSchedule(tenantA.tenantId, doc.userId, schedule, slotMinutes);
  return doc.userId;
}

/** A link for a fresh booked visit of `doctorId` at `slot` (a single-use token, as the reminder job issues it). */
async function linkFor(t: SeededTenant, doctorId: string, slot: string, over: Record<string, unknown> = {}): Promise<{ token: string; visitId: string }> {
  const visitId = await seedBookedVisit(t, await seedPatient(t), doctorId, slot, over);
  const url = await generateRescheduleToken({ db: admin, reason: "messaging_webhook" }, visitId);
  return { token: url.split("/reschedule/")[1], visitId };
}

const get = (token: string, date?: string) =>
  getRescheduleRoute(new NextRequest(`http://localhost:3000/api/reschedule/${token}${date ? `?date=${date}` : ""}`), { params: Promise.resolve({ token }) });
const post = (token: string, newScheduledAt: string) =>
  postRescheduleRoute(
    new NextRequest(`http://localhost:3000/api/reschedule/${token}`, {
      method: "POST",
      body: JSON.stringify({ newScheduledAt }),
      headers: { "content-type": "application/json" },
    }),
    { params: Promise.resolve({ token }) }
  );

async function slotsOf(token: string, date: string): Promise<string[]> {
  const res = await get(token, date);
  expect(res.status).toBe(200);
  return (await res.json()).available_slots as string[];
}

beforeAll(async () => {
  tenantA = await seedTenantWithOwner("CI Patient Link Clinic A");
  tenantNy = await seedTenantWithOwner("CI Patient Link New York Clinic");
  patientA = await seedPatient(tenantA);
  const { error } = await admin.from("tenants").update({ timezone: "America/New_York" }).eq("id", tenantNy.tenantId);
  if (error) throw new Error(`seed timezone failed: ${error.message}`);
});

describe("the link lists the slots staff see", () => {
  it("the clinic-zone slots of the doctor's shifts, equal to available_slots for the same visit, the visit's own slot included", async () => {
    const doctor = await doctorWith(weekSchedule([{ start: "10:00", end: "11:00" }, { start: "17:00", end: "17:30" }]));
    const { token, visitId } = await linkFor(tenantA, doctor, at(DAY, 10, 15));
    await seedBookedVisit(tenantA, patientA, doctor, at(DAY, 10, 30)); // another patient's slot

    const res = await get(token, DAY);
    const json = await res.json();
    expect(json.timezone).toBe("Asia/Kolkata");
    expect(json.selected_date).toBe(DAY);
    expect(json.available_slots).toEqual([at(DAY, 10, 0), at(DAY, 10, 15), at(DAY, 10, 45), at(DAY, 17, 0), at(DAY, 17, 15)]);

    // The staff list for the same visit is the same list.
    const { data, error } = await tenantA.client.rpc("available_slots", { p_doctor_id: doctor, p_date: DAY, p_exclude_visit_id: visitId });
    expect(error).toBeNull();
    expect((data ?? []).map((r) => new Date(r.slot_start).toISOString())).toEqual(json.available_slots);
  });

  it("a doctor without a stored schedule is read as the default hours (not the old 20:00 evening end), Sunday is off", async () => {
    const doctor = await doctorWith(null);
    const { token } = await linkFor(tenantA, doctor, at(DAY, 11, 0));
    const slots = await slotsOf(token, DAY);
    expect(slots).toHaveLength(28);
    expect(slots[0]).toBe(at(DAY, 10, 0));
    expect(slots[slots.length - 1]).toBe(at(DAY, 20, 45));
    expect(await slotsOf(token, SUNDAY)).toEqual([]);
  });

  it("blocks remove their slots; a visit of 30 minutes only lists starts whose whole 30 minutes are free", async () => {
    const doctor = await doctorWith(weekSchedule([{ start: "10:00", end: "11:30" }]));
    const { token } = await linkFor(tenantA, doctor, at(DAY, 11, 0), { estimated_duration_minutes: 30 });
    await seedBlock(tenantA, at(DAY, 10, 45), at(DAY, 11, 0), doctor);
    await seedBookedVisit(tenantA, patientA, doctor, at(DAY, 10, 30)); // 10:30-10:45
    const slots = await slotsOf(token, DAY);
    // 15-minute grid; a 30-minute visit at 10:00 would end 10:30 (free), at 10:15 would reach 10:45 (the booked 10:30 visit), at 10:30
    // is the other visit, at 10:45 is blocked, at 11:00 is the visit itself (excluded) and ends 11:30 (in shift).
    expect(slots).toEqual([at(DAY, 10, 0), at(DAY, 11, 0)]);
  });

  it("the date is the clinic's: in New York a 10:30 slot is at the New York offset and the default date is the clinic's tomorrow", async () => {
    const doc = await addMemberToTenant(tenantNy.tenantId, "doctor");
    await setSchedule(tenantNy.tenantId, doc.userId, weekSchedule([{ start: "10:30", end: "11:00" }]));
    const day = addDaysYmd(todayInTz("America/New_York"), 10);
    const { token } = await linkFor(tenantNy, doc.userId, zoned(day, 14, 0, "America/New_York"));
    const json = await (await get(token, day)).json();
    expect(json.timezone).toBe("America/New_York");
    expect(json.available_slots).toEqual([zoned(day, 10, 30, "America/New_York"), zoned(day, 10, 45, "America/New_York")]);
    const tomorrow = await (await get(token)).json();
    expect(tomorrow.selected_date).toBe(addDaysYmd(todayInTz("America/New_York"), 1));
  });

  it("a date in the past or beyond 90 days lists nothing", async () => {
    const doctor = await doctorWith(weekSchedule([{ start: "10:00", end: "11:00" }]));
    const { token } = await linkFor(tenantA, doctor, at(DAY, 10, 0));
    expect(await slotsOf(token, addDaysYmd(todayInTz("Asia/Kolkata"), -2))).toEqual([]);
    expect(await slotsOf(token, addDaysYmd(todayInTz("Asia/Kolkata"), 120))).toEqual([]);
  });
});

describe("the link moves the visit by the same rules", () => {
  it("an off-duty time, a blocked time and a taken time are 409 and leave the visit and the link as they were", async () => {
    const doctor = await doctorWith(weekSchedule([{ start: "10:00", end: "11:00" }]));
    const { token, visitId } = await linkFor(tenantA, doctor, at(DAY, 10, 0), { estimated_duration_minutes: 30 });
    await seedBlock(tenantA, at(DAY, 10, 45), at(DAY, 11, 0), doctor);
    await seedBookedVisit(tenantA, patientA, doctor, at(DAY, 10, 30));

    const offDuty = await post(token, at(DAY, 14, 0));
    expect(offDuty.status).toBe(409);
    expect((await offDuty.json()).error).toContain("no longer available");
    expect((await post(token, at(DAY, 10, 45))).status).toBe(409); // blocked
    expect((await post(token, at(DAY, 10, 15))).status).toBe(409); // 10:15-10:45 overlaps the booked 10:30 visit (its own duration)
    expect((await post(token, at(DAY, 10, 30))).status).toBe(409); // exactly the booked slot

    const { data: visit } = await admin.from("visits").select("scheduled_at").eq("id", visitId).single();
    expect(new Date(visit!.scheduled_at as string).toISOString()).toBe(at(DAY, 10, 0));
    // The refusals did not consume the link, and 10:05-10:35 would still overlap the booked 10:30 visit.
    expect((await post(token, at(DAY, 10, 5))).status).toBe(409);
    const { data: row } = await admin.from("visits").select("scheduled_at").eq("id", visitId).single();
    expect(new Date(row!.scheduled_at as string).toISOString()).toBe(at(DAY, 10, 0));
    expect((await get(token, DAY)).status).toBe(200);
  });

  it("a free slot moves the visit once; moving into the visit's own overlapping time works; the token is then spent (410)", async () => {
    const doctor = await doctorWith(weekSchedule([{ start: "10:00", end: "12:00" }]));
    const { token, visitId } = await linkFor(tenantA, doctor, at(DAY, 10, 0), { estimated_duration_minutes: 30 });
    // The visit's own time overlaps the target (10:00-10:30 vs 10:15-10:45): never a conflict with itself.
    const moved = await post(token, at(DAY, 10, 15));
    expect(moved.status).toBe(200);
    const { data: row } = await admin.from("visits").select("scheduled_at, status, is_overbooked").eq("id", visitId).single();
    expect(new Date(row!.scheduled_at as string).toISOString()).toBe(at(DAY, 10, 15));
    expect(row).toMatchObject({ status: "booked", is_overbooked: false });
    expect((await post(token, at(DAY, 11, 0))).status).toBe(410);
    expect((await get(token, DAY)).status).toBe(410);
  });

  it("an overbooked visit moved by the link into a free slot is no longer overbooked and holds its slot", async () => {
    const doctor = await doctorWith(weekSchedule([{ start: "10:00", end: "12:00" }]));
    const { token, visitId } = await linkFor(tenantA, doctor, at(DAY, 14, 0), { is_overbooked: true });
    expect((await post(token, at(DAY, 11, 0))).status).toBe(200);
    const { data: row } = await admin.from("visits").select("is_overbooked").eq("id", visitId).single();
    expect(row?.is_overbooked).toBe(false);
    const other = await linkFor(tenantA, doctor, at(DAY, 14, 0), { is_overbooked: true });
    expect((await post(other.token, at(DAY, 11, 0))).status).toBe(409);
  });

  it("two patients taking the same slot at once: one 200, one 409 or 410; the doctor ends with one visit there", async () => {
    const doctor = await doctorWith(weekSchedule([{ start: "10:00", end: "12:00" }]));
    const one = await linkFor(tenantA, doctor, at(DAY, 10, 0));
    const two = await linkFor(tenantA, doctor, at(DAY, 10, 15));
    const target = at(DAY, 11, 0);
    const [x, y] = await Promise.all([post(one.token, target), post(two.token, target)]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    const { data } = await admin.from("visits").select("id").eq("doctor_id", doctor).eq("scheduled_at", target);
    expect(data).toHaveLength(1);
  });

  it("a locked clinic offers no online service: 409 for both verbs, nothing moves", async () => {
    const lockedTenant = await seedTenantWithOwner("CI Patient Link Locked Clinic");
    const { token, visitId } = await linkFor(lockedTenant, lockedTenant.userId, at(DAY, 11, 0));
    const { error } = await admin.from("tenant_subscriptions").update({ access_ends_at: new Date(Date.now() - 86_400_000).toISOString() }).eq("tenant_id", lockedTenant.tenantId);
    expect(error).toBeNull();
    expect((await get(token, DAY)).status).toBe(409);
    expect((await post(token, at(DAY, 11, 15))).status).toBe(409);
    const { data: row } = await admin.from("visits").select("scheduled_at").eq("id", visitId).single();
    expect(new Date(row!.scheduled_at as string).toISOString()).toBe(at(DAY, 11, 0));
  });

  it("a visit whose doctor is no longer a clinician of the clinic is unavailable online: 409, nothing moves", async () => {
    const receptionist = await addMemberToTenant(tenantA.tenantId, "receptionist");
    const { token, visitId } = await linkFor(tenantA, tenantA.userId, at(DAY, 11, 0), { is_overbooked: true });
    // No API role can do this (the grant is closed): the service role stands for a data repair gone wrong.
    expect((await admin.from("visits").update({ doctor_id: receptionist.userId }).eq("id", visitId)).error).toBeNull();
    expect((await post(token, at(DAY, 11, 30))).status).toBe(409);
    expect((await get(token, DAY)).status).toBe(200); // no slots are listed for a non-clinician
    expect(await slotsOf(token, DAY)).toEqual([]);
});
});

