/**
 * V2-08 08-02 (R-6, R-12): `public.register_patient`, patient registration as one atomic command (migration 000101).
 *
 * The validated patient, its `patient.create` audit row and, when the AI objection is set, its stamp and the
 * `patient.ai_objection.set` audit row commit together or not at all; the same client_request_id replays the first result.
 * SECURITY DEFINER; patients:edit (every clinic role holds it). Called through the caller's own client; rows are read with
 * the service-role client. Synthetic data only.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import { mapDbError } from "@/lib/db/errors";
import { hasPerm } from "@/lib/permissions";
import type { UserRole } from "@/lib/db/types";
import { registerPatient, REGISTER_PATIENT_MESSAGES } from "@/features/patients/register";
import type { NewPatientInput } from "@/features/patients/schema";
import { quickRegisterToPatientInput } from "@/features/patients/register-input";
import { addMemberToTenant, createDualMembershipUser, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { getAdminClient } from "../helpers/supabase-admin";
import type { TestDb } from "../helpers/db";
import { ctxFor } from "../helpers/context";
import { signInActingIn } from "../helpers/active-tenant";
import { leftoverFaults, withFault } from "../helpers/fault";
import { expectCommandCatalog } from "../helpers/command-catalog";
import { psql } from "../helpers/sql";
import { auditRows, commandResultRows, expectDataOnlyStoredResult } from "../helpers/billing-commands";
import { newPatient, patientsMarked, seedPatient, syntheticMobile } from "../helpers/front-desk-commands";

const ROLES: UserRole[] = ["owner", "admin", "doctor", "nurse", "receptionist"];

let tenantA: SeededTenant;
let tenantB: SeededTenant;
let tenantFault: SeededTenant;
const members = {} as Record<UserRole, SeededTenant>;

beforeAll(async () => {
  tenantA = await seedTenantWithOwner("CI Register Clinic A");
  tenantB = await seedTenantWithOwner("CI Register Clinic B");
  tenantFault = await seedTenantWithOwner("CI Register Fault Clinic");
  members.owner = tenantA;
  for (const role of ROLES.filter((r) => r !== "owner")) members[role] = await addMemberToTenant(tenantA.tenantId, role);
});

afterAll(() => {
  expect(leftoverFaults()).toBe(0);
});

const marker = () => `RP-${randomUUID().slice(0, 8)}`;
/** A fixture as the form-level input of the service (the service validates it with the patient schema). */
const formInput = (m: string, over: Record<string, unknown> = {}) => newPatient(m, over) as unknown as NewPatientInput;

type RegisterArgs = { p_tenant_id: string; p_patient: Record<string, unknown>; p_client_request_id: string };
const args = (t: Pick<SeededTenant, "tenantId">, patient: Record<string, unknown>, over: Partial<RegisterArgs> = {}): RegisterArgs => ({
  p_tenant_id: t.tenantId,
  p_patient: patient,
  p_client_request_id: randomUUID(),
  ...over,
});
const call = (db: TestDb, a: RegisterArgs) => db.rpc("register_patient", a as never);

describe("register_patient: catalog", () => {
  it("is DEFINER with the pinned settings, EXECUTE for authenticated only, and a required p_client_request_id", () => {
    expectCommandCatalog({ signature: "public.register_patient(uuid, jsonb, uuid)", definer: true });
  });
});

