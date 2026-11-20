/**
 * V2-07 07-03 (R-1, R-2, R-3, R-7): `public.enqueue_walk_in`, the walk-in as one atomic command.
 *
 * The patient (when new), the walk-in visit (`waiting`) and its queue token, with the `patient.create`, `visit.create` and
 * `queue.check_in` audit rows, commit together or not at all; the same client_request_id replays the first result.
 * SECURITY DEFINER; appointments:edit (+ patients:edit for a new patient). Called through the caller's own client; rows
 * are seeded and read with the service-role client. Synthetic data only.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import { mapDbError } from "@/lib/db/errors";
import { hasPerm } from "@/lib/permissions";
import type { UserRole } from "@/lib/db/types";
import { enqueueWalkIn, WALK_IN_COMMAND_MESSAGES } from "@/features/queue/service";
import { addMemberToTenant, createDualMembershipUser, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { getAdminClient } from "../helpers/supabase-admin";
import type { TestDb } from "../helpers/db";
import { ctxFor } from "../helpers/context";
import { signInActingIn } from "../helpers/active-tenant";
import { leftoverFaults, withFault } from "../helpers/fault";
import { expectCommandCatalog } from "../helpers/command-catalog";
import { psql } from "../helpers/sql";
import { auditRows, commandResultRows, expectDataOnlyStoredResult } from "../helpers/billing-commands";
import { tokensOfVisit } from "../helpers/clinical-commands";
import {
  callWalkIn,
  newPatient,
  patientsMarked,
  seedPatient,
  syntheticMobile,
  visitsOfPatient,
  walkInArgs,
} from "../helpers/front-desk-commands";

const ROLES: UserRole[] = ["owner", "admin", "doctor", "nurse", "receptionist"];

let tenantA: SeededTenant;
let tenantB: SeededTenant;
let tenantFault: SeededTenant;
const members = {} as Record<UserRole, SeededTenant>;

beforeAll(async () => {
  tenantA = await seedTenantWithOwner("CI WalkIn Clinic A");
  tenantB = await seedTenantWithOwner("CI WalkIn Clinic B");
  tenantFault = await seedTenantWithOwner("CI WalkIn Fault Clinic");
  members.owner = tenantA;
  for (const role of ROLES.filter((r) => r !== "owner")) members[role] = await addMemberToTenant(tenantA.tenantId, role);
});

afterAll(() => {
  expect(leftoverFaults()).toBe(0);
});

const marker = () => `WI-${randomUUID().slice(0, 8)}`;

describe("enqueue_walk_in: catalog", () => {
  it("is DEFINER with the pinned settings, EXECUTE for authenticated only, and a required p_client_request_id", () => {
    expectCommandCatalog({ signature: "public.enqueue_walk_in(uuid, uuid, jsonb, uuid, text, uuid, text, integer)", definer: true });
  });

  it("the shared steps have no API grant", () => {
    for (const fn of [
      "private.step_create_patient(uuid, jsonb)",
      "private.step_create_visit(uuid, uuid, uuid, text, timestamptz, integer, text, boolean)",
      "private.step_check_in(uuid, uuid, text)",
    ]) {
      expect(
        psql(`select has_function_privilege('authenticated', '${fn}', 'EXECUTE')::text || ',' || has_function_privilege('service_role', '${fn}', 'EXECUTE')::text`),
        fn
      ).toEqual(["false,false"]);
    }
  });
});

describe("enqueue_walk_in: one transaction", () => {
  it("new patient: patient, visit, token, three audit rows and the claim commit together", async () => {
    const m = marker();
    const args = walkInArgs(tenantA, {
      p_new_patient: newPatient(m, { phone: "9876543210", age: 41, sex: "female" }),
      p_priority: "urgent",
      p_reason: "Synthetic fever",
      p_duration_minutes: 20,
    });
    const { data, error } = await callWalkIn(members.receptionist.client, args);
    expect(error).toBeNull();
    const result = data as { patient_id: string; visit_id: string; queue_token_id: string; token_number: number };
    expect(data).toMatchObject({ patient_created: true, priority: "urgent", replayed: false });

    const [patient] = await patientsMarked(tenantA.tenantId, m);
    expect(patient).toMatchObject({ id: result.patient_id, phone: "+919876543210", age: 41, created_by: members.receptionist.userId });
    const [visit] = await visitsOfPatient(patient.id);
    expect(visit).toMatchObject({
      id: result.visit_id,
      status: "waiting",
      origin_type: "walk_in",
      doctor_id: tenantA.userId,
      scheduled_at: null,
      estimated_duration_minutes: 20,
      reason_for_visit: "Synthetic fever",
      is_overbooked: false,
      created_by: members.receptionist.userId,
      tenant_id: tenantA.tenantId,
    });
    expect(visit.location_id).toBeTruthy();
    const [token] = await tokensOfVisit(visit.id);
    expect(token).toMatchObject({ id: result.queue_token_id, token_number: result.token_number, priority: "urgent" });

    for (const [action, entity, id] of [
      ["patient.create", "patient", patient.id],
      ["visit.create", "visit", visit.id],
      ["queue.check_in", "queue_token", token.id],
    ] as const) {
      expect(await auditRows(tenantA.tenantId, action, id), action).toEqual([
        expect.objectContaining({ actor_id: members.receptionist.userId, actor_role: "receptionist", entity_type: entity }),
      ]);
    }
    expect(commandResultRows(tenantA.tenantId, args.p_client_request_id)).toEqual(["public.enqueue_walk_in|true"]);
    // F-5 (07-04a): the stored result holds ids, numbers, amounts, statuses and flags only, no free text.
    expectDataOnlyStoredResult(tenantA.tenantId, args.p_client_request_id);
  });

  it("existing patient: no patient is created, one visit and token", async () => {
    const patientId = await seedPatient(tenantA);
    const args = walkInArgs(tenantA, { p_patient_id: patientId });
    const { data, error } = await callWalkIn(tenantA.client, args);
    expect(error).toBeNull();
    expect(data).toMatchObject({ patient_id: patientId, patient_created: false, replayed: false });
    expect(await visitsOfPatient(patientId)).toHaveLength(1);
    expect(await auditRows(tenantA.tenantId, "patient.create", patientId)).toEqual([]);
  });

  it("rollback: a fault on the token insert (after the patient and the visit) leaves no patient, visit, token, audit row or claim", async () => {
    const m = marker();
    const args = walkInArgs(tenantFault, { p_new_patient: newPatient(m) });
    const auditBefore = (await auditRows(tenantFault.tenantId, "visit.create")).length;
    const claimsBefore = psql(`select count(*) from private.command_results where tenant_id = '${tenantFault.tenantId}'`)[0];

    await withFault({ table: "public.queue_tokens", column: "tenant_id", marker: tenantFault.tenantId }, async () => {
      const { data, error } = await callWalkIn(tenantFault.client, args);
      expect(data).toBeNull();
      expect(error?.code).toBe("XX000");

      // Through the service: a fixed message, never the driver's text.
      const viaService = await enqueueWalkIn(ctxFor(tenantFault), { new_patient: newPatient(m), doctor_id: tenantFault.userId }, randomUUID());
      expect(viaService).toMatchObject({ ok: false, error: { code: "INTERNAL", message: WALK_IN_COMMAND_MESSAGES.INTERNAL } });
      expect(JSON.stringify(viaService)).not.toContain("SPIKE_FAULT");
    });

    expect(await patientsMarked(tenantFault.tenantId, m)).toEqual([]);
    const { count: visits } = await getAdminClient().from("visits").select("id", { count: "exact", head: true }).eq("tenant_id", tenantFault.tenantId);
    expect(visits).toBe(0);
    expect((await auditRows(tenantFault.tenantId, "visit.create")).length).toBe(auditBefore);
    expect(await auditRows(tenantFault.tenantId, "patient.create")).toEqual([]);
    expect(commandResultRows(tenantFault.tenantId, args.p_client_request_id)).toEqual([]);
    expect(psql(`select count(*) from private.command_results where tenant_id = '${tenantFault.tenantId}'`)[0]).toBe(claimsBefore);

    // The same id then succeeds, once.
    const retry = await callWalkIn(tenantFault.client, args);
    expect(retry.error).toBeNull();
    expect(await patientsMarked(tenantFault.tenantId, m)).toHaveLength(1);
  });

  it("rollback: a doctor outside the clinic is refused after the patient insert and no patient is left behind", async () => {
    const m = marker();
    const res = await callWalkIn(tenantA.client, walkInArgs(tenantA, { p_new_patient: newPatient(m), p_doctor_id: tenantB.userId }));
    expect(res.error).toMatchObject({ code: "P0002", message: "DOCTOR_NOT_FOUND" });
    expect(mapDbError(res.error)).toMatchObject({ code: "NOT_FOUND", reason: "DOCTOR_NOT_FOUND" });
    expect(await patientsMarked(tenantA.tenantId, m)).toEqual([]);
  });

  it("a suspended doctor is refused like a foreign one", async () => {
    const doctor = await addMemberToTenant(tenantA.tenantId, "doctor");
    const { error: suspendError } = await getAdminClient().from("memberships").update({ status: "suspended" }).eq("tenant_id", tenantA.tenantId).eq("user_id", doctor.userId);
    expect(suspendError).toBeNull();
    const m = marker();
    const res = await callWalkIn(tenantA.client, walkInArgs(tenantA, { p_new_patient: newPatient(m), p_doctor_id: doctor.userId }));
    expect(res.error).toMatchObject({ code: "P0002", message: "DOCTOR_NOT_FOUND" });
    expect(await patientsMarked(tenantA.tenantId, m)).toEqual([]);
  });

  // G-9 (07-04a): the doctor must be a clinician (owner/doctor), not any active member.
  it.each(["receptionist", "nurse", "admin"] as const)("a %s cannot be the doctor of a walk-in: DOCTOR_NOT_FOUND, nothing is written", async (role) => {
    const m = marker();
    const args = walkInArgs(tenantA, { p_new_patient: newPatient(m), p_doctor_id: members[role].userId });
    const res = await callWalkIn(tenantA.client, args);
    expect(res.error).toMatchObject({ code: "P0002", message: "DOCTOR_NOT_FOUND" });
    expect(await patientsMarked(tenantA.tenantId, m)).toEqual([]);
    expect(commandResultRows(tenantA.tenantId, args.p_client_request_id)).toEqual([]);
  });

  it("an unknown or another clinic's patient is PATIENT_NOT_FOUND and writes nothing", async () => {
    const foreign = await seedPatient(tenantB);
    for (const id of [randomUUID(), foreign]) {
      const args = walkInArgs(tenantA, { p_patient_id: id });
      const res = await callWalkIn(tenantA.client, args);
      expect(res.error).toMatchObject({ code: "P0002", message: "PATIENT_NOT_FOUND" });
      expect(commandResultRows(tenantA.tenantId, args.p_client_request_id)).toEqual([]);
    }
    expect(await visitsOfPatient(foreign)).toEqual([]);
  });
});

describe("enqueue_walk_in: idempotency and races", () => {
  it("the same id twice: one patient, one visit, one token, the first result with replayed: true", async () => {
    const m = marker();
    const args = walkInArgs(tenantA, { p_new_patient: newPatient(m) });
    const first = await callWalkIn(tenantA.client, args);
    const second = await callWalkIn(tenantA.client, args);
    expect(second.error).toBeNull();
    expect(second.data).toEqual({ ...(first.data as object), replayed: true });
    const patients = await patientsMarked(tenantA.tenantId, m);
    expect(patients).toHaveLength(1);
    const visits = await visitsOfPatient(patients[0].id);
    expect(visits).toHaveLength(1);
    expect(await tokensOfVisit(visits[0].id)).toHaveLength(1);
    expect(await auditRows(tenantA.tenantId, "patient.create", patients[0].id)).toHaveLength(1);
  });

  it("two concurrent submits of the same id register one patient (the second waits on the claim, then replays)", async () => {
    const m = marker();
    const args = walkInArgs(tenantA, { p_new_patient: newPatient(m) });
    const [x, y] = await Promise.all([callWalkIn(tenantA.client, args), callWalkIn(members.owner.client, args)]);
    expect(x.error).toBeNull();
    expect(y.error).toBeNull();
    expect([(x.data as { replayed: boolean }).replayed, (y.data as { replayed: boolean }).replayed].sort()).toEqual([false, true]);
    expect(await patientsMarked(tenantA.tenantId, m)).toHaveLength(1);
  });

  it("the same id for another doctor, patient or priority is IDEMPOTENCY_MISMATCH and writes nothing", async () => {
    const m = marker();
    const patientId = await seedPatient(tenantA);
    const other = await addMemberToTenant(tenantA.tenantId, "doctor");
    const args = walkInArgs(tenantA, { p_patient_id: patientId });
    expect((await callWalkIn(tenantA.client, args)).error).toBeNull();
    // Every input is part of the request hash (G-7): doctor, priority, patient, reason and duration.
    for (const over of [
      { p_doctor_id: other.userId },
      { p_priority: "vip" },
      { p_reason: "A different reason" },
      { p_duration_minutes: 30 },
      { p_patient_id: null, p_new_patient: newPatient(m) },
    ]) {
      const res = await callWalkIn(tenantA.client, { ...args, ...over } as never);
      expect(mapDbError(res.error), JSON.stringify(over)).toMatchObject({ code: "IDEMPOTENCY_MISMATCH" });
    }
    expect(await patientsMarked(tenantA.tenantId, m)).toEqual([]);
    expect(await visitsOfPatient(patientId)).toHaveLength(1);
  });

  it("ten parallel walk-ins get ten distinct tokens", async () => {
    const race = await seedTenantWithOwner("CI WalkIn Race Clinic");
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => callWalkIn(race.client, walkInArgs(race, { p_new_patient: newPatient(`RACE-${i}`) })))
    );
    for (const r of results) expect(r.error).toBeNull();
    const numbers = results.map((r) => (r.data as { token_number: number }).token_number).sort((a, b) => a - b);
    expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});

describe("enqueue_walk_in: input", () => {
  it.each([
    ["both a patient and a new patient", async () => ({ p_patient_id: await seedPatient(tenantA), p_new_patient: newPatient(marker()) })],
    ["neither", async () => ({})],
    ["an unknown key in the new patient", async () => ({ p_new_patient: { ...newPatient(marker()), tenant_id: tenantB.tenantId } })],
    ["a phone that is not an Indian mobile", async () => ({ p_new_patient: newPatient(marker(), { phone: "12345" }) })],
    ["a name of 121 characters", async () => ({ p_new_patient: newPatient(marker(), { full_name: "x".repeat(121) }) })],
    ["an impossible date of birth", async () => ({ p_new_patient: newPatient(marker(), { date_of_birth: "2031-02-31" }) })],
    ["an age of 131", async () => ({ p_new_patient: newPatient(marker(), { age: 131 }) })],
    ["a sex outside the set", async () => ({ p_new_patient: newPatient(marker(), { sex: "x" }) })],
    // G-6 (07-04a): the emergency contact is {name, phone, relation} strings of up to 200 characters, nothing else.
    ["an emergency contact with another key", async () => ({ p_new_patient: newPatient(marker(), { emergency_contact: { name: "A", ssn: "123" } }) })],
    ["an emergency contact with a non-string value", async () => ({ p_new_patient: newPatient(marker(), { emergency_contact: { name: { first: "A" } } }) })],
    ["an emergency contact with a 201-character value", async () => ({ p_new_patient: newPatient(marker(), { emergency_contact: { name: "x".repeat(201) } }) })],
    ["an emergency contact that is an array", async () => ({ p_new_patient: newPatient(marker(), { emergency_contact: ["a"] }) })],
    ["a priority outside the set", async () => ({ p_new_patient: newPatient(marker()), p_priority: "emergency" })],
    ["a duration of 4 minutes", async () => ({ p_new_patient: newPatient(marker()), p_duration_minutes: 4 })],
    ["a missing doctor", async () => ({ p_new_patient: newPatient(marker()), p_doctor_id: null })],
  ])("%s: INPUT_INVALID, nothing is written", async (_name, build) => {
    const over = await build();
    const args = walkInArgs(tenantA, over as never);
    const res = await callWalkIn(tenantA.client, args);
    expect(res.error).toMatchObject({ code: "P0001", message: "INPUT_INVALID" });
    expect(mapDbError(res.error).code).toBe("VALIDATION_FAILED");
    expect(commandResultRows(tenantA.tenantId, args.p_client_request_id)).toEqual([]);
    const name = (over as { p_new_patient?: { full_name?: string } }).p_new_patient?.full_name;
    if (name) expect(await patientsMarked(tenantA.tenantId, name)).toEqual([]);
  });

  it("a missing request id is CLIENT_REQUEST_ID_REQUIRED", async () => {
    const m = marker();
    const res = await callWalkIn(tenantA.client, walkInArgs(tenantA, { p_new_patient: newPatient(m), p_client_request_id: null as unknown as string }));
    expect(res.error).toMatchObject({ code: "P0001", message: "CLIENT_REQUEST_ID_REQUIRED" });
    expect(await patientsMarked(tenantA.tenantId, m)).toEqual([]);
  });

  it("stores an emergency contact of name, phone and relation (G-6), and none as null", async () => {
    const m = marker();
    const contact = { name: "Synthetic Relative", phone: "+919800000001", relation: "Spouse" };
    expect((await callWalkIn(tenantA.client, walkInArgs(tenantA, { p_new_patient: newPatient(m, { emergency_contact: contact }) }))).error).toBeNull();
    const [withContact] = await patientsMarked(tenantA.tenantId, m);
    const { data } = await getAdminClient().from("patients").select("emergency_contact").eq("id", withContact.id).single();
    expect(data?.emergency_contact).toEqual(contact);
    const m2 = marker();
    expect((await callWalkIn(tenantA.client, walkInArgs(tenantA, { p_new_patient: newPatient(m2, { emergency_contact: null }) }))).error).toBeNull();
    const [none] = await patientsMarked(tenantA.tenantId, m2);
    expect((await getAdminClient().from("patients").select("emergency_contact").eq("id", none.id).single()).data?.emergency_contact).toBeNull();
  });

  it("normalises the phone (+91, ten digits) and the name; an unmarked optional field stays empty", async () => {
    const m = marker();
    const { error } = await callWalkIn(
      tenantA.client,
      walkInArgs(tenantA, { p_new_patient: { full_name: `  Synthetic ${m}  `, phone: "+91 98765-43210" } })
    );
    expect(error).toBeNull();
    const [patient] = await patientsMarked(tenantA.tenantId, m);
    expect(patient).toMatchObject({ full_name: `Synthetic ${m}`, phone: "+919876543210", age: null, date_of_birth: null });
  });
});

describe("enqueue_walk_in: who may call it", () => {
  it.each(ROLES)("%s: allowed exactly when the matrix grants appointments:edit (and patients:edit for a new patient)", async (role) => {
    const existing = await callWalkIn(members[role].client, walkInArgs(tenantA, { p_patient_id: await seedPatient(tenantA) }));
    if (hasPerm(role, "appointments:edit")) expect(existing.error).toBeNull();
    else expect(existing.error?.code).toBe("42501");

    const m = marker();
    const fresh = await callWalkIn(members[role].client, walkInArgs(tenantA, { p_new_patient: newPatient(m) }));
    if (hasPerm(role, "appointments:edit") && hasPerm(role, "patients:edit")) {
      expect(fresh.error).toBeNull();
      expect(await patientsMarked(tenantA.tenantId, m)).toHaveLength(1);
    } else {
      expect(fresh.error?.code).toBe("42501");
      expect(await patientsMarked(tenantA.tenantId, m)).toEqual([]);
    }
  });

  it("anon cannot execute it (42501)", async () => {
    const anon = createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    }) as TestDb;
    const m = marker();
    const { data, error } = await callWalkIn(anon, walkInArgs(tenantA, { p_new_patient: newPatient(m) }));
    expect(data).toBeNull();
    expect(error?.code).toBe("42501");
    expect(await patientsMarked(tenantA.tenantId, m)).toEqual([]);
  });

  it("another clinic is NOT_FOUND whichever clinic is named, and nothing is written", async () => {
    const m = marker();
    const foreignPatient = await seedPatient(tenantB);
    for (const [named, over] of [
      [tenantB, { p_new_patient: newPatient(m) }],
      [tenantB, { p_patient_id: foreignPatient }],
      [tenantA, { p_patient_id: foreignPatient }],
    ] as const) {
      const res = await callWalkIn(tenantA.client, walkInArgs(named, over as never));
      expect(res.error).toMatchObject({ code: "P0002", message: "PATIENT_NOT_FOUND" });
      expect(mapDbError(res.error).code).toBe("NOT_FOUND");
    }
    expect(await patientsMarked(tenantB.tenantId, m)).toEqual([]);
    expect(await visitsOfPatient(foreignPatient)).toEqual([]);
  });

  it("a member of A and B acting in A cannot register a walk-in in B, naming B or A, but can in B", async () => {
    const dual = await createDualMembershipUser(tenantA.tenantId, "receptionist", tenantB.tenantId, "receptionist");
    const actingInA = await signInActingIn(dual.userEmail, tenantA.tenantId);
    const m = marker();
    for (const named of [tenantB, tenantA]) {
      const res = await callWalkIn(actingInA, walkInArgs(named, { p_new_patient: newPatient(m), p_doctor_id: tenantB.userId }));
      // Naming B is not the active clinic; naming A passes that guard and then finds no such doctor in A.
      expect(res.error, `named ${named.tenantName}`).toMatchObject({
        code: "P0002",
        message: named === tenantB ? "PATIENT_NOT_FOUND" : "DOCTOR_NOT_FOUND",
      });
    }
    expect(await patientsMarked(tenantB.tenantId, m)).toEqual([]);

    const actingInB = await signInActingIn(dual.userEmail, tenantB.tenantId);
    const ok = await callWalkIn(actingInB, walkInArgs(tenantB, { p_new_patient: newPatient(m) }));
    expect(ok.error).toBeNull();
    const [patient] = await patientsMarked(tenantB.tenantId, m);
    expect(await auditRows(tenantB.tenantId, "patient.create", patient.id)).toEqual([
      expect.objectContaining({ actor_id: dual.userId, actor_role: "receptionist", actor_type: "user" }),
    ]);
  });
});

describe("enqueueWalkIn (service)", () => {
  it("registers, replays on the same id, and refuses malformed input with fixed texts", async () => {
    const m = marker();
    const id = randomUUID();
    const input = { new_patient: newPatient(m, { phone: syntheticMobile() }), doctor_id: tenantA.userId, reason_for_visit: "Walk-In Consultation" };
    const first = await enqueueWalkIn(ctxFor(members.receptionist), input, id);
    expect(first).toMatchObject({ ok: true, value: { patientCreated: true, replayed: false } });
    const again = await enqueueWalkIn(ctxFor(members.receptionist), input, id);
    expect(again).toMatchObject({ ok: true, value: { replayed: true } });
    expect(await patientsMarked(tenantA.tenantId, m)).toHaveLength(1);

    expect(await enqueueWalkIn(ctxFor(tenantA), input, "not-a-uuid")).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
    expect(await enqueueWalkIn(ctxFor(tenantA), { doctor_id: tenantA.userId }, randomUUID())).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
    expect(
      await enqueueWalkIn(ctxFor(tenantA), { patient_id: randomUUID(), new_patient: input.new_patient, doctor_id: tenantA.userId }, randomUUID())
    ).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
    const bad = await enqueueWalkIn(ctxFor(tenantA), { new_patient: { full_name: "", phone: "1" }, doctor_id: tenantA.userId }, randomUUID());
    expect(bad).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
  });

  it("derives the age and date of birth like the patient form, and refuses a role without the permission before any call", async () => {
    const m = marker();
    const ok = await enqueueWalkIn(ctxFor(tenantA), { new_patient: { full_name: `Synthetic ${m}`, phone: syntheticMobile(), age: 30 }, doctor_id: tenantA.userId }, randomUUID());
    expect(ok.ok).toBe(true);
    const [patient] = await patientsMarked(tenantA.tenantId, m);
    expect(patient.age).toBe(30);
    expect(patient.date_of_birth).toMatch(/^\d{4}-01-01$/);

    const m2 = marker();
    const denied = await enqueueWalkIn(ctxFor(members.nurse), { new_patient: newPatient(m2), doctor_id: tenantA.userId }, randomUUID());
    if (hasPerm("nurse", "appointments:edit") && hasPerm("nurse", "patients:edit")) {
      expect(denied.ok).toBe(true);
    } else {
      expect(denied).toMatchObject({ ok: false, error: { code: "FORBIDDEN", message: WALK_IN_COMMAND_MESSAGES.FORBIDDEN } });
      expect(await patientsMarked(tenantA.tenantId, m2)).toEqual([]);
    }
  });
});
