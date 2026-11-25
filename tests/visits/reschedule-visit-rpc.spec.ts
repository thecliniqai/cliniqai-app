/**
 * V2-08 08-04a (R-7, R-15): `public.reschedule_visit`, moving a booked, confirmed or missed appointment as one atomic command.
 *
 * The slot check (the register_and_book rules in the clinic's zone; the visit never conflicts with itself), the new time,
 * doctor and duration, the status back to `booked` (the confirmation is cleared; a no-show is rebooked), the `visit.reschedule`
 * audit row, the optional `appointment_rescheduled` message and the `appointment.rescheduled` webhook event commit together or
 * not at all. SECURITY DEFINER; appointments:edit. Rows are seeded and read with the service-role client. Synthetic data only.
 *
 * Every slot is in March 2031 (IST), on its own week per test, inside the default hours of a new doctor (Mon-Sat 10:00-13:00 and
 * 17:00-21:00) unless a test says otherwise.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import { mapDbError } from "@/lib/db/errors";
import { hasPerm } from "@/lib/permissions";
import type { UserRole } from "@/lib/db/types";
import { rescheduleVisit } from "@/features/visits/scheduling-service";
import { addMemberToTenant, createDualMembershipUser, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { getAdminClient } from "../helpers/supabase-admin";
import type { TestDb } from "../helpers/db";
import { ctxFor } from "../helpers/context";
import { signInActingIn } from "../helpers/active-tenant";
import { leftoverFaults, withFault } from "../helpers/fault";
import { expectCommandCatalog } from "../helpers/command-catalog";
import { auditRows, commandResultRows, expectDataOnlyStoredResult } from "../helpers/billing-commands";
import { outboxRows } from "../helpers/clinical-commands";
import { messagesOfVisit, seedBlock, seedBookedVisit, seedPatient } from "../helpers/front-desk-commands";
import { callReschedule, ist, rescheduleArgs, schedRow, subscribeAppointmentEvents } from "../helpers/scheduling-commands";

const ROLES: UserRole[] = ["owner", "admin", "doctor", "nurse", "receptionist"];
const SIGNATURE = "public.reschedule_visit(uuid, uuid, timestamptz, uuid, uuid, integer, boolean, boolean, boolean, boolean, bigint)";

let tenantA: SeededTenant;
let tenantB: SeededTenant;
let docB: SeededTenant;
const members = {} as Record<UserRole, SeededTenant>;

let freshWeek = 30;
/** A week of March 2031 no other test of this file uses (the table-driven cases each need their own slots). */
const nextWeek = () => freshWeek++;

/** A booked visit of the owner (or `doctorId`) at `at`. */
async function booked(at: string, over: Record<string, unknown> = {}, doctorId = tenantA.userId): Promise<string> {
  return seedBookedVisit(tenantA, await seedPatient(tenantA), doctorId, at, over);
}

beforeAll(async () => {
  tenantA = await seedTenantWithOwner("CI Reschedule Clinic A");
  tenantB = await seedTenantWithOwner("CI Reschedule Clinic B");
  members.owner = tenantA;
  for (const role of ROLES.filter((r) => r !== "owner")) members[role] = await addMemberToTenant(tenantA.tenantId, role);
  docB = await addMemberToTenant(tenantA.tenantId, "doctor");
  const admin = getAdminClient();
  await admin.from("memberships").update({ full_name: "Asha Rao" }).eq("tenant_id", tenantA.tenantId).eq("user_id", tenantA.userId);
  await admin.from("memberships").update({ full_name: "Dr. Meera Iyer" }).eq("tenant_id", tenantA.tenantId).eq("user_id", docB.userId);
});

afterAll(() => {
  expect(leftoverFaults()).toBe(0);
});

describe("reschedule_visit: catalog", () => {
  it("is DEFINER with the pinned settings, EXECUTE for authenticated only, and a required p_client_request_id", () => {
    expectCommandCatalog({ signature: SIGNATURE, definer: true });
  });
});

