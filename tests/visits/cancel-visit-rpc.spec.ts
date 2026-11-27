/**
 * V2-08 08-04a (R-7, R-15, D-08): `public.cancel_visit`, cancelling a booked, confirmed or waiting appointment as one atomic command.
 *
 * The status, the reason (a closed code in `metadata.cancellation_reason`, the optional note in `metadata.cancellation_note`), the
 * `visit.cancel` audit row, the waitlist promotion into the vacated slot (`private.step_promote_waitlist`: the entry of that
 * clinic-local date for this doctor or any, highest priority then oldest, one entry once), the optional `appointment_cancelled`
 * message and the `appointment.cancelled` webhook event commit together or not at all. SECURITY DEFINER; appointments:edit.
 * Rows are seeded and read with the service-role client. Synthetic data only. Every slot is in March 2031 (IST), on its own
 * week per test, inside the default hours.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import { mapDbError } from "@/lib/db/errors";
import { hasPerm } from "@/lib/permissions";
import type { UserRole } from "@/lib/db/types";
import { cancelVisit } from "@/features/visits/scheduling-service";
import { addMemberToTenant, createDualMembershipUser, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { getAdminClient } from "../helpers/supabase-admin";
import type { TestDb } from "../helpers/db";
import { ctxFor } from "../helpers/context";
import { signInActingIn } from "../helpers/active-tenant";
import { leftoverFaults, withFault } from "../helpers/fault";
import { expectCommandCatalog } from "../helpers/command-catalog";
import { auditRows, commandResultRows, expectDataOnlyStoredResult } from "../helpers/billing-commands";
import { outboxRows } from "../helpers/clinical-commands";
import { messagesOfVisit, seedBlock, seedBookedVisit, seedPatient, visitsOfPatient } from "../helpers/front-desk-commands";
import { callCancel, cancelArgs, ist, schedRow, seedWaitlistEntry, subscribeAppointmentEvents, waitlistRow } from "../helpers/scheduling-commands";

const ROLES: UserRole[] = ["owner", "admin", "doctor", "nurse", "receptionist"];
const SIGNATURE = "public.cancel_visit(uuid, uuid, text, uuid, text, boolean, boolean, bigint)";

let tenantA: SeededTenant;
let tenantB: SeededTenant;
let docB: SeededTenant;
const members = {} as Record<UserRole, SeededTenant>;

let freshWeek = 40;
const nextWeek = () => freshWeek++;

/** The clinic-local (IST) date of an instant. */
const istDate = (iso: string) => new Date(Date.parse(iso) + 330 * 60_000).toISOString().slice(0, 10);

async function booked(at: string, over: Record<string, unknown> = {}, doctorId = tenantA.userId): Promise<{ visitId: string; patientId: string }> {
  const patientId = await seedPatient(tenantA);
  return { visitId: await seedBookedVisit(tenantA, patientId, doctorId, at, over), patientId };
}

beforeAll(async () => {
  tenantA = await seedTenantWithOwner("CI Cancel Clinic A");
  tenantB = await seedTenantWithOwner("CI Cancel Clinic B");
  members.owner = tenantA;
  for (const role of ROLES.filter((r) => r !== "owner")) members[role] = await addMemberToTenant(tenantA.tenantId, role);
  docB = await addMemberToTenant(tenantA.tenantId, "doctor");
});

afterAll(() => {
  expect(leftoverFaults()).toBe(0);
});

describe("cancel_visit: catalog", () => {
  it("is DEFINER with the pinned settings, EXECUTE for authenticated only, and a required p_client_request_id; the promotion step has no API grant", () => {
    expectCommandCatalog({ signature: SIGNATURE, definer: true });
    expectCommandCatalog({ signature: "private.step_promote_waitlist(uuid, uuid, timestamptz, integer, text)", definer: true, noApiGrant: true, command: false });
  });
});

