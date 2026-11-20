/**
 * V2-07 07-03 (R-8, PR-7): `public.available_slots(p_doctor_id, p_date)` and its server function `getAvailableSlots`.
 *
 * The doctor's free slots on a clinic-local date: back-to-back slots of the doctor's slot length inside the weekly shifts,
 * minus schedule blocks (the doctor's and clinic-wide) and booked, non-overbooked scheduled visits, all read in the
 * clinic's time zone (`tenants.timezone`). SECURITY INVOKER (RLS and appointments:view apply). Each test gets its own
 * doctor, so schedules, blocks and bookings never interfere. Synthetic data only.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import { hasPerm } from "@/lib/permissions";
import type { UserRole } from "@/lib/db/types";
import { AVAILABLE_SLOTS_MESSAGES, getAvailableSlots } from "@/features/visits/scheduling-service";
import { addMemberToTenant, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { getAdminClient } from "../helpers/supabase-admin";
import type { TestDb } from "../helpers/db";
import { ctxFor } from "../helpers/context";
import { psql } from "../helpers/sql";
import { seedBlock, seedBookedVisit, seedPatient, setSchedule, weekSchedule } from "../helpers/front-desk-commands";

const ROLES: UserRole[] = ["owner", "admin", "doctor", "nurse", "receptionist"];

let tenantA: SeededTenant;
let tenantB: SeededTenant;
let tenantNy: SeededTenant;
let patientA: string;
const members = {} as Record<UserRole, SeededTenant>;

// Tuesday 4 Mar 2031 (IST).
const DAY = "2031-03-04";
// The clinic-wide block of one test sits on its own date, so it never touches the other tests' doctors.
const BLOCK_DAY = "2031-03-11";

/** The instant of wall-clock `h:mm` on `day` (YYYY-MM-DD) in a zone `offsetMinutes` east of UTC. */
function at(day: string, h: number, mm: number, offsetMinutes = 330): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, h, mm) - offsetMinutes * 60_000).toISOString();
}

async function slotsOf(db: TestDb, doctorId: string, date = DAY): Promise<Array<[string, string]>> {
  const { data, error } = await db.rpc("available_slots", { p_doctor_id: doctorId, p_date: date });
  expect(error).toBeNull();
  return (data ?? []).map((r) => [new Date(r.slot_start).toISOString(), new Date(r.slot_end).toISOString()] as [string, string]);
}

async function newDoctor(t: SeededTenant, schedule: unknown, slotMinutes = 15): Promise<SeededTenant> {
  const doc = await addMemberToTenant(t.tenantId, "doctor");
  await setSchedule(t.tenantId, doc.userId, schedule, slotMinutes);
  return doc;
}

const starts = (slots: Array<[string, string]>) => slots.map(([s]) => s);

beforeAll(async () => {
  tenantA = await seedTenantWithOwner("CI Slots Clinic A");
  tenantB = await seedTenantWithOwner("CI Slots Clinic B");
  tenantNy = await seedTenantWithOwner("CI Slots New York Clinic");
  members.owner = tenantA;
  for (const role of ROLES.filter((r) => r !== "owner")) members[role] = await addMemberToTenant(tenantA.tenantId, role);
  patientA = await seedPatient(tenantA);
  const { error } = await getAdminClient().from("tenants").update({ timezone: "America/New_York" }).eq("id", tenantNy.tenantId);
  if (error) throw new Error(`seed timezone failed: ${error.message}`);
});

describe("available_slots: catalog", () => {
  it("is STABLE SECURITY INVOKER with a pinned search_path, EXECUTE for authenticated only", () => {
    const sig = "'public.available_slots(uuid, date)'::regprocedure";
    expect(psql(`select prosecdef::text || ',' || provolatile::text || ',' || array_to_string(proconfig, ';') from pg_proc where oid = ${sig}`)).toEqual(['false,s,search_path=""']);
    expect(psql(`select has_function_privilege('anon', ${sig}, 'EXECUTE')::text || ',' || has_function_privilege('authenticated', ${sig}, 'EXECUTE')::text || ',' || has_function_privilege('service_role', ${sig}, 'EXECUTE')::text`)).toEqual([
      "false,true,false",
    ]);
  });
});