describe("reschedule_visit: one transaction", () => {
  it("moves the visit, writes the audit row, the message, the webhook event and the claim together", async () => {
    const subscription = await subscribeAppointmentEvents(tenantA);
    const visitId = await booked(ist(0, 0, 11, 0));
    const to = ist(0, 1, 11, 30); // Tue 4 Mar 2031, 11:30 IST
    const args = rescheduleArgs(tenantA, visitId, to, { p_duration_minutes: 20, p_notify: true });
    const { data, error } = await callReschedule(members.receptionist.client, args);
    expect(error).toBeNull();
    expect(data).toEqual({ visit_id: visitId, is_overbooked: false, message_enqueued: true, replayed: false, row_version: expect.any(Number) });

    const row = await schedRow(visitId);
    expect(row).toMatchObject({ status: "booked", doctor_id: tenantA.userId, estimated_duration_minutes: 20, is_overbooked: false });
    expect(new Date(row.scheduled_at as string).toISOString()).toBe(to);

    expect(await auditRows(tenantA.tenantId, "visit.reschedule", visitId)).toEqual([
      expect.objectContaining({
        actor_id: members.receptionist.userId,
        actor_role: "receptionist",
        entity_type: "visit",
        metadata: {
          old_status: "booked",
          new_status: "booked",
          is_overbooked: false,
          old_scheduled_at: "2031-03-03T05:30:00Z",
          new_scheduled_at: "2031-03-04T06:00:00Z",
        },
      }),
    ]);

    const [message] = await messagesOfVisit(visitId);
    expect(message).toMatchObject({
      tenant_id: tenantA.tenantId,
      channel: "whatsapp",
      message_type: "appointment_rescheduled",
      template_id: "appointment_rescheduled",
      template_params: { patient_name: "Synthetic Desk Patient", doctor_name: "Dr. Asha Rao", new_date_time: "4 Mar 2031, 11:30 am" },
      dedupe_key: `member:${members.receptionist.userId}:appointment_rescheduled:${visitId}:${Math.floor(Date.parse(to) / 1000)}`,
      created_by: members.receptionist.userId,
    });

    const events = await outboxRows(tenantA.tenantId, "appointment.rescheduled", visitId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ subscription_id: subscription });

    expect(commandResultRows(tenantA.tenantId, args.p_client_request_id)).toEqual(["public.reschedule_visit|true"]);
    expectDataOnlyStoredResult(tenantA.tenantId, args.p_client_request_id);
  });

  it("without p_notify no message is queued; a patient without a usable mobile number gets none either, and the move stands", async () => {
    const quiet = await booked(ist(1, 0, 11, 0));
    const res = await callReschedule(tenantA.client, rescheduleArgs(tenantA, quiet, ist(1, 1, 11, 0)));
    expect(res.data).toMatchObject({ message_enqueued: false });
    expect(await messagesOfVisit(quiet)).toEqual([]);

    const noMobile = await seedBookedVisit(tenantA, await seedPatient(tenantA, { phone: "+910000000000" }), tenantA.userId, ist(1, 0, 12, 0));
    const res2 = await callReschedule(tenantA.client, rescheduleArgs(tenantA, noMobile, ist(1, 1, 12, 0), { p_notify: true }));
    expect(res2.error).toBeNull();
    expect(res2.data).toMatchObject({ message_enqueued: false });
    expect(await messagesOfVisit(noMobile)).toEqual([]);
    expect((await schedRow(noMobile)).status).toBe("booked");
  });

  it("a confirmed visit goes back to booked and loses its confirmation (other metadata stays)", async () => {
    const visitId = await booked(ist(2, 0, 11, 0), {
      status: "confirmed",
      metadata: { clinic_confirmed: true, confirmed_at: "2031-03-01T00:00:00Z", confirmed_by: tenantA.userId, confirmed_via: "staff_calendar", patient_confirmed: true, note: "keep" },
    });
    const res = await callReschedule(tenantA.client, rescheduleArgs(tenantA, visitId, ist(2, 1, 11, 0)));
    expect(res.error).toBeNull();
    expect(await schedRow(visitId)).toMatchObject({ status: "booked", metadata: { note: "keep" } });
    expect(await auditRows(tenantA.tenantId, "visit.reschedule", visitId)).toEqual([
      expect.objectContaining({ metadata: expect.objectContaining({ old_status: "confirmed", new_status: "booked" }) }),
    ]);
  });

  it("a no-show is rebooked (no_show -> booked) and holds its new slot", async () => {
    const visitId = await booked(ist(3, 0, 11, 0), { status: "no_show" });
    const res = await callReschedule(tenantA.client, rescheduleArgs(tenantA, visitId, ist(3, 1, 11, 0)));
    expect(res.error).toBeNull();
    expect((await schedRow(visitId)).status).toBe("booked");
    // The rebooked visit counts again: the same slot is now taken.
    const other = await callReschedule(tenantA.client, rescheduleArgs(tenantA, await booked(ist(3, 2, 11, 0)), ist(3, 1, 11, 0)));
    expect(other.error).toMatchObject({ code: "P0001", message: "SLOT_TAKEN" });
  });

  it("the doctor and the duration can change with the time; a doctor of the clinic who is not a clinician is DOCTOR_NOT_FOUND", async () => {
    const visitId = await booked(ist(4, 0, 11, 0));
    const moved = await callReschedule(tenantA.client, rescheduleArgs(tenantA, visitId, ist(4, 1, 11, 0), { p_doctor_id: docB.userId }));
    expect(moved.error).toBeNull();
    expect(await schedRow(visitId)).toMatchObject({ doctor_id: docB.userId });
    for (const role of ["receptionist", "nurse", "admin"] as const) {
      const res = await callReschedule(tenantA.client, rescheduleArgs(tenantA, visitId, ist(4, 2, 11, 0), { p_doctor_id: members[role].userId }));
      expect(res.error, role).toMatchObject({ code: "P0002", message: "DOCTOR_NOT_FOUND" });
    }
    expect(await schedRow(visitId)).toMatchObject({ doctor_id: docB.userId });
  });

  it.each(["waiting", "in_consultation", "completed", "cancelled"] as const)("a %s visit is VISIT_NOT_RESCHEDULABLE: nothing changes", async (status) => {
    const week = nextWeek();
    const visitId = await booked(ist(week, 0, 11, 0), { status });
    const args = rescheduleArgs(tenantA, visitId, ist(week, 1, 11, 0));
    const res = await callReschedule(tenantA.client, args);
    expect(res.error).toMatchObject({ code: "P0001", message: "VISIT_NOT_RESCHEDULABLE" });
    expect(mapDbError(res.error)).toMatchObject({ code: "CONFLICT", reason: "VISIT_NOT_RESCHEDULABLE" });
    expect(await schedRow(visitId)).toMatchObject({ status });
    expect(await auditRows(tenantA.tenantId, "visit.reschedule", visitId)).toEqual([]);
    expect(commandResultRows(tenantA.tenantId, args.p_client_request_id)).toEqual([]);
  });

  it("a time that has passed is SLOT_IN_PAST", async () => {
    const visitId = await booked(ist(5, 2, 11, 0));
    const res = await callReschedule(tenantA.client, rescheduleArgs(tenantA, visitId, new Date(Date.now() - 3_600_000).toISOString()));
    expect(res.error).toMatchObject({ code: "P0001", message: "SLOT_IN_PAST" });
    expect(mapDbError(res.error)).toMatchObject({ code: "VALIDATION_FAILED", reason: "SLOT_IN_PAST" });
  });

  it("rollback: a fault on the message insert leaves the visit, the audit log, the outbox and the claim as they were; the same id then succeeds", async () => {
    await subscribeAppointmentEvents(tenantA);
    const visitId = await booked(ist(6, 0, 11, 0));
    const to = ist(6, 1, 11, 0);
    const args = rescheduleArgs(tenantA, visitId, to, { p_notify: true });

    await withFault({ table: "public.communication_queue", column: "appointment_id", marker: visitId }, async () => {
      const { data, error } = await callReschedule(tenantA.client, args);
      expect(data).toBeNull();
      expect(error?.code).toBe("XX000");
      const viaService = await rescheduleVisit(ctxFor(tenantA), { visit_id: visitId, new_scheduled_at: to, notify: true }, randomUUID());
      expect(viaService).toMatchObject({ ok: false, error: { code: "INTERNAL", message: "Failed to update the appointment." } });
      expect(JSON.stringify(viaService)).not.toContain("SPIKE_FAULT");
    });
    expect(new Date((await schedRow(visitId)).scheduled_at as string).toISOString()).toBe(ist(6, 0, 11, 0));
    expect(await auditRows(tenantA.tenantId, "visit.reschedule", visitId)).toEqual([]);
    expect(await outboxRows(tenantA.tenantId, "appointment.rescheduled", visitId)).toEqual([]);
    expect(commandResultRows(tenantA.tenantId, args.p_client_request_id)).toEqual([]);

    expect((await callReschedule(tenantA.client, args)).error).toBeNull();
    expect(new Date((await schedRow(visitId)).scheduled_at as string).toISOString()).toBe(to);
  });
});