describe("cancel_visit: one transaction", () => {
  it("cancels, stores the reason and the note on the visit only, and writes the audit row, the message, the webhook event and the claim together", async () => {
    await subscribeAppointmentEvents(tenantA);
    const { visitId } = await booked(ist(0, 0, 11, 0));
    const args = cancelArgs(tenantA, visitId, { p_reason_code: "doctor_unavailable", p_reason_note: "Synthetic: doctor away", p_notify: true });
    const { data, error } = await callCancel(members.receptionist.client, args);
    expect(error).toBeNull();
    expect(data).toEqual({ visit_id: visitId, promoted: false, replacement_visit_id: null, promoted_patient_id: null, message_enqueued: true, replayed: false, row_version: expect.any(Number), versions: { queue: expect.any(Number), schedule: expect.any(Number) } });

    const row = await schedRow(visitId);
    expect(row.status).toBe("cancelled");
    expect(row.metadata).toMatchObject({
      cancellation_reason: "doctor_unavailable",
      cancellation_note: "Synthetic: doctor away",
      cancelled_by: members.receptionist.userId,
    });
    expect(await auditRows(tenantA.tenantId, "visit.cancel", visitId)).toEqual([
      expect.objectContaining({
        actor_id: members.receptionist.userId,
        actor_role: "receptionist",
        entity_type: "visit",
        metadata: { old_status: "booked", new_status: "cancelled", reason: "doctor_unavailable" },
      }),
    ]);

    const [message] = await messagesOfVisit(visitId);
    expect(message).toMatchObject({
      message_type: "appointment_cancelled",
      template_id: "appointment_cancelled",
      template_params: { patient_name: "Synthetic Desk Patient", reason: "The doctor is unavailable" },
      dedupe_key: `member:${members.receptionist.userId}:appointment_cancelled:${visitId}`,
    });
    expect(JSON.stringify(message)).not.toContain("doctor away"); // the note never reaches the patient

    const [event] = await outboxRows(tenantA.tenantId, "appointment.cancelled", visitId);
    expect(JSON.parse(String(event.payload)).data).toMatchObject({ appointment_id: visitId, reason: "doctor_unavailable" }); // the webhook payload reads the stored code

    expect(commandResultRows(tenantA.tenantId, args.p_client_request_id)).toEqual(["public.cancel_visit|true"]);
    const stored = expectDataOnlyStoredResult(tenantA.tenantId, args.p_client_request_id);
    expect(JSON.stringify(stored)).not.toContain("doctor away");
  });

  it("without p_notify no message is queued (the webhook event is); a confirmed visit cancels; a waiting visit that leaves cancels and promotes nobody", async () => {
    const week = nextWeek();
    const confirmed = await booked(ist(week, 0, 11, 0), { status: "confirmed" });
    const res = await callCancel(tenantA.client, cancelArgs(tenantA, confirmed.visitId, { p_reason_code: "other" }));
    expect(res.data).toMatchObject({ message_enqueued: false, promoted: false });
    expect(await messagesOfVisit(confirmed.visitId)).toEqual([]);
    expect((await schedRow(confirmed.visitId)).status).toBe("cancelled");

    const waitingPatient = await seedPatient(tenantA);
    await seedWaitlistEntry(tenantA, waitingPatient, istDate(ist(week, 1, 11, 0)));
    const waiting = await booked(ist(week, 1, 11, 0), { status: "waiting" });
    const left = await callCancel(tenantA.client, cancelArgs(tenantA, waiting.visitId, { p_reason_code: "patient_request" }));
    expect(left.error).toBeNull();
    expect(left.data).toMatchObject({ promoted: false });
    expect((await schedRow(waiting.visitId)).status).toBe("cancelled");
    expect(await auditRows(tenantA.tenantId, "visit.cancel", waiting.visitId)).toEqual([
      expect.objectContaining({ metadata: { old_status: "waiting", new_status: "cancelled", reason: "patient_request" } }),
    ]);
  });

  it.each(["in_consultation", "completed", "cancelled", "no_show"] as const)("a %s visit is VISIT_NOT_CANCELLABLE: nothing changes", async (status) => {
    const week = nextWeek();
    const { visitId } = await booked(ist(week, 0, 11, 0), { status });
    const args = cancelArgs(tenantA, visitId);
    const res = await callCancel(tenantA.client, args);
    expect(res.error).toMatchObject({ code: "P0001", message: "VISIT_NOT_CANCELLABLE" });
    expect(mapDbError(res.error)).toMatchObject({ code: "CONFLICT", reason: "VISIT_NOT_CANCELLABLE" });
    expect((await schedRow(visitId)).status).toBe(status);
    expect(await auditRows(tenantA.tenantId, "visit.cancel", visitId)).toEqual([]);
    expect(commandResultRows(tenantA.tenantId, args.p_client_request_id)).toEqual([]);
  });

  it("a signed consultation is not cancellable (it is completed)", async () => {
    const week = nextWeek();
    const { visitId } = await booked(ist(week, 0, 11, 0), { status: "completed", signed_at: new Date().toISOString(), signed_by: tenantA.userId });
    expect((await callCancel(tenantA.client, cancelArgs(tenantA, visitId))).error).toMatchObject({ message: "VISIT_NOT_CANCELLABLE" });
  });

  it("an unknown reason code and a note over 500 characters are INPUT_INVALID", async () => {
    const week = nextWeek();
    const { visitId } = await booked(ist(week, 0, 11, 0));
    expect((await callCancel(tenantA.client, cancelArgs(tenantA, visitId, { p_reason_code: "bored" }))).error).toMatchObject({ message: "INPUT_INVALID" });
    expect((await callCancel(tenantA.client, cancelArgs(tenantA, visitId, { p_reason_code: null as unknown as string }))).error).toMatchObject({ message: "INPUT_INVALID" });
    expect((await callCancel(tenantA.client, cancelArgs(tenantA, visitId, { p_reason_note: "x".repeat(501) }))).error).toMatchObject({ message: "INPUT_INVALID" });
    expect((await schedRow(visitId)).status).toBe("booked");
  });
});

