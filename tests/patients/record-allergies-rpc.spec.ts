/**
 * V2-09c 09C-02 (R-8, T-09C-07): `public.record_patient_allergies`, the allergy record as one atomic command. patients:edit AND consultations:view (the
 * 000055 rule: the front desk cannot), `[]` is "No known allergies", duplicates are removed case-insensitively, 51 strings are refused, another clinic is
 * PATIENT_NOT_FOUND, replay and mismatch, the audit row holds counts only. Synthetic data only.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mapDbError } from "@/lib/db/errors";
import { hasPerm } from "@/lib/permissions";
import type { UserRole } from "@/lib/db/types";
import { recordPatientAllergies } from "@/features/patients/allergies";
import { addMemberToTenant, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { ctxFor } from "../helpers/context";
import { leftoverFaults, withFault } from "../helpers/fault";
import { expectCommandCatalog } from "../helpers/command-catalog";
import { getAdminClient } from "../helpers/supabase-admin";
import { auditRows, commandResultRows, expectDataOnlyStoredResult, seedVisit } from "../helpers/billing-commands";
import { AL_SUBSTANCES, seedAllergyCatalogue } from "../helpers/cdci-allergy";
import type { Json } from "@/types/database";

const ROLES: UserRole[] = ["owner", "admin", "doctor", "nurse", "receptionist"];
const admin = getAdminClient();
let tenantA: SeededTenant;
let tenantB: SeededTenant;
const members = {} as Record<UserRole, SeededTenant>;

beforeAll(async () => {
  await seedAllergyCatalogue();
  tenantA = await seedTenantWithOwner("CI Allergies Clinic A");
  tenantB = await seedTenantWithOwner("CI Allergies Clinic B");
  members.owner = tenantA;
  for (const role of ROLES.filter((r) => r !== "owner")) members[role] = await addMemberToTenant(tenantA.tenantId, role);
}, 120_000);

afterAll(() => {
  expect(leftoverFaults()).toBe(0);
});

async function newPatient(allergies: string[] | null = null) {
  const { patientId } = await seedVisit(tenantA);
  await admin.from("patients").update({ allergies }).eq("id", patientId).throwOnError();
  return patientId;
}
const stored = async (patientId: string) => (await admin.from("patients").select("allergies").eq("id", patientId).single()).data?.allergies;
const call = (client: SeededTenant["client"], patientId: string, allergies: unknown, over: Record<string, unknown> = {}) =>
  client.rpc("record_patient_allergies", { p_tenant_id: tenantA.tenantId, p_patient_id: patientId, p_allergies: allergies as Json, p_client_request_id: randomUUID(), ...over });

describe("record_patient_allergies", () => {
  it("is DEFINER with the pinned settings, EXECUTE for authenticated only, and a required p_client_request_id", () => {
    expectCommandCatalog({ signature: "public.record_patient_allergies(uuid, uuid, jsonb, uuid)", definer: true });
  });

  it("records a list in one transaction with its counts-only audit row and a data-only stored result; Qzxamoxil is coded, Penicillin is not", async () => {
    const p = await newPatient(null);
    const req = randomUUID();
    const res = await call(members.doctor.client, p, [AL_SUBSTANCES.amox.name, "Penicillin"], { p_client_request_id: req });
    expect(res.error).toBeNull();
    expect(res.data).toEqual({ patient_id: p, allergies_count: 2, replayed: false });
    expect(await stored(p)).toEqual([AL_SUBSTANCES.amox.name, "Penicillin"]);
    const rows = await auditRows(tenantA.tenantId, "patient.allergies_record", p);
    expect(rows).toEqual([expect.objectContaining({ actor_id: members.doctor.userId, entity_type: "patient", metadata: { allergies_count: 2, coded_count: 1 } })]);
    expect(JSON.stringify(rows[0].metadata)).not.toContain("Penicillin");
    expect(commandResultRows(tenantA.tenantId, req)).toEqual(["public.record_patient_allergies|true"]);
    expectDataOnlyStoredResult(tenantA.tenantId, req);
  });

  it("[] is 'No known allergies' (stored as an empty list, not NULL); a later list replaces it; NULL is never written by the command", async () => {
    const p = await newPatient(null);
    expect((await call(members.doctor.client, p, [])).error).toBeNull();
    expect(await stored(p)).toEqual([]);
    expect((await call(members.doctor.client, p, ["Sulfa"])).error).toBeNull();
    expect(await stored(p)).toEqual(["Sulfa"]);
    expect((await call(members.doctor.client, p, null)).error).toMatchObject({ code: "P0001", message: "INPUT_INVALID" });
  });

  it("duplicates are removed case-insensitively (the first spelling is kept), whitespace is collapsed", async () => {
    const p = await newPatient(null);
    expect((await call(members.doctor.client, p, ["Penicillin", "  penicillin ", "PENICILLIN", "Sulfa  drugs", "sulfa drugs"])).data).toMatchObject({ allergies_count: 2 });
    expect(await stored(p)).toEqual(["Penicillin", "Sulfa drugs"]);
  });

  it.each([
    ["51 strings", Array.from({ length: 51 }, (_, i) => `Allergen ${i}`)],
    ["a string over 200 characters", ["x".repeat(201)]],
    ["a blank string", ["Penicillin", "   "]],
    ["a non-string entry", ["Penicillin", 5]],
    ["an object", { allergen: "x" }],
    ["a control character", ["Peni\u0007cillin"]],
  ])("%s is INPUT_INVALID (VALIDATION_FAILED) and changes nothing", async (_name, list) => {
    const p = await newPatient(["Existing"]);
    const res = await call(members.doctor.client, p, list);
    expect(res.error).toMatchObject({ code: "P0001", message: "INPUT_INVALID" });
    expect(mapDbError(res.error)).toMatchObject({ code: "VALIDATION_FAILED" });
    expect(await stored(p)).toEqual(["Existing"]);
  });

  it("50 strings are accepted", async () => {
    const p = await newPatient(null);
    expect((await call(members.doctor.client, p, Array.from({ length: 50 }, (_, i) => `Allergen ${i}`))).data).toMatchObject({ allergies_count: 50 });
  });

  it.each(ROLES)("%s: allowed exactly when the role holds patients:edit and consultations:view", async (role) => {
    const p = await newPatient(null);
    const { error } = await call(members[role].client, p, ["Penicillin"]);
    if (hasPerm(role, "patients:edit") && hasPerm(role, "consultations:view")) {
      expect(error).toBeNull();
      expect(await stored(p)).toEqual(["Penicillin"]);
    } else {
      expect(error?.code).toBe("42501");
      expect(await stored(p)).toBeNull();
      expect(await auditRows(tenantA.tenantId, "patient.allergies_record", p)).toEqual([]);
    }
  });

  it("another clinic's patient, or another clinic named by a member of this one, is PATIENT_NOT_FOUND and nothing changes", async () => {
    const p = await newPatient(null);
    const foreign = await call(tenantB.client, p, ["Penicillin"], { p_tenant_id: tenantB.tenantId });
    expect(foreign.error).toMatchObject({ code: "P0002", message: "PATIENT_NOT_FOUND" });
    expect(mapDbError(foreign.error)).toMatchObject({ code: "NOT_FOUND" });
    expect((await call(tenantB.client, p, ["Penicillin"])).error).toMatchObject({ code: "P0002", message: "PATIENT_NOT_FOUND" });
    expect(await stored(p)).toBeNull();
  });

  it("replay returns the first result and writes nothing; the same id for another list is IDEMPOTENCY_MISMATCH", async () => {
    const p = await newPatient(null);
    const req = randomUUID();
    const first = await call(members.doctor.client, p, ["Penicillin"], { p_client_request_id: req });
    const again = await call(members.doctor.client, p, ["Penicillin"], { p_client_request_id: req });
    expect(again.data).toEqual({ ...(first.data as object), replayed: true });
    expect(await auditRows(tenantA.tenantId, "patient.allergies_record", p)).toHaveLength(1);
    const other = await call(members.doctor.client, p, ["Sulfa"], { p_client_request_id: req });
    expect(mapDbError(other.error)).toMatchObject({ code: "IDEMPOTENCY_MISMATCH" });
    expect(await stored(p)).toEqual(["Penicillin"]);
  });

  it("rollback: a fault after the patient write (the audit row) leaves the list as it was and no claim; the same id then succeeds", async () => {
    const p = await newPatient(["Before"]);
    const req = randomUUID();
    await withFault({ table: "public.audit_logs", column: "entity_id", marker: p, event: "insert" }, async () => {
      const res = await call(members.doctor.client, p, ["After"], { p_client_request_id: req });
      expect(res.error?.code).toBe("XX000");
    });
    expect(await stored(p)).toEqual(["Before"]);
    expect(commandResultRows(tenantA.tenantId, req)).toEqual([]);
    expect((await call(members.doctor.client, p, ["After"], { p_client_request_id: req })).error).toBeNull();
    expect(await stored(p)).toEqual(["After"]);
  });

  it("the service refuses a role without both permissions with a fixed text, and a malformed list before the database", async () => {
    const p = await newPatient(null);
    expect(await recordPatientAllergies(ctxFor(members.receptionist), { patient_id: p, allergies: ["Penicillin"], client_request_id: randomUUID() })).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN", message: "Allergies can only be recorded by clinical staff." },
    });
    expect(await recordPatientAllergies(ctxFor(members.doctor), { patient_id: p, allergies: ["x".repeat(201)], client_request_id: randomUUID() })).toMatchObject({
      ok: false,
      error: { code: "VALIDATION_FAILED" },
    });
    expect(await recordPatientAllergies(ctxFor(members.nurse), { patient_id: p, allergies: ["Penicillin"], client_request_id: randomUUID() })).toMatchObject({ ok: true });
    expect(await stored(p)).toEqual(["Penicillin"]);
  });
});