describe("available_slots: shifts", () => {
  it("lists back-to-back slots of the doctor's slot length inside each shift, in order", async () => {
    const doc = await newDoctor(tenantA, weekSchedule([{ start: "10:00", end: "11:00" }, { start: "17:00", end: "17:30" }]));
    const slots = await slotsOf(tenantA.client, doc.userId);
    expect(slots).toEqual([
      [at(DAY, 10, 0), at(DAY, 10, 15)],
      [at(DAY, 10, 15), at(DAY, 10, 30)],
      [at(DAY, 10, 30), at(DAY, 10, 45)],
      [at(DAY, 10, 45), at(DAY, 11, 0)],
      [at(DAY, 17, 0), at(DAY, 17, 15)],
      [at(DAY, 17, 15), at(DAY, 17, 30)],
    ]);
  });

  it("uses the doctor's slot length, and drops a last slot that does not fit the shift", async () => {
    const doc = await newDoctor(tenantA, weekSchedule([{ start: "10:00", end: "11:45" }]), 30);
    const slots = await slotsOf(tenantA.client, doc.userId);
    expect(starts(slots)).toEqual([at(DAY, 10, 0), at(DAY, 10, 30), at(DAY, 11, 0)]);
    for (const [s, e] of slots) expect(new Date(e).getTime() - new Date(s).getTime()).toBe(30 * 60_000);
  });

  it("a day off, a shift-less day and a doctor without a stored schedule have no slots", async () => {
    const off = await newDoctor(tenantA, weekSchedule([{ start: "10:00", end: "12:00" }], { sunday: false }));
    expect(await slotsOf(tenantA.client, off.userId, "2031-03-09")).toEqual([]); // Sunday
    const empty = await newDoctor(tenantA, weekSchedule([]));
    expect(await slotsOf(tenantA.client, empty.userId)).toEqual([]);
    const none = await newDoctor(tenantA, null);
    expect(await slotsOf(tenantA.client, none.userId)).toEqual([]);
  });

  it("the weekday is the clinic-local weekday of the date given", async () => {
    const schedule = { ...weekSchedule([]), wednesday: { enabled: true, shifts: [{ start: "09:00", end: "09:30" }] } };
    const doc = await newDoctor(tenantA, schedule);
    expect(await slotsOf(tenantA.client, doc.userId, "2031-03-04")).toEqual([]); // Tuesday
    expect(starts(await slotsOf(tenantA.client, doc.userId, "2031-03-05"))).toEqual([at("2031-03-05", 9, 0), at("2031-03-05", 9, 15)]);
  });
});