describe("reschedule_visit: the slot", () => {
  it("a taken slot is SLOT_TAKEN and the visit stays where it was; the visit's own overlapping time is not a conflict", async () => {
    const week = 7;
    const mine = await booked(ist(week, 0, 11, 0));
    await booked(ist(week, 1, 11, 0)); // another patient, Tue 11:00
    const res = await callReschedule(tenantA.client, rescheduleArgs(tenantA, mine, ist(week, 1, 11, 10)));
    expect(res.error).toMatchObject({ code: "P0001", message: "SLOT_TAKEN" });
    expect(mapDbError(res.error)).toMatchObject({ code: "CONFLICT", reason: "SLOT_TAKEN" });
    expect(new Date((await schedRow(mine)).scheduled_at as string).toISOString()).toBe(ist(week, 0, 11, 0));
    expect(await auditRows(tenantA.tenantId, "visit.reschedule", mine)).toEqual([]);

    // Moving by ten minutes inside its own slot works: it never conflicts with itself.
    const near = await callReschedule(tenantA.client, rescheduleArgs(tenantA, mine, ist(week, 0, 11, 10)));
    expect(near.error).toBeNull();
    expect(new Date((await schedRow(mine)).scheduled_at as string).toISOString()).toBe(ist(week, 0, 11, 10));
  });

  it("outside the doctor's hours is SLOT_OFF_DUTY; the override books it flagged overbooked; a clinic-wide block is SLOT_BLOCKED", async () => {
    const week = 8;
    const visitId = await booked(ist(week, 0, 11, 0));
    const between = ist(week, 1, 14, 0); // between the two shifts
    const off = await callReschedule(tenantA.client, rescheduleArgs(tenantA, visitId, between));
    expect(off.error).toMatchObject({ code: "P0001", message: "SLOT_OFF_DUTY" });
    const sunday = await callReschedule(tenantA.client, rescheduleArgs(tenantA, visitId, ist(week, 6, 11, 0)));
    expect(sunday.error).toMatchObject({ message: "SLOT_OFF_DUTY" });
    const forced = await callReschedule(tenantA.client, rescheduleArgs(tenantA, visitId, between, { p_override_off_duty: true }));
    expect(forced.error).toBeNull();
    expect(forced.data).toMatchObject({ is_overbooked: true });
    expect(await schedRow(visitId)).toMatchObject({ is_overbooked: true });

    await seedBlock(tenantA, ist(week, 2, 11, 0), ist(week, 2, 12, 0), null);
    const blocked = await callReschedule(tenantA.client, rescheduleArgs(tenantA, visitId, ist(week, 2, 11, 30)));
    expect(blocked.error).toMatchObject({ message: "SLOT_BLOCKED" });
    const through = await callReschedule(tenantA.client, rescheduleArgs(tenantA, visitId, ist(week, 2, 11, 30), { p_override_block: true }));
    expect(through.error).toBeNull();
    expect(await schedRow(visitId)).toMatchObject({ is_overbooked: false }); // into a block only: not overbooked
  });

  it("p_overbook skips every check and flags the visit", async () => {
    const week = 9;
    await booked(ist(week, 1, 11, 0));
    const visitId = await booked(ist(week, 0, 11, 0));
    const res = await callReschedule(tenantA.client, rescheduleArgs(tenantA, visitId, ist(week, 1, 11, 0), { p_overbook: true }));
    expect(res.error).toBeNull();
    expect(await schedRow(visitId)).toMatchObject({ is_overbooked: true });
  });

  it("a NULL schedule is the default hours (R-9): 03:00 is off duty, 11:00 is not", async () => {
    const free = await addMemberToTenant(tenantA.tenantId, "doctor");
    await getAdminClient().from("memberships").update({ availability_schedule: null }).eq("tenant_id", tenantA.tenantId).eq("user_id", free.userId);
    const visitId = await booked(ist(10, 0, 11, 0), {}, free.userId);
    expect((await callReschedule(tenantA.client, rescheduleArgs(tenantA, visitId, ist(10, 1, 3, 0)))).error).toMatchObject({ message: "SLOT_OFF_DUTY" });
    expect((await callReschedule(tenantA.client, rescheduleArgs(tenantA, visitId, ist(10, 1, 11, 0)))).error).toBeNull();
  });
});