describe("cancel_visit: the waitlist (D-08)", () => {
  it("promotes the best entry of that date for this doctor or any doctor: priority first, then the oldest; other dates and other doctors are skipped", async () => {
    const week = nextWeek();
    const at = ist(week, 0, 11, 0);
    const date = istDate(at);
    const { visitId } = await booked(at, { estimated_duration_minutes: 20 });
    const lowOld = await seedPatient(tenantA);
    const highNew = await seedPatient(tenantA);
    const highNewer = await seedPatient(tenantA);
    const otherDoctor = await seedPatient(tenantA);
    const otherDate = await seedPatient(tenantA);
    await seedWaitlistEntry(tenantA, lowOld, date, { priority: 1, created_at: "2031-01-01T00:00:00Z" });
    const winner = await seedWaitlistEntry(tenantA, highNew, date, { priority: 5, doctor_id: null, created_at: "2031-01-02T00:00:00Z" });
    await seedWaitlistEntry(tenantA, highNewer, date, { priority: 5, created_at: "2031-01-03T00:00:00Z" });
    await seedWaitlistEntry(tenantA, otherDoctor, date, { priority: 9, doctor_id: docB.userId });
    await seedWaitlistEntry(tenantA, otherDate, istDate(ist(week, 1, 11, 0)), { priority: 9 });

    const args = cancelArgs(tenantA, visitId, { p_reason_code: "patient_request" });
    const { data, error } = await callCancel(members.receptionist.client, args);
    expect(error).toBeNull();
    const result = data as { replacement_visit_id: string; promoted_patient_id: string };
    expect(data).toMatchObject({ promoted: true, promoted_patient_id: highNew, replayed: false });

    expect(await waitlistRow(winner)).toMatchObject({ status: "promoted", promoted_visit_id: result.replacement_visit_id });
    const [replacement] = await visitsOfPatient(highNew);
    expect(replacement).toMatchObject({
      id: result.replacement_visit_id,
      status: "booked",
      origin_type: "scheduled",
      doctor_id: tenantA.userId,
      estimated_duration_minutes: 20,
      reason_for_visit: "Booked from waitlist",
      is_overbooked: false,
      created_by: members.receptionist.userId,
    });
    expect(new Date(replacement.scheduled_at as string).toISOString()).toBe(at);
    expect(await auditRows(tenantA.tenantId, "visit.auto_promoted_from_waitlist", result.replacement_visit_id)).toEqual([
      expect.objectContaining({ actor_id: members.receptionist.userId, metadata: { promoted_from_waitlist_id: winner, promoted_visit_id: result.replacement_visit_id } }),
    ]);
    // The other entries are untouched.
    for (const patient of [lowOld, highNewer, otherDoctor, otherDate]) expect(await visitsOfPatient(patient)).toEqual([]);
    expectDataOnlyStoredResult(tenantA.tenantId, args.p_client_request_id);
  });

  it("p_promote_waitlist = false leaves the entry waiting; a slot that has passed promotes nobody", async () => {
    const week = nextWeek();
    const at = ist(week, 0, 11, 0);
    const entry = await seedWaitlistEntry(tenantA, await seedPatient(tenantA), istDate(at));
    const { visitId } = await booked(at);
    const res = await callCancel(tenantA.client, cancelArgs(tenantA, visitId, { p_promote_waitlist: false }));
    expect(res.data).toMatchObject({ promoted: false });
    expect(await waitlistRow(entry)).toMatchObject({ status: "waiting" });

    const pastAt = new Date(Date.now() - 2 * 86_400_000).toISOString();
    const pastEntry = await seedWaitlistEntry(tenantA, await seedPatient(tenantA), istDate(pastAt));
    const past = await booked(pastAt, { is_overbooked: true });
    expect((await callCancel(tenantA.client, cancelArgs(tenantA, past.visitId))).data).toMatchObject({ promoted: false });
    expect(await waitlistRow(pastEntry)).toMatchObject({ status: "waiting" });
  });

  // V2-08 08-06a (A-2): the promotion books a slot the way the booking does; and the reasons "doctor unavailable" and "clinic closed"
  // never promote. Before, both put a waitlisted patient into a slot of a doctor who was away, with no message to that patient.
  it.each(["doctor_unavailable", "clinic_closed"])("A-2: the reason %s never promotes, even into a working slot with an entry waiting", async (reason) => {
    const at = ist(nextWeek(), 0, 11, 0);
    const entry = await seedWaitlistEntry(tenantA, await seedPatient(tenantA), istDate(at));
    const { visitId } = await booked(at);
    const res = await callCancel(members.receptionist.client, cancelArgs(tenantA, visitId, { p_reason_code: reason, p_promote_waitlist: true }));
    expect(res.error).toBeNull();
    expect(res.data).toMatchObject({ promoted: false, replacement_visit_id: null });
    expect(await waitlistRow(entry)).toMatchObject({ status: "waiting" });
    expect(await schedRow(visitId)).toMatchObject({ status: "cancelled" });
  });

  it("A-2: a slot under a schedule block promotes nobody; the entry stays waiting (before: booked into the block)", async () => {
    const at = ist(nextWeek(), 0, 11, 0);
    const entry = await seedWaitlistEntry(tenantA, await seedPatient(tenantA), istDate(at));
    const { visitId } = await booked(at);
    await seedBlock(tenantA, at, new Date(Date.parse(at) + 10 * 60_000).toISOString(), tenantA.userId);
    const res = await callCancel(members.receptionist.client, cancelArgs(tenantA, visitId, { p_reason_code: "patient_request" }));
    expect(res.error).toBeNull();
    expect(res.data).toMatchObject({ promoted: false });
    expect(await waitlistRow(entry)).toMatchObject({ status: "waiting" });
  });

  it("A-2: a clinic-wide block counts too, and a slot the doctor does not work (a Sunday) promotes nobody", async () => {
    const week = nextWeek();
    const blockedAt = ist(week, 0, 11, 0);
    const blockedEntry = await seedWaitlistEntry(tenantA, await seedPatient(tenantA), istDate(blockedAt));
    const blocked = await booked(blockedAt);
    await seedBlock(tenantA, ist(week, 0, 10, 0), ist(week, 0, 14, 0), null);
    expect((await callCancel(tenantA.client, cancelArgs(tenantA, blocked.visitId))).data).toMatchObject({ promoted: false });
    expect(await waitlistRow(blockedEntry)).toMatchObject({ status: "waiting" });

    const sundayAt = ist(week, 6, 11, 0);
    const sundayEntry = await seedWaitlistEntry(tenantA, await seedPatient(tenantA), istDate(sundayAt));
    const sunday = await booked(sundayAt, { is_overbooked: true });
    expect((await callCancel(tenantA.client, cancelArgs(tenantA, sunday.visitId))).data).toMatchObject({ promoted: false });
    expect(await waitlistRow(sundayEntry)).toMatchObject({ status: "waiting" });
  });

  it("A-2 control: a patient_request cancel of a working slot still promotes", async () => {
    const at = ist(nextWeek(), 1, 11, 0);
    const patient = await seedPatient(tenantA);
    await seedWaitlistEntry(tenantA, patient, istDate(at));
    const { visitId } = await booked(at);
    const res = await callCancel(members.receptionist.client, cancelArgs(tenantA, visitId, { p_reason_code: "patient_request" }));
    expect(res.data).toMatchObject({ promoted: true, promoted_patient_id: patient });
  });

  it("an entry whose patient was deleted is skipped, and the next one is promoted", async () => {
    const week = nextWeek();
    const at = ist(week, 0, 11, 0);
    const date = istDate(at);
    const gone = await seedPatient(tenantA);
    const next = await seedPatient(tenantA);
    await getAdminClient().from("patients").update({ is_deleted: true }).eq("id", gone);
    const goneEntry = await seedWaitlistEntry(tenantA, gone, date, { priority: 9 });
    await seedWaitlistEntry(tenantA, next, date, { priority: 1 });
    const { visitId } = await booked(at);
    const res = await callCancel(tenantA.client, cancelArgs(tenantA, visitId));
    expect(res.error).toBeNull();
    expect(res.data).toMatchObject({ promoted: true, promoted_patient_id: next });
    expect(await waitlistRow(goneEntry)).toMatchObject({ status: "waiting" });
  });

  it("two visits of one doctor cancelled at once with one waiting entry: exactly one promotion", async () => {
    const week = nextWeek();
    const date = istDate(ist(week, 0, 11, 0));
    const entry = await seedWaitlistEntry(tenantA, await seedPatient(tenantA), date);
    const one = await booked(ist(week, 0, 11, 0));
    const two = await booked(ist(week, 0, 12, 0));
    const [x, y] = await Promise.all([
      callCancel(members.receptionist.client, cancelArgs(tenantA, one.visitId)),
      callCancel(members.owner.client, cancelArgs(tenantA, two.visitId)),
    ]);
    expect(x.error).toBeNull();
    expect(y.error).toBeNull();
    const promoted = [x.data, y.data].filter((d) => (d as { promoted: boolean }).promoted);
    expect(promoted).toHaveLength(1);
    expect((await waitlistRow(entry)).status).toBe("promoted");
    const { data: replacements } = await getAdminClient().from("visits").select("id").eq("reason_for_visit", "Booked from waitlist").eq("tenant_id", tenantA.tenantId).eq("doctor_id", tenantA.userId).gte("scheduled_at", ist(week, 0, 0, 0)).lt("scheduled_at", ist(week, 1, 0, 0));
    expect(replacements).toHaveLength(1);
  });

  it("rollback: a fault on the entry's promotion leaves the visit booked, no replacement, the entry waiting and no claim; the same id then succeeds", async () => {
    const week = nextWeek();
    const at = ist(week, 0, 11, 0);
    const marker = `CI-FAULT-${randomUUID().slice(0, 8)}`;
    const patient = await seedPatient(tenantA);
    const entry = await seedWaitlistEntry(tenantA, patient, istDate(at), { notes: marker });
    const { visitId } = await booked(at);
    const args = cancelArgs(tenantA, visitId, { p_notify: true });

    await withFault({ table: "public.waitlist_entries", column: "notes", marker, event: "update", and: { column: "status", value: "promoted" } }, async () => {
      const { data, error } = await callCancel(tenantA.client, args);
      expect(data).toBeNull();
      expect(error?.code).toBe("XX000");
      const viaService = await cancelVisit(ctxFor(tenantA), { visit_id: visitId, reason_code: "other" }, randomUUID());
      expect(viaService).toMatchObject({ ok: false, error: { code: "INTERNAL", message: "Failed to update the appointment." } });
      expect(JSON.stringify(viaService)).not.toContain("SPIKE_FAULT");
    });
    expect((await schedRow(visitId)).status).toBe("booked");
    expect(await visitsOfPatient(patient)).toEqual([]);
    expect(await waitlistRow(entry)).toMatchObject({ status: "waiting", promoted_visit_id: null });
    expect(await auditRows(tenantA.tenantId, "visit.cancel", visitId)).toEqual([]);
    expect(await messagesOfVisit(visitId)).toEqual([]);
    expect(commandResultRows(tenantA.tenantId, args.p_client_request_id)).toEqual([]);

    expect((await callCancel(tenantA.client, args)).data).toMatchObject({ promoted: true });
    expect((await schedRow(visitId)).status).toBe("cancelled");
  });
});