describe("available_slots: blocks and bookings", () => {
  it("removes the slots a block of the doctor, or a clinic-wide block, overlaps (the block is half-open)", async () => {
    const doc = await newDoctor(tenantA, weekSchedule([{ start: "10:00", end: "11:30" }]));
    const other = await newDoctor(tenantA, weekSchedule([{ start: "10:00", end: "11:30" }]));
    await seedBlock(tenantA, at(BLOCK_DAY, 10, 20), at(BLOCK_DAY, 10, 45), doc.userId); // overlaps 10:15 and 10:30
    await seedBlock(tenantA, at(BLOCK_DAY, 11, 0), at(BLOCK_DAY, 11, 15), null); // clinic-wide: 11:00
    await seedBlock(tenantA, at(BLOCK_DAY, 10, 0), at(BLOCK_DAY, 10, 15), other.userId); // another doctor's block
    expect(starts(await slotsOf(tenantA.client, doc.userId, BLOCK_DAY))).toEqual([
      at(BLOCK_DAY, 10, 0),
      at(BLOCK_DAY, 10, 45),
      at(BLOCK_DAY, 11, 15),
    ]);
    // The other doctor's own block removes 10:00 and the clinic-wide one 11:00; the first doctor's block is not theirs.
    expect(starts(await slotsOf(tenantA.client, other.userId, BLOCK_DAY))).toEqual([
      at(BLOCK_DAY, 10, 15),
      at(BLOCK_DAY, 10, 30),
      at(BLOCK_DAY, 10, 45),
      at(BLOCK_DAY, 11, 15),
    ]);
  });

  it("removes the slots a booked visit overlaps; cancelled, no-show, overbooked and walk-in visits do not hold a slot", async () => {
    const doc = await newDoctor(tenantA, weekSchedule([{ start: "10:00", end: "12:00" }]));
    await seedBookedVisit(tenantA, patientA, doc.userId, at(DAY, 10, 0), { estimated_duration_minutes: 20 }); // 10:00-10:20 -> 10:00, 10:15
    await seedBookedVisit(tenantA, patientA, doc.userId, at(DAY, 10, 30), { status: "cancelled" });
    await seedBookedVisit(tenantA, patientA, doc.userId, at(DAY, 10, 45), { status: "no_show" });
    await seedBookedVisit(tenantA, patientA, doc.userId, at(DAY, 11, 0), { is_overbooked: true });
    await seedBookedVisit(tenantA, patientA, doc.userId, at(DAY, 11, 15), { origin_type: "walk_in", status: "waiting" });
    await seedBookedVisit(tenantA, patientA, doc.userId, at(DAY, 11, 30), { status: "confirmed", estimated_duration_minutes: 30 }); // 11:30, 11:45
    expect(starts(await slotsOf(tenantA.client, doc.userId))).toEqual([
      at(DAY, 10, 30),
      at(DAY, 10, 45),
      at(DAY, 11, 0),
      at(DAY, 11, 15),
    ]);
  });

  it("a visit of another doctor, or of another clinic's doctor, does not matter", async () => {
    const doc = await newDoctor(tenantA, weekSchedule([{ start: "10:00", end: "10:30" }]));
    const other = await newDoctor(tenantA, weekSchedule([{ start: "10:00", end: "10:30" }]));
    await seedBookedVisit(tenantA, patientA, other.userId, at(DAY, 10, 0));
    expect(await slotsOf(tenantA.client, doc.userId)).toHaveLength(2);
    expect(await slotsOf(tenantA.client, other.userId)).toHaveLength(1);
  });
});

describe("available_slots: the clinic's time zone", () => {
  it("a shift just after midnight IST sits on the previous UTC date and is listed under its clinic-local date", async () => {
    const doc = await newDoctor(tenantA, weekSchedule([{ start: "00:30", end: "01:15" }]));
    const slots = await slotsOf(tenantA.client, doc.userId, DAY);
    // Tue 4 Mar 00:30 IST is Mon 3 Mar 19:00Z: the UTC date of the first slot is NOT the clinic date.
    expect(starts(slots)).toEqual([at(DAY, 0, 30), at(DAY, 0, 45), at(DAY, 1, 0)]);
    expect(starts(slots)[0].slice(0, 10)).toBe("2031-03-03");
    // Nothing leaks onto the neighbouring clinic dates.
    expect(starts(await slotsOf(tenantA.client, doc.userId, "2031-03-03"))).toEqual([at("2031-03-03", 0, 30), at("2031-03-03", 0, 45), at("2031-03-03", 1, 0)]);
    // A booking at 00:45 IST (19:15Z the day before) removes exactly the 00:45 slot of the IST date.
    await seedBookedVisit(tenantA, patientA, doc.userId, at(DAY, 0, 45));
    expect(starts(await slotsOf(tenantA.client, doc.userId, DAY))).toEqual([at(DAY, 0, 30), at(DAY, 1, 0)]);
  });

  it("a block entered in UTC is applied at its clinic-local time (a UTC-dated block hits the IST early morning)", async () => {
    const doc = await newDoctor(tenantA, weekSchedule([{ start: "00:30", end: "01:15" }]));
    await seedBlock(tenantA, "2031-03-03T19:15:00.000Z", "2031-03-03T19:30:00.000Z", doc.userId); // 00:45-01:00 IST on 4 Mar
    expect(starts(await slotsOf(tenantA.client, doc.userId, DAY))).toEqual([at(DAY, 0, 30), at(DAY, 1, 0)]);
  });

  it("another zone: a New York clinic lists 10:00 EST (15:00Z), and the same date in IST would differ", async () => {
    const doc = await newDoctor(tenantNy, weekSchedule([{ start: "10:00", end: "10:30" }]));
    const slots = await slotsOf(tenantNy.client, doc.userId, "2031-01-15");
    expect(starts(slots)).toEqual([at("2031-01-15", 10, 0, -300), at("2031-01-15", 10, 15, -300)]);
    expect(starts(slots)[0]).toBe("2031-01-15T15:00:00.000Z");
  });
});