describe("reschedule_visit: idempotency and races", () => {
  it("the same id twice: one move, one audit row, one message, the first result with replayed: true", async () => {
    const visitId = await booked(ist(11, 0, 11, 0));
    const args = rescheduleArgs(tenantA, visitId, ist(11, 1, 11, 0), { p_notify: true });
    const first = await callReschedule(tenantA.client, args);
    const second = await callReschedule(tenantA.client, args);
    expect(second.error).toBeNull();
    expect(second.data).toEqual({ ...(first.data as object), replayed: true });
    expect(await auditRows(tenantA.tenantId, "visit.reschedule", visitId)).toHaveLength(1);
    expect(await messagesOfVisit(visitId)).toHaveLength(1);
  });

  it.each([
    ["the visit", (a: ReturnType<typeof rescheduleArgs>, other: string) => ({ ...a, p_visit_id: other })],
    ["the time", (a: ReturnType<typeof rescheduleArgs>) => ({ ...a, p_new_scheduled_at: ist(29, 3, 11, 0) })],
    ["the doctor", (a: ReturnType<typeof rescheduleArgs>) => ({ ...a, p_doctor_id: docB.userId })],
    ["the duration", (a: ReturnType<typeof rescheduleArgs>) => ({ ...a, p_duration_minutes: 30 })],
    ["the overbook flag", (a: ReturnType<typeof rescheduleArgs>) => ({ ...a, p_overbook: true })],
    ["the off-duty override", (a: ReturnType<typeof rescheduleArgs>) => ({ ...a, p_override_off_duty: true })],
    ["the block override", (a: ReturnType<typeof rescheduleArgs>) => ({ ...a, p_override_block: true })],
    ["the notify flag", (a: ReturnType<typeof rescheduleArgs>) => ({ ...a, p_notify: true })],
  ])("the same id with another %s is IDEMPOTENCY_MISMATCH and writes nothing", async (_label, vary) => {
    const week = nextWeek();
    const visitId = await booked(ist(week, 0, 11, 0));
    const other = await booked(ist(week, 1, 11, 0));
    const args = rescheduleArgs(tenantA, visitId, ist(week, 2, 11, 0));
    expect((await callReschedule(tenantA.client, args)).error).toBeNull();
    const before = await schedRow(other);
    const res = await callReschedule(tenantA.client, vary(args, other));
    expect(mapDbError(res.error)).toMatchObject({ code: "IDEMPOTENCY_MISMATCH" });
    expect(await schedRow(other)).toEqual(before);
    expect(await auditRows(tenantA.tenantId, "visit.reschedule", other)).toEqual([]);
  });

  it("two desks moving two visits into one slot: one wins, the other is SLOT_TAKEN and stays where it was", async () => {
    const week = 13;
    const a = await booked(ist(week, 0, 11, 0));
    const b = await booked(ist(week, 1, 11, 0));
    const target = ist(week, 2, 11, 0);
    const [x, y] = await Promise.all([
      callReschedule(members.receptionist.client, rescheduleArgs(tenantA, a, target)),
      callReschedule(members.owner.client, rescheduleArgs(tenantA, b, target)),
    ]);
    const errors = [x.error?.message, y.error?.message].filter(Boolean);
    expect(errors).toEqual(["SLOT_TAKEN"]);
    const rows = await Promise.all([a, b].map((id) => schedRow(id)));
    expect(rows.filter((r) => new Date(r.scheduled_at as string).toISOString() === target)).toHaveLength(1);
  });
});

