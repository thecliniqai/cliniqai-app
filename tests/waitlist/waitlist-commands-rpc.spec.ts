/**
 * V2-08 08-04a (R-15): `public.add_to_waitlist` and `public.promote_waitlist_entry`, the two waitlist writes as atomic commands.
 *
 * add_to_waitlist: the entry (patient and doctor in the clinic, priority 0-10, bounded window and note) and its `waitlist.add`
 * audit row. promote_waitlist_entry: a waiting entry becomes a booked visit in a chosen future slot (the booking's slot rules;
 * the entry's doctor, else p_doctor_id), the entry is marked promoted, `waitlist.promote` and `visit.auto_promoted_from_waitlist`
 * audit rows. SECURITY DEFINER; appointments:edit. Rows are seeded and read with the service-role client. Synthetic data only.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import { mapDbError } from "@/lib/db/errors";
import { hasPerm } from "@/lib/permissions";
import type { UserRole } from "@/lib/db/types";
import { addToWaitlist, promoteWaitlistEntry } from "@/features/waitlist/service";
import { addMemberToTenant, createDualMembershipUser, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { getAdminClient } from "../helpers/supabase-admin";
import type { TestDb } from "../helpers/db";
import { ctxFor } from "../helpers/context";
import { signInActingIn } from "../helpers/active-tenant";
import { leftoverFaults, withFault } from "../helpers/fault";
import { expectCommandCatalog } from "../helpers/command-catalog";
import { auditRows, commandResultRows, expectDataOnlyStoredResult } from "../helpers/billing-commands";
import { seedBlock, seedBookedVisit, seedPatient, visitsOfPatient } from "../helpers/front-desk-commands";
import {
  addToWaitlistArgs,
  callAddToWaitlist,
  callPromote,
  ist,
  promoteArgs,
  seedWaitlistEntry,
  waitlistRow,
} from "../helpers/scheduling-commands";

const ROLES: UserRole[] = ["owner", "admin", "doctor", "nurse", "receptionist"];

let tenantA: SeededTenant;
let tenantB: SeededTenant;
let docB: SeededTenant;
const members = {} as Record<UserRole, SeededTenant>;

let freshWeek = 80;
const nextWeek = () => freshWeek++;
const date = (offset = 4) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const anonClient = () =>
  createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  }) as TestDb;

beforeAll(async () => {
  tenantA = await seedTenantWithOwner("CI Waitlist Clinic A");
  tenantB = await seedTenantWithOwner("CI Waitlist Clinic B");
  members.owner = tenantA;
  for (const role of ROLES.filter((r) => r !== "owner")) members[role] = await addMemberToTenant(tenantA.tenantId, role);
  docB = await addMemberToTenant(tenantA.tenantId, "doctor");
});

afterAll(() => {
  expect(leftoverFaults()).toBe(0);
});

describe("waitlist commands: catalog", () => {
  it("are DEFINER with the pinned settings, EXECUTE for authenticated only, and a required p_client_request_id", () => {
    expectCommandCatalog({ signature: "public.add_to_waitlist(uuid, uuid, date, uuid, uuid, text, integer, text)", definer: true });
    expectCommandCatalog({ signature: "public.promote_waitlist_entry(uuid, uuid, timestamptz, uuid, uuid, integer, boolean)", definer: true });
  });
});

describe("add_to_waitlist", () => {
  it("adds the entry with its audit row and claim in one transaction", async () => {
    const patient = await seedPatient(tenantA);
    const args = addToWaitlistArgs(tenantA, patient, date(4), {
      p_doctor_id: docB.userId,
      p_time_window: "Morning (9 AM - 1 PM)",
      p_priority: 5,
      p_notes: "Synthetic: flexible timing",
    });
    const { data, error } = await callAddToWaitlist(members.receptionist.client, args);
    expect(error).toBeNull();
    const { entry_id } = data as { entry_id: string };
    expect(data).toEqual({ entry_id, replayed: false });
    expect(await waitlistRow(entry_id)).toMatchObject({
      status: "waiting",
      patient_id: patient,
      doctor_id: docB.userId,
      priority: 5,
      time_window: "Morning (9 AM - 1 PM)",
      notes: "Synthetic: flexible timing",
      target_date: date(4),
    });
    const { data: row } = await getAdminClient().from("waitlist_entries").select("created_by, tenant_id").eq("id", entry_id).single();
    expect(row).toMatchObject({ created_by: members.receptionist.userId, tenant_id: tenantA.tenantId });
    expect(await auditRows(tenantA.tenantId, "waitlist.add", entry_id)).toEqual([
      expect.objectContaining({
        actor_id: members.receptionist.userId,
        entity_type: "waitlist",
        metadata: { target_date: date(4), priority: 5 },
      }),
    ]);
    expect(commandResultRows(tenantA.tenantId, args.p_client_request_id)).toEqual(["public.add_to_waitlist|true"]);
    const stored = expectDataOnlyStoredResult(tenantA.tenantId, args.p_client_request_id);
    expect(JSON.stringify(stored)).not.toContain("flexible");
  });

  it("any doctor (no p_doctor_id) is allowed; priority 0 is the default", async () => {
    const res = await callAddToWaitlist(tenantA.client, addToWaitlistArgs(tenantA, await seedPatient(tenantA), date()));
    expect(res.error).toBeNull();
    expect(await waitlistRow((res.data as { entry_id: string }).entry_id)).toMatchObject({ doctor_id: null, priority: 0, notes: null, time_window: null });
  });

  it("input: a priority outside 0-10, a window over 100 and a note over 500 characters, a missing patient or date are INPUT_INVALID", async () => {
    const patient = await seedPatient(tenantA);
    const bad = [
      { p_priority: 11 },
      { p_priority: -1 },
      { p_time_window: "w".repeat(101) },
      { p_notes: "n".repeat(501) },
      { p_patient_id: null as unknown as string },
      { p_target_date: null as unknown as string },
    ];
    for (const over of bad) {
      const res = await callAddToWaitlist(tenantA.client, addToWaitlistArgs(tenantA, patient, date(), over));
      expect(res.error, JSON.stringify(over).slice(0, 40)).toMatchObject({ code: "P0001", message: "INPUT_INVALID" });
    }
    expect((await callAddToWaitlist(tenantA.client, addToWaitlistArgs(tenantA, patient, date(), { p_client_request_id: null as unknown as string }))).error).toMatchObject({
      message: "CLIENT_REQUEST_ID_REQUIRED",
    });
  });

  it("a patient or doctor of another clinic, a deleted or erased patient, and a non-clinician doctor are refused and nothing is written", async () => {
    const before = (await getAdminClient().from("waitlist_entries").select("id", { count: "exact", head: true }).eq("tenant_id", tenantA.tenantId)).count;
    const patientB = await seedPatient(tenantB);
    expect((await callAddToWaitlist(tenantA.client, addToWaitlistArgs(tenantA, patientB, date()))).error).toMatchObject({ code: "P0002", message: "PATIENT_NOT_FOUND" });
    const patient = await seedPatient(tenantA);
    expect((await callAddToWaitlist(tenantA.client, addToWaitlistArgs(tenantA, patient, date(), { p_doctor_id: tenantB.userId }))).error).toMatchObject({ code: "P0002", message: "DOCTOR_NOT_FOUND" });
    expect((await callAddToWaitlist(tenantA.client, addToWaitlistArgs(tenantA, patient, date(), { p_doctor_id: members.receptionist.userId }))).error).toMatchObject({ message: "DOCTOR_NOT_FOUND" });
    const deleted = await seedPatient(tenantA);
    await getAdminClient().from("patients").update({ is_deleted: true }).eq("id", deleted);
    expect((await callAddToWaitlist(tenantA.client, addToWaitlistArgs(tenantA, deleted, date()))).error).toMatchObject({ message: "PATIENT_NOT_FOUND" });
    const erased = await seedPatient(tenantA);
    await getAdminClient().from("patients").update({ erased_at: new Date().toISOString(), status: "erased" }).eq("id", erased);
    expect((await callAddToWaitlist(tenantA.client, addToWaitlistArgs(tenantA, erased, date()))).error).toMatchObject({ message: "PATIENT_NOT_FOUND" });
    const after = (await getAdminClient().from("waitlist_entries").select("id", { count: "exact", head: true }).eq("tenant_id", tenantA.tenantId)).count;
    expect(after).toBe(before);
  });

  it("rollback: a fault on the audit insert leaves no entry and no claim; the same id then succeeds", async () => {
    const patient = await seedPatient(tenantA);
    const marker = `CI-FAULT-${randomUUID().slice(0, 8)}`;
    const args = addToWaitlistArgs(tenantA, patient, date(), { p_notes: marker });
    await withFault({ table: "public.waitlist_entries", column: "notes", marker }, async () => {
      const { data, error } = await callAddToWaitlist(tenantA.client, args);
      expect(data).toBeNull();
      expect(error?.code).toBe("XX000");
      const viaService = await addToWaitlist(ctxFor(tenantA), { patient_id: patient, target_date: date(), notes: marker }, randomUUID());
      expect(viaService).toMatchObject({ ok: false, error: { code: "INTERNAL", message: "Failed to update the waitlist." } });
      expect(JSON.stringify(viaService)).not.toContain("SPIKE_FAULT");
    });
    const { data: rows } = await getAdminClient().from("waitlist_entries").select("id").eq("notes", marker);
    expect(rows).toEqual([]);
    expect(commandResultRows(tenantA.tenantId, args.p_client_request_id)).toEqual([]);
  });

  it("the same id twice: one entry, one audit row, replayed: true; every hashed input varied is IDEMPOTENCY_MISMATCH", async () => {
    const patient = await seedPatient(tenantA);
    const args = addToWaitlistArgs(tenantA, patient, date(), { p_doctor_id: tenantA.userId, p_time_window: "AM", p_priority: 2, p_notes: "one" });
    const first = await callAddToWaitlist(tenantA.client, args);
    const second = await callAddToWaitlist(tenantA.client, args);
    expect(second.data).toEqual({ ...(first.data as object), replayed: true });
    expect(await auditRows(tenantA.tenantId, "waitlist.add", (first.data as { entry_id: string }).entry_id)).toHaveLength(1);
    const variants = [
      { p_patient_id: await seedPatient(tenantA) },
      { p_target_date: date(9) },
      { p_doctor_id: docB.userId },
      { p_time_window: "PM" },
      { p_priority: 3 },
      { p_notes: "two" },
    ];
    for (const over of variants) {
      const res = await callAddToWaitlist(tenantA.client, { ...args, ...over });
      expect(mapDbError(res.error), JSON.stringify(over)).toMatchObject({ code: "IDEMPOTENCY_MISMATCH" });
    }
  });

  it("who may call it: every role the matrix gives appointments:edit; anon not; another clinic's patient is NOT_FOUND from A or from a dual user acting in A", async () => {
    for (const role of ROLES) {
      const { error } = await callAddToWaitlist(members[role].client, addToWaitlistArgs(tenantA, await seedPatient(tenantA), date()));
      if (hasPerm(role, "appointments:edit")) expect(error, role).toBeNull();
      else expect(error?.code, role).toBe("42501");
    }
    const patient = await seedPatient(tenantA);
    expect((await callAddToWaitlist(anonClient(), addToWaitlistArgs(tenantA, patient, date()))).error?.code).toBe("42501");

    const patientB = await seedPatient(tenantB);
    for (const named of [tenantA, tenantB]) {
      expect((await callAddToWaitlist(tenantA.client, addToWaitlistArgs(named, patientB, date()))).error).toMatchObject({ code: "P0002", message: "PATIENT_NOT_FOUND" });
    }
    const dual = await createDualMembershipUser(tenantA.tenantId, "receptionist", tenantB.tenantId, "receptionist");
    const actingInA = await signInActingIn(dual.userEmail, tenantA.tenantId);
    for (const named of [tenantB, tenantA]) {
      expect((await callAddToWaitlist(actingInA, addToWaitlistArgs(named, patientB, date()))).error).toMatchObject({ code: "P0002", message: "PATIENT_NOT_FOUND" });
    }
    const actingInB = await signInActingIn(dual.userEmail, tenantB.tenantId);
    expect((await callAddToWaitlist(actingInB, addToWaitlistArgs(tenantB, patientB, date()))).error).toBeNull();
  });
});

describe("promote_waitlist_entry", () => {
  it("books the entry into the chosen slot: visit, entry marked promoted, two audit rows and the claim in one transaction", async () => {
    const week = nextWeek();
    const patient = await seedPatient(tenantA);
    const entry = await seedWaitlistEntry(tenantA, patient, date());
    const at = ist(week, 0, 11, 0);
    const args = promoteArgs(tenantA, entry, at, { p_duration_minutes: 20 });
    const { data, error } = await callPromote(members.receptionist.client, args);
    expect(error).toBeNull();
    const { visit_id } = data as { visit_id: string };
    expect(data).toEqual({ entry_id: entry, visit_id, replayed: false });
    expect(await waitlistRow(entry)).toMatchObject({ status: "promoted", promoted_visit_id: visit_id });
    const [visit] = await visitsOfPatient(patient);
    expect(visit).toMatchObject({
      id: visit_id,
      status: "booked",
      origin_type: "scheduled",
      doctor_id: tenantA.userId,
      estimated_duration_minutes: 20,
      reason_for_visit: "Booked from waitlist",
      is_overbooked: false,
      created_by: members.receptionist.userId,
    });
    expect(new Date(visit.scheduled_at as string).toISOString()).toBe(at);
    expect(await auditRows(tenantA.tenantId, "waitlist.promote", entry)).toEqual([
      expect.objectContaining({ actor_id: members.receptionist.userId, entity_type: "waitlist", metadata: { promoted_visit_id: visit_id } }),
    ]);
    expect(await auditRows(tenantA.tenantId, "visit.auto_promoted_from_waitlist", visit_id)).toEqual([
      expect.objectContaining({ metadata: { promoted_from_waitlist_id: entry, promoted_visit_id: visit_id } }),
    ]);
    expect(commandResultRows(tenantA.tenantId, args.p_client_request_id)).toEqual(["public.promote_waitlist_entry|true"]);
    expectDataOnlyStoredResult(tenantA.tenantId, args.p_client_request_id);
  });

  it("an entry for any doctor needs p_doctor_id (a clinician of the clinic); the entry's own doctor wins over p_doctor_id", async () => {
    const week = nextWeek();
    const anyDoctor = await seedWaitlistEntry(tenantA, await seedPatient(tenantA), date(), { doctor_id: null });
    expect((await callPromote(tenantA.client, promoteArgs(tenantA, anyDoctor, ist(week, 0, 11, 0)))).error).toMatchObject({ message: "INPUT_INVALID" });
    expect((await callPromote(tenantA.client, promoteArgs(tenantA, anyDoctor, ist(week, 0, 11, 0), { p_doctor_id: members.nurse.userId }))).error).toMatchObject({ message: "DOCTOR_NOT_FOUND" });
    const ok = await callPromote(tenantA.client, promoteArgs(tenantA, anyDoctor, ist(week, 0, 11, 0), { p_doctor_id: docB.userId }));
    expect(ok.error).toBeNull();
    const visit = await getAdminClient().from("visits").select("doctor_id").eq("id", (ok.data as { visit_id: string }).visit_id).single();
    expect(visit.data?.doctor_id).toBe(docB.userId);

    const own = await seedWaitlistEntry(tenantA, await seedPatient(tenantA), date(), { doctor_id: tenantA.userId });
    const res = await callPromote(tenantA.client, promoteArgs(tenantA, own, ist(week, 1, 11, 0), { p_doctor_id: docB.userId }));
    const v2 = await getAdminClient().from("visits").select("doctor_id").eq("id", (res.data as { visit_id: string }).visit_id).single();
    expect(v2.data?.doctor_id).toBe(tenantA.userId);
  });

  it("the slot rules of a booking: taken, off duty and blocked are refused (nothing changes); p_overbook skips them", async () => {
    const week = nextWeek();
    const entry = await seedWaitlistEntry(tenantA, await seedPatient(tenantA), date());
    await seedBookedVisit(tenantA, await seedPatient(tenantA), tenantA.userId, ist(week, 0, 11, 0));
    expect((await callPromote(tenantA.client, promoteArgs(tenantA, entry, ist(week, 0, 11, 0)))).error).toMatchObject({ code: "P0001", message: "SLOT_TAKEN" });
    expect((await callPromote(tenantA.client, promoteArgs(tenantA, entry, ist(week, 1, 14, 0)))).error).toMatchObject({ message: "SLOT_OFF_DUTY" });
    await seedBlock(tenantA, ist(week, 2, 11, 0), ist(week, 2, 12, 0), null);
    const blocked = await callPromote(tenantA.client, promoteArgs(tenantA, entry, ist(week, 2, 11, 30)));
    expect(blocked.error).toMatchObject({ message: "SLOT_BLOCKED" });
    expect(mapDbError(blocked.error)).toMatchObject({ code: "CONFLICT", reason: "SLOT_BLOCKED" });
    expect(await waitlistRow(entry)).toMatchObject({ status: "waiting", promoted_visit_id: null });
    const forced = await callPromote(tenantA.client, promoteArgs(tenantA, entry, ist(week, 0, 11, 0), { p_overbook: true }));
    expect(forced.error).toBeNull();
    const row = await getAdminClient().from("visits").select("is_overbooked").eq("id", (forced.data as { visit_id: string }).visit_id).single();
    expect(row.data?.is_overbooked).toBe(true);
  });

  it("a closed entry is WAITLIST_ENTRY_CLOSED, a past slot SLOT_IN_PAST, an unknown entry WAITLIST_ENTRY_NOT_FOUND", async () => {
    const week = nextWeek();
    for (const status of ["promoted", "expired", "cancelled"]) {
      const closed = await seedWaitlistEntry(tenantA, await seedPatient(tenantA), date(), { status });
      const res = await callPromote(tenantA.client, promoteArgs(tenantA, closed, ist(week, 0, 11, 0)));
      expect(res.error, status).toMatchObject({ code: "P0001", message: "WAITLIST_ENTRY_CLOSED" });
      expect(mapDbError(res.error)).toMatchObject({ code: "CONFLICT", reason: "WAITLIST_ENTRY_CLOSED" });
    }
    const entry = await seedWaitlistEntry(tenantA, await seedPatient(tenantA), date());
    expect((await callPromote(tenantA.client, promoteArgs(tenantA, entry, new Date(Date.now() - 3_600_000).toISOString()))).error).toMatchObject({ message: "SLOT_IN_PAST" });
    expect((await callPromote(tenantA.client, promoteArgs(tenantA, randomUUID(), ist(week, 0, 11, 0)))).error).toMatchObject({ code: "P0002", message: "WAITLIST_ENTRY_NOT_FOUND" });
    expect(await waitlistRow(entry)).toMatchObject({ status: "waiting" });
  });

  it("rollback: a fault on the entry's update leaves no visit and the entry waiting; the same id then succeeds", async () => {
    const week = nextWeek();
    const marker = `CI-FAULT-${randomUUID().slice(0, 8)}`;
    const patient = await seedPatient(tenantA);
    const entry = await seedWaitlistEntry(tenantA, patient, date(), { notes: marker });
    const args = promoteArgs(tenantA, entry, ist(week, 0, 11, 0));
    await withFault({ table: "public.waitlist_entries", column: "notes", marker, event: "update", and: { column: "status", value: "promoted" } }, async () => {
      const { data, error } = await callPromote(tenantA.client, args);
      expect(data).toBeNull();
      expect(error?.code).toBe("XX000");
      const viaService = await promoteWaitlistEntry(ctxFor(tenantA), { entry_id: entry, scheduled_at: ist(week, 0, 11, 0) }, randomUUID());
      expect(viaService).toMatchObject({ ok: false, error: { code: "INTERNAL", message: "Failed to update the waitlist." } });
    });
    expect(await visitsOfPatient(patient)).toEqual([]);
    expect(await waitlistRow(entry)).toMatchObject({ status: "waiting" });
    expect(commandResultRows(tenantA.tenantId, args.p_client_request_id)).toEqual([]);
    expect((await callPromote(tenantA.client, args)).error).toBeNull();
    expect((await waitlistRow(entry)).status).toBe("promoted");
  });

  it("the same id twice: one visit, replayed: true; every hashed input varied is IDEMPOTENCY_MISMATCH", async () => {
    const week = nextWeek();
    const entry = await seedWaitlistEntry(tenantA, await seedPatient(tenantA), date());
    const args = promoteArgs(tenantA, entry, ist(week, 0, 11, 0), { p_doctor_id: tenantA.userId, p_duration_minutes: 15 });
    const first = await callPromote(tenantA.client, args);
    expect((await callPromote(tenantA.client, args)).data).toEqual({ ...(first.data as object), replayed: true });
    expect(await auditRows(tenantA.tenantId, "waitlist.promote", entry)).toHaveLength(1);
    const variants = [
      { p_entry_id: await seedWaitlistEntry(tenantA, await seedPatient(tenantA), date()) },
      { p_scheduled_at: ist(week, 3, 11, 0) },
      { p_doctor_id: docB.userId },
      { p_duration_minutes: 30 },
      { p_overbook: true },
    ];
    for (const over of variants) {
      expect(mapDbError((await callPromote(tenantA.client, { ...args, ...over })).error), JSON.stringify(over).slice(0, 40)).toMatchObject({ code: "IDEMPOTENCY_MISMATCH" });
    }
  });

  it("two desks promoting one entry (different ids): one visit; the other is WAITLIST_ENTRY_CLOSED", async () => {
    const week = nextWeek();
    const patient = await seedPatient(tenantA);
    const entry = await seedWaitlistEntry(tenantA, patient, date());
    const [x, y] = await Promise.all([
      callPromote(members.receptionist.client, promoteArgs(tenantA, entry, ist(week, 0, 11, 0))),
      callPromote(members.owner.client, promoteArgs(tenantA, entry, ist(week, 1, 11, 0))),
    ]);
    expect([x.error?.message, y.error?.message].filter(Boolean)).toEqual(["WAITLIST_ENTRY_CLOSED"]);
    expect(await visitsOfPatient(patient)).toHaveLength(1);
  });

  it("who may call it: roles per the matrix; anon not; another clinic's entry is NOT_FOUND from A or from a dual user acting in A", async () => {
    for (const role of ROLES) {
      const week = nextWeek();
      const own = await seedWaitlistEntry(tenantA, await seedPatient(tenantA), date());
      const { error } = await callPromote(members[role].client, promoteArgs(tenantA, own, ist(week, 0, 11, 0)));
      if (hasPerm(role, "appointments:edit")) expect(error, role).toBeNull();
      else expect(error?.code, role).toBe("42501");
    }
    const entryB = await seedWaitlistEntry(tenantB, await seedPatient(tenantB), date(), { doctor_id: tenantB.userId });
    const week = nextWeek();
    expect((await callPromote(anonClient(), promoteArgs(tenantA, entryB, ist(week, 0, 11, 0)))).error?.code).toBe("42501");
    for (const named of [tenantA, tenantB]) {
      expect((await callPromote(tenantA.client, promoteArgs(named, entryB, ist(week, 0, 11, 0)))).error).toMatchObject({ code: "P0002", message: "WAITLIST_ENTRY_NOT_FOUND" });
    }
    const dual = await createDualMembershipUser(tenantA.tenantId, "receptionist", tenantB.tenantId, "receptionist");
    const actingInA = await signInActingIn(dual.userEmail, tenantA.tenantId);
    for (const named of [tenantB, tenantA]) {
      expect((await callPromote(actingInA, promoteArgs(named, entryB, ist(week, 0, 11, 0)))).error).toMatchObject({ code: "P0002", message: "WAITLIST_ENTRY_NOT_FOUND" });
    }
    expect((await waitlistRow(entryB)).status).toBe("waiting");
    const actingInB = await signInActingIn(dual.userEmail, tenantB.tenantId);
    expect((await callPromote(actingInB, promoteArgs(tenantB, entryB, ist(week, 0, 11, 0)))).error).toBeNull();
  });
});

describe("waitlist services", () => {
  it("addToWaitlist and promoteWaitlistEntry replay on the same id and refuse bad input with fixed texts", async () => {
    const week = nextWeek();
    const patient = await seedPatient(tenantA);
    const id = randomUUID();
    const input = { patient_id: patient, doctor_id: tenantA.userId, target_date: date(), priority: 1 };
    const first = await addToWaitlist(ctxFor(members.receptionist), input, id);
    expect(first).toMatchObject({ ok: true, value: { replayed: false } });
    expect(await addToWaitlist(ctxFor(members.receptionist), input, id)).toMatchObject({ ok: true, value: { replayed: true } });
    expect(await addToWaitlist(ctxFor(tenantA), { ...input, target_date: "tomorrow" }, randomUUID())).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
    expect(await addToWaitlist(ctxFor(tenantA), { ...input, priority: 11 }, randomUUID())).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
    expect(await addToWaitlist(ctxFor(tenantA), input, "nope")).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });

    const entryId = (first as { ok: true; value: { entryId: string } }).value.entryId;
    const promoted = await promoteWaitlistEntry(ctxFor(tenantA), { entry_id: entryId, scheduled_at: ist(week, 0, 11, 0) }, randomUUID());
    expect(promoted).toMatchObject({ ok: true, value: { entryId, replayed: false } });
    expect(await promoteWaitlistEntry(ctxFor(tenantA), { entry_id: entryId, scheduled_at: ist(week, 1, 11, 0) }, randomUUID())).toMatchObject({
      ok: false,
      error: { code: "CONFLICT", reason: "WAITLIST_ENTRY_CLOSED", message: "This waitlist entry is no longer waiting." },
    });
    expect(await promoteWaitlistEntry(ctxFor(tenantA), { entry_id: "nope", scheduled_at: ist(week, 1, 11, 0) }, randomUUID())).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
  });
});