describe("cancel_visit: idempotency", () => {
  it("the same id twice: one cancel, one audit row, one promotion, the first result with replayed: true", async () => {
    const week = nextWeek();
    const at = ist(week, 0, 11, 0);
    await seedWaitlistEntry(tenantA, await seedPatient(tenantA), istDate(at));
    const { visitId } = await booked(at);
    const args = cancelArgs(tenantA, visitId, { p_notify: true });
    const first = await callCancel(tenantA.client, args);
    const second = await callCancel(tenantA.client, args);
    expect(second.error).toBeNull();
    expect(second.data).toEqual({ ...(first.data as object), replayed: true });
    expect(await auditRows(tenantA.tenantId, "visit.cancel", visitId)).toHaveLength(1);
    expect(await messagesOfVisit(visitId)).toHaveLength(1);
    expect(await auditRows(tenantA.tenantId, "visit.auto_promoted_from_waitlist", (first.data as { replacement_visit_id: string }).replacement_visit_id)).toHaveLength(1);
  });

  it.each([
    ["the visit", (a: ReturnType<typeof cancelArgs>, other: string) => ({ ...a, p_visit_id: other })],
    ["the reason code", (a: ReturnType<typeof cancelArgs>) => ({ ...a, p_reason_code: "duplicate" })],
    ["the note", (a: ReturnType<typeof cancelArgs>) => ({ ...a, p_reason_note: "Another note" })],
    ["the notify flag", (a: ReturnType<typeof cancelArgs>) => ({ ...a, p_notify: true })],
    ["the promote flag", (a: ReturnType<typeof cancelArgs>) => ({ ...a, p_promote_waitlist: false })],
  ])("the same id with another %s is IDEMPOTENCY_MISMATCH and writes nothing", async (_label, vary) => {
    const week = nextWeek();
    const { visitId } = await booked(ist(week, 0, 11, 0));
    const other = await booked(ist(week, 1, 11, 0));
    const args = cancelArgs(tenantA, visitId);
    expect((await callCancel(tenantA.client, args)).error).toBeNull();
    const res = await callCancel(tenantA.client, vary(args, other.visitId));
    expect(mapDbError(res.error)).toMatchObject({ code: "IDEMPOTENCY_MISMATCH" });
    expect((await schedRow(other.visitId)).status).toBe("booked");
    expect(await auditRows(tenantA.tenantId, "visit.cancel", other.visitId)).toEqual([]);
  });
});