describe("available_slots: who sees what", () => {
  it("another clinic's doctor, a non-doctor member of the wrong clinic and an unknown id have no slots", async () => {
    const docB = await newDoctor(tenantB, weekSchedule([{ start: "10:00", end: "11:00" }]));
    expect(await slotsOf(tenantB.client, docB.userId)).toHaveLength(4);
    expect(await slotsOf(tenantA.client, docB.userId)).toEqual([]);
    expect(await slotsOf(tenantA.client, "00000000-0000-4000-8000-000000000999")).toEqual([]);
  });

  it("a removed (suspended) doctor has no slots", async () => {
    const doc = await newDoctor(tenantA, weekSchedule([{ start: "10:00", end: "11:00" }]));
    await getAdminClient().from("memberships").update({ status: "suspended" }).eq("tenant_id", tenantA.tenantId).eq("user_id", doc.userId);
    expect(await slotsOf(tenantA.client, doc.userId)).toEqual([]);
  });

  it.each(ROLES)("%s: allowed exactly when the matrix grants appointments:view", async (role) => {
    const doc = await newDoctor(tenantA, weekSchedule([{ start: "10:00", end: "10:30" }]));
    const { data, error } = await members[role].client.rpc("available_slots", { p_doctor_id: doc.userId, p_date: DAY });
    if (hasPerm(role, "appointments:view")) {
      expect(error).toBeNull();
      expect(data).toHaveLength(2);
    } else {
      expect(error?.code).toBe("42501");
    }
  });

  it("anon cannot execute it (42501)", async () => {
    const anon = createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    }) as TestDb;
    const { data, error } = await anon.rpc("available_slots", { p_doctor_id: tenantA.userId, p_date: DAY });
    expect(data).toBeNull();
    expect(error?.code).toBe("42501");
  });
});

describe("getAvailableSlots (service)", () => {
  it("returns ISO start/end pairs; a bad doctor id or date is a validation failure with a fixed text", async () => {
    const doc = await newDoctor(tenantA, weekSchedule([{ start: "10:00", end: "10:30" }]));
    expect(await getAvailableSlots(ctxFor(members.receptionist), doc.userId, DAY)).toEqual({
      ok: true,
      value: [
        { start: at(DAY, 10, 0), end: at(DAY, 10, 15) },
        { start: at(DAY, 10, 15), end: at(DAY, 10, 30) },
      ],
    });
    for (const [d, date] of [["not-a-uuid", DAY], [doc.userId, "2031-3-4"], [doc.userId, "04/03/2031"]]) {
      expect(await getAvailableSlots(ctxFor(tenantA), d, date)).toMatchObject({
        ok: false,
        error: { code: "VALIDATION_FAILED", message: AVAILABLE_SLOTS_MESSAGES.VALIDATION_FAILED },
      });
    }
  });

  it("an impossible calendar date is refused, not answered with a database error text", async () => {
    const res = await getAvailableSlots(ctxFor(tenantA), tenantA.userId, "2031-02-31");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.message).not.toMatch(/date\/time|out of range/i);
  });
});
