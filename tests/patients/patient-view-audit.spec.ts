/**
 * The `patient.view` audit row (V2-09e 09E-14a, finding B; it had moved to `after()` in 09E-06 and could be lost). Fail-closed again: the service awaits the write before it
 * returns the record, exactly one row per opening, and an audit failure fails the read (no record without its row). Real service, real database, the clinic's own client;
 * nothing is mocked. Synthetic data only.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { getPatient, getPatientWithVersions, readPatientRecord } from "@/features/patients/service";
import { seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { ctxFor } from "../helpers/context";
import { getAdminClient } from "../helpers/supabase-admin";
import { insertReturningId } from "../helpers/db";

let clinic: SeededTenant;
let patientId: string;

beforeAll(async () => {
  clinic = await seedTenantWithOwner("CI Patient View Audit");
  patientId = await insertReturningId(getAdminClient(), "patients", {
    tenant_id: clinic.tenantId,
    full_name: "Synthetic View Audit Patient",
    phone: "+919000012501",
    created_by: clinic.userId,
  });
}, 120_000);

async function views(): Promise<number> {
  const { count, error } = await getAdminClient()
    .from("audit_logs")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", clinic.tenantId)
    .eq("action", "patient.view")
    .eq("entity_id", patientId);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

describe("patient.view is written before the record is returned", () => {
  it("getPatient: the row exists when the call returns, exactly one per opening", async () => {
    const before = await views();
    const patient = await getPatient(ctxFor(clinic), patientId);
    expect(patient?.id).toBe(patientId);
    expect(await views(), "one row per opening, already written").toBe(before + 1);
  });

  it("the record page's path: the layout's read writes nothing, the page's read carries the versions and writes exactly one row", async () => {
    const before = await views();
    const layoutRead = await readPatientRecord(ctxFor(clinic), patientId);
    expect(layoutRead.status).toBe("ok");
    expect(await views(), "the layout's read writes no row").toBe(before);
    const page = await getPatientWithVersions(ctxFor(clinic), patientId);
    expect(page?.patient.id).toBe(patientId);
    expect(Object.keys(page?.versions ?? {}).sort()).toEqual(["billing", "queue", "schedule", "settings"]);
    expect(page?.patient).not.toHaveProperty("tenants");
    expect(await views()).toBe(before + 1);
  });

  it("a patient that is not found writes nothing", async () => {
    const before = await views();
    expect(await getPatient(ctxFor(clinic), "00000000-0000-4000-8000-0000000000ff")).toBeNull();
    expect(await views()).toBe(before);
  });

  it("an audit failure fails the read: no record is returned without its row", async () => {
    const before = await views();
    const broken = new Proxy(clinic.client, {
      get: (target, prop) => (prop === "rpc" ? async () => ({ data: null, error: { message: "boom", code: "XX000" } }) : Reflect.get(target, prop)),
    });
    await expect(getPatient({ ...ctxFor(clinic), db: broken }, patientId)).rejects.toThrow();
    await expect(getPatientWithVersions({ ...ctxFor(clinic), db: broken }, patientId)).rejects.toThrow();
    expect(await views()).toBe(before);
  });
});