describe("cancel_visit: who may call it", () => {
  it.each(ROLES)("%s: allowed exactly when the matrix grants appointments:edit", async (role) => {
    const week = nextWeek();
    const { visitId } = await booked(ist(week, 0, 11, 0));
    const { error } = await callCancel(members[role].client, cancelArgs(tenantA, visitId));
    if (hasPerm(role, "appointments:edit")) {
      expect(error).toBeNull();
      expect((await schedRow(visitId)).status).toBe("cancelled");
    } else {
      expect(error?.code).toBe("42501");
      expect((await schedRow(visitId)).status).toBe("booked");
    }
  });

  it("anon cannot execute it (42501)", async () => {
    const { visitId } = await booked(ist(nextWeek(), 0, 11, 0));
    const anon = createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    }) as TestDb;
    const { data, error } = await callCancel(anon, cancelArgs(tenantA, visitId));
    expect(data).toBeNull();
    expect(error?.code).toBe("42501");
    expect((await schedRow(visitId)).status).toBe("booked");
  });

  it("another clinic's visit is NOT_FOUND, whichever clinic is named, and is not cancelled", async () => {
    const visitB = await seedBookedVisit(tenantB, await seedPatient(tenantB), tenantB.userId, ist(nextWeek(), 0, 11, 0));
    for (const named of [tenantA, tenantB]) {
      const res = await callCancel(tenantA.client, cancelArgs(named, visitB));
      expect(res.error).toMatchObject({ code: "P0002", message: "VISIT_NOT_FOUND" });
    }
    expect((await schedRow(visitB)).status).toBe("booked");
  });

  it("a user of A and B acting in A cannot cancel B's visit, naming B or A, but can in B", async () => {
    const visitB = await seedBookedVisit(tenantB, await seedPatient(tenantB), tenantB.userId, ist(nextWeek(), 0, 11, 0));
    const dual = await createDualMembershipUser(tenantA.tenantId, "receptionist", tenantB.tenantId, "receptionist");
    const actingInA = await signInActingIn(dual.userEmail, tenantA.tenantId);
    for (const named of [tenantB, tenantA]) {
      expect((await callCancel(actingInA, cancelArgs(named, visitB))).error).toMatchObject({ code: "P0002", message: "VISIT_NOT_FOUND" });
    }
    const actingInB = await signInActingIn(dual.userEmail, tenantB.tenantId);
    expect((await callCancel(actingInB, cancelArgs(tenantB, visitB))).error).toBeNull();
    expect((await schedRow(visitB)).status).toBe("cancelled");
  });
});

