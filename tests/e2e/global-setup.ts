/**
 * Playwright global setup (V2-02 plan 02-03a). Runs in the runner process after the config's env guard.
 *
 * - Re-checks the local-only guard and takes the same run lock as Vitest (`startRun`), so an e2e run and a Vitest
 *   run never share the local stack at once (each one's teardown deletes everything created during its run).
 * - Seeds tenant A (owner, admin, doctor, nurse, receptionist; one patient with an in-consultation visit) and tenant
 *   B (owner; one patient and visit) with synthetic data and a per-run random password; writes ids/emails/names to
 *   `playwright/.auth/run.json` and the password to `E2E_RUN_PASSWORD` (inherited by workers, never on disk).
 * - Returns the teardown: `teardownRun` removes every tenant, user and storage object created during the run (and
 *   `.planning/dev-messages.txt` if the run created it), then the storage states and run file are deleted.
 * Set TEST_KEEP_DATA=1 to keep the run's data for debugging.
 */
import fs from "node:fs";
import { randomInt, randomUUID } from "node:crypto";
import { assertLocalTestEnv } from "../setup/test-env";
import { ensureLocalErrorIngestKey } from "../setup/error-sink-key";
import { releaseRunLock, startRun, teardownRun, type RunMarker } from "../setup/teardown";
import { addMemberToTenant, seededUserPassword, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { getAdminClient } from "../helpers/supabase-admin";
import { ROOT } from "./support/app-env";
import { AUTH_DIR, RUN_FILE, RUN_PASSWORD_VAR, type RunData, type RunTenant } from "./support/run-data";

/**
 * A random +91 90000 0xxxx number: valid-looking, NOT a reserved range (India has none), so it may be a real
 * subscriber's. Safe only because the e2e lane's messaging is pinned offline (MESSAGING_PROVIDER=dev).
 */
function syntheticPhone(): string {
  return `+9190000${String(randomInt(0, 100_000)).padStart(5, "0")}`;
}

async function seedPatientAndVisit(owner: SeededTenant, doctorId: string, patientName: string): Promise<RunTenant> {
  const admin = getAdminClient();
  const { data: patient, error: pErr } = await admin
    .from("patients")
    .insert({
      tenant_id: owner.tenantId,
      full_name: patientName,
      phone: syntheticPhone(),
      sex: "other",
      created_by: owner.userId,
    })
    .select("id")
    .single();
  if (pErr || !patient) throw new Error(`e2e seed: patient insert failed: ${pErr?.message}`);

  const { data: visit, error: vErr } = await admin
    .from("visits")
    .insert({
      tenant_id: owner.tenantId,
      patient_id: patient.id,
      doctor_id: doctorId,
      origin_type: "walk_in",
      status: "in_consultation",
      estimated_duration_minutes: 15,
      created_by: owner.userId,
    })
    .select("id")
    .single();
  if (vErr || !visit) throw new Error(`e2e seed: visit insert failed: ${vErr?.message}`);

  return { id: owner.tenantId, name: owner.tenantName, patientId: patient.id, patientName, visitId: visit.id };
}

async function seed(runTag: string): Promise<RunData> {
  const ownerA = await seedTenantWithOwner(`E2E Synthetic Clinic A ${runTag}`);
  const admin = await addMemberToTenant(ownerA.tenantId, "admin");
  const doctor = await addMemberToTenant(ownerA.tenantId, "doctor");
  const nurse = await addMemberToTenant(ownerA.tenantId, "nurse");
  const receptionist = await addMemberToTenant(ownerA.tenantId, "receptionist");
  const tenantA = await seedPatientAndVisit(ownerA, doctor.userId, `E2E Synthetic Patient A ${runTag}`);

  const ownerB = await seedTenantWithOwner(`E2E Synthetic Clinic B ${runTag}`);
  const tenantB = await seedPatientAndVisit(ownerB, ownerB.userId, `E2E Synthetic Patient B ${runTag}`);
  // A real B invoice, so the receipt-PDF isolation probe asks for an invoice that exists (IR-F9).
  const { data: invoiceB, error: invErr } = await getAdminClient()
    .from("invoices")
    .insert({
      tenant_id: ownerB.tenantId,
      visit_id: tenantB.visitId,
      patient_id: tenantB.patientId,
      invoice_number: `INV-E2E-${runTag}`,
      subtotal: 500,
      total_amount: 500,
      status: "issued",
    })
    .select("id")
    .single();
  if (invErr || !invoiceB) throw new Error(`e2e seed: invoice insert failed: ${invErr?.message}`);

  const user = (s: SeededTenant) => ({ id: s.userId, email: s.userEmail });
  return {
    runTag,
    tenantA: {
      ...tenantA,
      users: { owner: user(ownerA), admin: user(admin), doctor: user(doctor), nurse: user(nurse), receptionist: user(receptionist) },
    },
    tenantB: { ...tenantB, owner: user(ownerB), invoiceId: (invoiceB as { id: string }).id },
  };
}

async function finish(marker: RunMarker): Promise<void> {
  try {
    if (process.env.TEST_KEEP_DATA === "1") {
      console.warn(`[e2e teardown] TEST_KEEP_DATA=1: keeping data created since ${marker.startedAt}`);
      return;
    }
    const report = await teardownRun(ROOT, marker);
    fs.rmSync(AUTH_DIR, { recursive: true, force: true });
    console.log(
      `[e2e teardown] removed run data: ${report.tenants} tenant(s), ${report.users} auth user(s), ` +
        `${report.storageObjects} storage object(s); verified none remain`,
    );
  } finally {
    releaseRunLock(marker.lockFile);
  }
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  assertLocalTestEnv();
  // V2-03 03-09b: the local vault secret the error sink checks the synthetic ingest key against.
  ensureLocalErrorIngestKey(ROOT);
  const marker = await startRun(ROOT);
  try {
    const run = await seed(randomUUID().slice(0, 8));
    fs.mkdirSync(AUTH_DIR, { recursive: true });
    fs.writeFileSync(RUN_FILE, `${JSON.stringify(run, null, 2)}\n`);
    process.env[RUN_PASSWORD_VAR] = seededUserPassword();
  } catch (error) {
    await finish(marker);
    throw error;
  }
  return () => finish(marker);
}