describe("reschedule_visit: input", () => {
  it("a missing visit, a missing time, a bad duration and a missing request id are refused and write nothing", async () => {
    const visitId = await booked(ist(14, 0, 11, 0));
    const ok = rescheduleArgs(tenantA, visitId, ist(14, 1, 11, 0));
    expect((await callReschedule(tenantA.client, { ...ok, p_visit_id: null as unknown as string })).error).toMatchObject({ message: "INPUT_INVALID" });
    expect((await callReschedule(tenantA.client, { ...ok, p_new_scheduled_at: null as unknown as string })).error).toMatchObject({ message: "INPUT_INVALID" });
    expect((await callReschedule(tenantA.client, { ...ok, p_duration_minutes: 4 })).error).toMatchObject({ message: "INPUT_INVALID" });
    expect((await callReschedule(tenantA.client, { ...ok, p_client_request_id: null as unknown as string })).error).toMatchObject({ message: "CLIENT_REQUEST_ID_REQUIRED" });
    expect(new Date((await schedRow(visitId)).scheduled_at as string).toISOString()).toBe(ist(14, 0, 11, 0));
  });
});

describe("reschedule_visit: who may call it", () => {
  it.each(ROLES)("%s: allowed exactly when the matrix grants appointments:edit", async (role) => {
    const visitId = await booked(ist(15, ROLES.indexOf(role), 11, 0));
    const to = ist(16, ROLES.indexOf(role), 11, 0);
    const { error } = await callReschedule(members[role].client, rescheduleArgs(tenantA, visitId, to));
    if (hasPerm(role, "appointments:edit")) {
      expect(error).toBeNull();
      expect(new Date((await schedRow(visitId)).scheduled_at as string).toISOString()).toBe(to);
    } else {
      expect(error?.code).toBe("42501");
      expect(new Date((await schedRow(visitId)).scheduled_at as string).toISOString()).toBe(ist(15, ROLES.indexOf(role), 11, 0));
    }
  });

  it("anon cannot execute it (42501)", async () => {
    const visitId = await booked(ist(17, 0, 11, 0));
    const anon = createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    }) as TestDb;
    const { data, error } = await callReschedule(anon, rescheduleArgs(tenantA, visitId, ist(17, 1, 11, 0)));
    expect(data).toBeNull();
    expect(error?.code).toBe("42501");
  });

  it("another clinic's visit is NOT_FOUND, whichever clinic is named, and is not moved", async () => {
    const visitB = await seedBookedVisit(tenantB, await seedPatient(tenantB), tenantB.userId, ist(18, 0, 11, 0));
    for (const named of [tenantA, tenantB]) {
      const res = await callReschedule(tenantA.client, rescheduleArgs(named, visitB, ist(18, 1, 11, 0)));
      expect(res.error).toMatchObject({ code: "P0002", message: "VISIT_NOT_FOUND" });
    }
    expect(new Date((await schedRow(visitB)).scheduled_at as string).toISOString()).toBe(ist(18, 0, 11, 0));
  });

  it("a user of A and B acting in A cannot move B's visit, naming B or A, but can in B", async () => {
    const visitB = await seedBookedVisit(tenantB, await seedPatient(tenantB), tenantB.userId, ist(19, 0, 11, 0));
    const dual = await createDualMembershipUser(tenantA.tenantId, "receptionist", tenantB.tenantId, "receptionist");
    const actingInA = await signInActingIn(dual.userEmail, tenantA.tenantId);
    for (const named of [tenantB, tenantA]) {
      const res = await callReschedule(actingInA, rescheduleArgs(named, visitB, ist(19, 1, 11, 0)));
      expect(res.error).toMatchObject({ code: "P0002", message: "VISIT_NOT_FOUND" });
    }
    const actingInB = await signInActingIn(dual.userEmail, tenantB.tenantId);
    expect((await callReschedule(actingInB, rescheduleArgs(tenantB, visitB, ist(19, 1, 11, 0)))).error).toBeNull();
  });
});