describe("cancelVisit (service)", () => {
  it("cancels with a promotion summary, replays on the same id, refuses a bad reason and a bad id with fixed texts", async () => {
    const week = nextWeek();
    const at = ist(week, 0, 11, 0);
    const patient = await seedPatient(tenantA);
    await seedWaitlistEntry(tenantA, patient, istDate(at));
    const { visitId } = await booked(at);
    const id = randomUUID();
    const first = await cancelVisit(ctxFor(members.receptionist), { visit_id: visitId, reason_code: "patient_request", notify: true }, id);
    expect(first).toMatchObject({ ok: true, value: { visitId, autoPromoted: true, promotedPatientId: patient, messageEnqueued: true, replayed: false } });
    expect(await cancelVisit(ctxFor(members.receptionist), { visit_id: visitId, reason_code: "patient_request", notify: true }, id)).toMatchObject({ ok: true, value: { replayed: true } });
    expect(await cancelVisit(ctxFor(tenantA), { visit_id: visitId, reason_code: "bored" as never }, randomUUID())).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
    expect(await cancelVisit(ctxFor(tenantA), { visit_id: visitId, reason_code: "other" }, "not-a-uuid")).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
    expect(await cancelVisit(ctxFor(tenantA), { visit_id: visitId, reason_code: "other" }, randomUUID())).toMatchObject({
      ok: false,
      error: { code: "CONFLICT", reason: "VISIT_NOT_CANCELLABLE", message: "This appointment can no longer be cancelled." },
    });
  });
});