describe("register_patient: one transaction", () => {
  it("a receptionist registers a patient: the row, the patient.create audit row and the claim commit together", async () => {
    const m = marker();
    const a = args(tenantA, newPatient(m, { phone: "9876543210", age: 41, sex: "female" }));
    const { data, error } = await call(members.receptionist.client, a);
    expect(error).toBeNull();
    const result = data as { patient_id: string; replayed: boolean };
    expect(result.replayed).toBe(false);

    const [patient] = await patientsMarked(tenantA.tenantId, m);
    expect(patient).toMatchObject({ id: result.patient_id, phone: "+919876543210", age: 41, created_by: members.receptionist.userId, tenant_id: tenantA.tenantId });
    expect(await auditRows(tenantA.tenantId, "patient.create", patient.id)).toEqual([
      expect.objectContaining({ actor_id: members.receptionist.userId, actor_role: "receptionist", entity_type: "patient" }),
    ]);
    expect(commandResultRows(tenantA.tenantId, a.p_client_request_id)).toEqual(["public.register_patient|true"]);
    // F-5 (07-04a): the stored result holds ids and flags only.
    expectDataOnlyStoredResult(tenantA.tenantId, a.p_client_request_id);
  });

  it("the AI objection is stored, stamped with the actor and the time, and audited", async () => {
    const m = marker();
    const { error } = await call(members.receptionist.client, args(tenantA, newPatient(m, { ai_processing_objected: true })));
    expect(error).toBeNull();
    const [patient] = await patientsMarked(tenantA.tenantId, m);
    const { data: row } = await getAdminClient()
      .from("patients")
      .select("ai_processing_objected, objected_at, objection_recorded_by")
      .eq("id", patient.id)
      .single();
    expect(row).toMatchObject({ ai_processing_objected: true, objection_recorded_by: members.receptionist.userId });
    expect(row?.objected_at).toBeTruthy();
    expect(await auditRows(tenantA.tenantId, "patient.ai_objection.set", patient.id)).toEqual([
      expect.objectContaining({ actor_id: members.receptionist.userId, actor_role: "receptionist" }),
    ]);
  });

  it("without the key, or with false, there is no objection, no stamp and no objection audit row", async () => {
    for (const extra of [{}, { ai_processing_objected: false }, { ai_processing_objected: null }]) {
      const m = marker();
      expect((await call(tenantA.client, args(tenantA, newPatient(m, extra)))).error, JSON.stringify(extra)).toBeNull();
      const [patient] = await patientsMarked(tenantA.tenantId, m);
      const { data: row } = await getAdminClient().from("patients").select("ai_processing_objected, objected_at, objection_recorded_by").eq("id", patient.id).single();
      expect(row).toEqual({ ai_processing_objected: false, objected_at: null, objection_recorded_by: null });
      expect(await auditRows(tenantA.tenantId, "patient.ai_objection.set", patient.id)).toEqual([]);
    }
  });

  it("rollback: a fault on the patient.create audit row (after the patient insert) leaves no patient, audit row or claim", async () => {
    const m = marker();
    const a = args(tenantFault, newPatient(m, { ai_processing_objected: true }));
    const claimsBefore = psql(`select count(*) from private.command_results where tenant_id = '${tenantFault.tenantId}'`)[0];

    await withFault(
      { table: "public.audit_logs", column: "tenant_id", marker: tenantFault.tenantId, and: { column: "action", value: "patient.create" } },
      async () => {
        const { data, error } = await call(tenantFault.client, a);
        expect(data).toBeNull();
        expect(error?.code).toBe("XX000");

        // Through the service: a fixed message, never the driver's text.
        const viaService = await registerPatient(ctxFor(tenantFault), formInput(m, { phone: syntheticMobile() }), randomUUID());
        expect(viaService).toMatchObject({ ok: false, error: { code: "INTERNAL", message: REGISTER_PATIENT_MESSAGES.INTERNAL } });
        expect(JSON.stringify(viaService)).not.toContain("SPIKE_FAULT");
      }
    );

    expect(await patientsMarked(tenantFault.tenantId, m)).toEqual([]);
    expect(await auditRows(tenantFault.tenantId, "patient.ai_objection.set")).toEqual([]);
    expect(commandResultRows(tenantFault.tenantId, a.p_client_request_id)).toEqual([]);
    expect(psql(`select count(*) from private.command_results where tenant_id = '${tenantFault.tenantId}'`)[0]).toBe(claimsBefore);

    // The same id then succeeds, once.
    const retry = await call(tenantFault.client, a);
    expect(retry.error).toBeNull();
    expect(await patientsMarked(tenantFault.tenantId, m)).toHaveLength(1);
  });
});