describe("rescheduleVisit (service)", () => {
  it("moves, replays on the same id, refuses a malformed input and another clinic's visit with fixed texts", async () => {
    const visitId = await booked(ist(20, 0, 11, 0));
    const id = randomUUID();
    const input = { visit_id: visitId, new_scheduled_at: ist(20, 1, 11, 0) };
    expect(await rescheduleVisit(ctxFor(members.receptionist), input, id)).toMatchObject({ ok: true, value: { visitId, replayed: false, messageEnqueued: false } });
    expect(await rescheduleVisit(ctxFor(members.receptionist), input, id)).toMatchObject({ ok: true, value: { replayed: true } });
    expect(await rescheduleVisit(ctxFor(tenantA), { ...input, visit_id: "nope" }, randomUUID())).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
    expect(await rescheduleVisit(ctxFor(tenantA), input, "not-a-uuid")).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
    // Another clinic's visit: a fixed text, nothing about it.
    const visitB = await seedBookedVisit(tenantB, await seedPatient(tenantB), tenantB.userId, ist(20, 4, 11, 0));
    expect(await rescheduleVisit(ctxFor(tenantA), { visit_id: visitB, new_scheduled_at: ist(20, 5, 11, 0) }, randomUUID())).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND", message: "Appointment not found." },
    });
    const taken = await booked(ist(20, 3, 11, 0));
    expect(await rescheduleVisit(ctxFor(tenantA), { visit_id: taken, new_scheduled_at: ist(20, 1, 11, 0) }, randomUUID())).toMatchObject({
      ok: false,
      error: { code: "CONFLICT", reason: "SLOT_TAKEN" },
    });
  });
});
