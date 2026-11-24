/**
 * V2-09e 09E-06 (R-9): the `patient.view` audit row is written AFTER the response (`after()`), once per opening. The service returns the patient before the
 * row exists; running the scheduled task writes exactly one row; a failure of the write is logged by its tag and never reaches the person; with no request
 * scope (a script) the row is written before the call returns. Synthetic data only; real database, the clinic's own client.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const scheduled: Array<() => Promise<void> | void> = [];
let scope = true;
vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  after: (task: () => Promise<void> | void) => {
    if (!scope) throw new Error("`after` was called outside a request scope");
    scheduled.push(task);
  },
}));

import { getPatient, getPatientWithVersions, readPatientRecord } from "@/features/patients/service";
import { log } from "@/lib/log";
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

afterEach(() => {
  scheduled.length = 0;
  scope = true;
  vi.restoreAllMocks();
});

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

describe("patient.view runs after the response", () => {
  it("returns the patient with no row written; the scheduled task writes exactly one", async () => {
    const before = await views();
    const patient = await getPatient(ctxFor(clinic), patientId);
    expect(patient?.id).toBe(patientId);
    expect(scheduled).toHaveLength(1);
    expect(await views(), "nothing written before the response is over").toBe(before);
    await scheduled[0]!();
    expect(await views(), "one row per opening").toBe(before + 1);
  });

  it("the record page's read carries the clinic versions and schedules one view; the layout's read of the same record writes and schedules nothing", async () => {
    const before = await views();
    const layoutRead = await readPatientRecord(ctxFor(clinic), patientId);
    expect(layoutRead.status).toBe("ok");
    expect(scheduled).toHaveLength(0);
    const page = await getPatientWithVersions(ctxFor(clinic), patientId);
    expect(page?.patient.id).toBe(patientId);
    expect(Object.keys(page?.versions ?? {}).sort()).toEqual(["billing", "queue", "schedule", "settings"]);
    expect(page?.patient).not.toHaveProperty("tenants");
    expect(scheduled).toHaveLength(1);
    await scheduled[0]!();
    expect(await views()).toBe(before + 1);
  });

  it("a patient that is not found schedules nothing and writes nothing", async () => {
    const before = await views();
    expect(await getPatient(ctxFor(clinic), "00000000-0000-4000-8000-0000000000ff")).toBeNull();
    expect(scheduled).toHaveLength(0);
    expect(await views()).toBe(before);
  });

  it("a failed write is logged by its tag and never throws into the person's response", async () => {
    const error = vi.spyOn(log, "error").mockImplementation(() => undefined);
    const broken = { ...ctxFor(clinic), db: new Proxy(clinic.client, { get: (target, prop) => (prop === "rpc" ? async () => ({ data: null, error: { message: "boom", code: "XX000" } }) : Reflect.get(target, prop)) }) };
    // The read goes through the real client; only the audit write is broken: read first, then swap.
    const patient = await getPatient(ctxFor(clinic), patientId);
    expect(patient?.id).toBe(patientId);
    scheduled.length = 0;
    await getPatient({ ...ctxFor(clinic), db: new Proxy(clinic.client, { get: (target, prop) => (prop === "rpc" ? broken.db.rpc : Reflect.get(target, prop)) }) }, patientId);
    await expect(scheduled[0]!()).resolves.toBeUndefined();
    const tags = error.mock.calls.map((call) => (call[0] as { event?: string }).event);
    expect(tags).toContain("patients.view_audit.failed");
    expect(JSON.stringify(error.mock.calls)).not.toContain("Synthetic View Audit Patient");
  });

  it("with no request scope the row is written before the call returns (a script, a unit test)", async () => {
    scope = false;
    const before = await views();
    await getPatient(ctxFor(clinic), patientId);
    expect(scheduled).toHaveLength(0);
    expect(await views()).toBe(before + 1);
  });
});