describe("register_patient: idempotency and races", () => {
  it("the same id twice: one patient, the first result with replayed: true, one audit row", async () => {
    const m = marker();
    const a = args(tenantA, newPatient(m, { ai_processing_objected: true }));
    const first = await call(tenantA.client, a);
    const second = await call(tenantA.client, a);
    expect(second.error).toBeNull();
    expect(second.data).toEqual({ ...(first.data as object), replayed: true });
    const patients = await patientsMarked(tenantA.tenantId, m);
    expect(patients).toHaveLength(1);
    expect(await auditRows(tenantA.tenantId, "patient.create", patients[0].id)).toHaveLength(1);
    expect(await auditRows(tenantA.tenantId, "patient.ai_objection.set", patients[0].id)).toHaveLength(1);
  });

  it("two concurrent submits of the same id register one patient (the second waits on the claim, then replays)", async () => {
    const m = marker();
    const a = args(tenantA, newPatient(m));
    const [x, y] = await Promise.all([call(tenantA.client, a), call(members.owner.client, a)]);
    expect(x.error).toBeNull();
    expect(y.error).toBeNull();
    expect([(x.data as { replayed: boolean }).replayed, (y.data as { replayed: boolean }).replayed].sort()).toEqual([false, true]);
    expect(await patientsMarked(tenantA.tenantId, m)).toHaveLength(1);
  });

  it("the same id for another name, mobile number, age, sex or objection is IDEMPOTENCY_MISMATCH and writes nothing", async () => {
    const m = marker();
    const base = newPatient(m, { phone: "9876501234", age: 30, sex: "male" });
    const a = args(tenantA, base);
    expect((await call(tenantA.client, a)).error).toBeNull();
    for (const over of [
      { full_name: `Synthetic ${m} Other` },
      { phone: "9876501235" },
      { age: 31 },
      { sex: "female" },
      { ai_processing_objected: true },
    ]) {
      const res = await call(tenantA.client, { ...a, p_patient: { ...base, ...over } });
      expect(mapDbError(res.error), JSON.stringify(over)).toMatchObject({ code: "IDEMPOTENCY_MISMATCH" });
    }
    expect(await patientsMarked(tenantA.tenantId, m)).toHaveLength(1);
  });

  it("two patients may share a family mobile number: registration is never blocked by a duplicate", async () => {
    const phone = syntheticMobile();
    const m = marker();
    expect((await call(tenantA.client, args(tenantA, newPatient(m, { phone, full_name: `Synthetic ${m} One` })))).error).toBeNull();
    expect((await call(tenantA.client, args(tenantA, newPatient(m, { phone, full_name: `Synthetic ${m} Two` })))).error).toBeNull();
    expect(await patientsMarked(tenantA.tenantId, m)).toHaveLength(2);
  });
});

describe("register_patient: input", () => {
  it.each([
    ["an unknown key", () => newPatient(marker(), { tenant_id: tenantB.tenantId })],
    ["a created_by key", () => newPatient(marker(), { created_by: tenantB.userId })],
    ["a phone that is not an Indian mobile", () => newPatient(marker(), { phone: "12345" })],
    ["a name of 121 characters", () => newPatient(marker(), { full_name: "x".repeat(121) })],
    ["an impossible date of birth", () => newPatient(marker(), { date_of_birth: "2031-02-31" })],
    ["an age of 131", () => newPatient(marker(), { age: 131 })],
    ["a sex outside the set", () => newPatient(marker(), { sex: "x" })],
    ["an objection that is not a boolean", () => newPatient(marker(), { ai_processing_objected: "true" })],
    ["an objection of 1", () => newPatient(marker(), { ai_processing_objected: 1 })],
    ["an emergency contact with another key", () => newPatient(marker(), { emergency_contact: { name: "A", ssn: "123" } })],
  ])("%s: INPUT_INVALID, nothing is written", async (_name, build) => {
    const patient = build();
    const a = args(tenantA, patient);
    const res = await call(tenantA.client, a);
    expect(res.error).toMatchObject({ code: "P0001", message: "INPUT_INVALID" });
    expect(mapDbError(res.error).code).toBe("VALIDATION_FAILED");
    expect(commandResultRows(tenantA.tenantId, a.p_client_request_id)).toEqual([]);
    expect(await patientsMarked(tenantA.tenantId, String(patient.full_name))).toEqual([]);
  });

  it("a missing request id is CLIENT_REQUEST_ID_REQUIRED", async () => {
    const m = marker();
    const res = await call(tenantA.client, args(tenantA, newPatient(m), { p_client_request_id: null as unknown as string }));
    expect(res.error).toMatchObject({ code: "P0001", message: "CLIENT_REQUEST_ID_REQUIRED" });
    expect(await patientsMarked(tenantA.tenantId, m)).toEqual([]);
  });

  it("normalises the phone (+91, ten digits) and the name", async () => {
    const m = marker();
    const { error } = await call(tenantA.client, args(tenantA, { full_name: `  Synthetic ${m}  `, phone: "+91 98765-43210" }));
    expect(error).toBeNull();
    const [patient] = await patientsMarked(tenantA.tenantId, m);
    expect(patient).toMatchObject({ full_name: `Synthetic ${m}`, phone: "+919876543210", age: null, date_of_birth: null });
  });
});

describe("register_patient: who may call it", () => {
  it.each(ROLES)("%s: allowed exactly when the matrix grants patients:edit", async (role) => {
    const m = marker();
    const res = await call(members[role].client, args(tenantA, newPatient(m)));
    if (hasPerm(role, "patients:edit")) {
      expect(res.error).toBeNull();
      expect(await patientsMarked(tenantA.tenantId, m)).toHaveLength(1);
    } else {
      expect(res.error?.code).toBe("42501");
      expect(await patientsMarked(tenantA.tenantId, m)).toEqual([]);
    }
  });

  it("anon cannot execute it (42501)", async () => {
    const anon = createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    }) as TestDb;
    const m = marker();
    const { data, error } = await call(anon, args(tenantA, newPatient(m)));
    expect(data).toBeNull();
    expect(error?.code).toBe("42501");
    expect(await patientsMarked(tenantA.tenantId, m)).toEqual([]);
  });

  it("another clinic is NOT_FOUND, naming B from A, and nothing is written", async () => {
    const m = marker();
    const res = await call(tenantA.client, args(tenantB, newPatient(m)));
    expect(res.error).toMatchObject({ code: "P0002", message: "PATIENT_NOT_FOUND" });
    expect(mapDbError(res.error).code).toBe("NOT_FOUND");
    expect(await patientsMarked(tenantB.tenantId, m)).toEqual([]);
    expect(await patientsMarked(tenantA.tenantId, m)).toEqual([]);
  });

  it("a member of A and B acting in A cannot register in B, naming B, but can in B", async () => {
    const dual = await createDualMembershipUser(tenantA.tenantId, "receptionist", tenantB.tenantId, "receptionist");
    const actingInA = await signInActingIn(dual.userEmail, tenantA.tenantId);
    const m = marker();
    const refused = await call(actingInA, args(tenantB, newPatient(m)));
    expect(refused.error).toMatchObject({ code: "P0002", message: "PATIENT_NOT_FOUND" });
    expect(await patientsMarked(tenantB.tenantId, m)).toEqual([]);

    const actingInB = await signInActingIn(dual.userEmail, tenantB.tenantId);
    expect((await call(actingInB, args(tenantB, newPatient(m)))).error).toBeNull();
    const [patient] = await patientsMarked(tenantB.tenantId, m);
    expect(await auditRows(tenantB.tenantId, "patient.create", patient.id)).toEqual([
      expect.objectContaining({ actor_id: dual.userId, actor_role: "receptionist", actor_type: "user" }),
    ]);
  });
});

describe("registerPatient (service) and the form mapping", () => {
  it("registers, replays on the same id, and refuses malformed input with fixed texts and field errors", async () => {
    const m = marker();
    const id = randomUUID();
    const input = formInput(m, { phone: syntheticMobile() });
    const first = await registerPatient(ctxFor(members.receptionist), input, id);
    expect(first).toMatchObject({ ok: true, value: { replayed: false } });
    const again = await registerPatient(ctxFor(members.receptionist), input, id);
    expect(again).toMatchObject({ ok: true, value: { patientId: first.ok ? first.value.patientId : "", replayed: true } });
    expect(await patientsMarked(tenantA.tenantId, m)).toHaveLength(1);

    expect(await registerPatient(ctxFor(tenantA), input, "not-a-uuid")).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
    const bad = await registerPatient(ctxFor(tenantA), { full_name: "", phone: "1" }, randomUUID());
    expect(bad).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
    expect(!bad.ok && Object.keys(bad.error.fieldErrors ?? {}).sort()).toEqual(["full_name", "phone"]);
  });

  it("the form's values become the stored patient: an age of 34 is 1 January of the birth year, 8 months an exact date, the objection a boolean", async () => {
    const thisYear = Number(new Date().toISOString().slice(0, 4));
    const m = marker();
    const age = await registerPatient(
      ctxFor(tenantA),
      quickRegisterToPatientInput({ phone: syntheticMobile(), name: `Synthetic ${m} Adult`, dob: `${thisYear - 34}-01-01`, dobApproximate: true, sex: "F", aiObjected: true }),
      randomUUID()
    );
    expect(age.ok).toBe(true);
    const infant = await registerPatient(
      ctxFor(tenantA),
      quickRegisterToPatientInput({ phone: syntheticMobile(), name: `Synthetic ${m} Infant`, dob: "2026-03-12", dobApproximate: true, sex: "M", aiObjected: false }),
      randomUUID()
    );
    expect(infant.ok).toBe(true);

    const rows = await Promise.all(
      (await patientsMarked(tenantA.tenantId, m)).map(async (p) => ({
        p,
        extra: (await getAdminClient().from("patients").select("sex, date_of_birth, ai_processing_objected").eq("id", p.id).single()).data,
      }))
    );
    const adult = rows.find((r) => r.p.full_name.endsWith("Adult"));
    const baby = rows.find((r) => r.p.full_name.endsWith("Infant"));
    expect(adult?.extra).toEqual({ sex: "female", date_of_birth: `${thisYear - 34}-01-01`, ai_processing_objected: true });
    expect(adult?.p.age).toBe(34);
    expect(baby?.extra).toEqual({ sex: "male", date_of_birth: "2026-03-12", ai_processing_objected: false });
  });

  it("a role without patients:edit is refused before any call (every clinic role holds it today)", async () => {
    for (const role of ROLES) {
      if (hasPerm(role, "patients:edit")) continue;
      const m = marker();
      const denied = await registerPatient(ctxFor(members[role]), formInput(m), randomUUID());
      expect(denied).toMatchObject({ ok: false, error: { code: "FORBIDDEN", message: REGISTER_PATIENT_MESSAGES.FORBIDDEN } });
      expect(await patientsMarked(tenantA.tenantId, m)).toEqual([]);
    }
  });

  it("an existing patient is untouched by a later registration with the same mobile number", async () => {
    const existing = await seedPatient(tenantA, { phone: "+919811100000" });
    const m = marker();
    expect((await registerPatient(ctxFor(tenantA), formInput(m, { phone: "9811100000" }), randomUUID())).ok).toBe(true);
    const { data } = await getAdminClient().from("patients").select("full_name").eq("id", existing).single();
    expect(data?.full_name).toBe("Synthetic Desk Patient");
  });
});
