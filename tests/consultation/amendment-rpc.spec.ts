/**
 * V2-07 07-01 (R-1, R-2, R-3): `public.reopen_visit_for_amendment` and `public.finalize_visit_amendment`, the amendment
 * pair as atomic commands.
 *
 * Reopen: the amendment row (number and snapshot filled by the database), the visit back to `in_consultation` and the
 * audit row commit together. Finalize: the latest prescription's next version and new signature, the visit re-signed as
 * `completed` and the audit row commit together. Finalize re-issues `prescription.issued` for the amended header, once per version
 * (event key `...:signed:v<n>` from version 2; V2-09a 000108, R-10); `visit.completed` is not re-emitted and reopen raises no webhook.
 * SECURITY DEFINER; consultations:edit only (owner, doctor). Synthetic data only.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import { mapDbError } from "@/lib/db/errors";
import { hasPerm } from "@/lib/permissions";
import type { UserRole } from "@/lib/db/types";
import {
  AMENDMENT_REASON_TOO_LONG_MESSAGE,
  AMENDMENT_REASON_TOO_SHORT_MESSAGE,
  finalizeVisitAmendment,
  reopenVisitForAmendment,
} from "@/features/consultation/service";
import { addMemberToTenant, createDualMembershipUser, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import type { TestDb } from "../helpers/db";
import { ctxFor } from "../helpers/context";
import { signInActingIn } from "../helpers/active-tenant";
import { leftoverFaults, withFault } from "../helpers/fault";
import { expectCommandCatalog } from "../helpers/command-catalog";
import { createBarrier, gateClient } from "../helpers/write-barrier";
import { getAdminClient } from "../helpers/supabase-admin";
import { auditRows, commandResultRows, expectDataOnlyStoredResult } from "../helpers/billing-commands";
import {
  callFinalize,
  callReopen,
  callSign,
  deactivateSubscription,
  finalizeArgs,
  outboxRows,
  prescriptionsOfVisit,
  reopenArgs,
  revisionsOfVisit,
  seedClinicalVisit,
  signArgs,
  subscribeSignEvents,
  visitRow,
  type ClinicalVisit,
} from "../helpers/clinical-commands";

const ROLES: UserRole[] = ["owner", "admin", "doctor", "nurse", "receptionist"];

let tenantA: SeededTenant;
let tenantB: SeededTenant;
let subscriptionA: string;
const members = {} as Record<UserRole, SeededTenant>;

beforeAll(async () => {
  tenantA = await seedTenantWithOwner("CI Amendment Clinic A");
  tenantB = await seedTenantWithOwner("CI Amendment Clinic B");
  members.owner = tenantA;
  for (const role of ROLES.filter((r) => r !== "owner")) members[role] = await addMemberToTenant(tenantA.tenantId, role);
  subscriptionA = await subscribeSignEvents(tenantA);
});

afterAll(async () => {
  await deactivateSubscription(subscriptionA);
  expect(leftoverFaults()).toBe(0);
});

/** A visit signed through the sign command (so the visit, its prescription and the outbox are as production leaves them). */
async function signedVisit(t: SeededTenant, opts: { doctor?: SeededTenant; marker?: string } = {}): Promise<ClinicalVisit> {
  const doctor = opts.doctor ?? members.doctor;
  const v = await seedClinicalVisit(t, { doctorId: doctor.userId, diagnosis: true, prescriptions: 1, marker: opts.marker });
  const { error } = await callSign(doctor.client, signArgs(t, v.visitId));
  if (error) throw new Error(`seed sign failed: ${error.code} ${error.message}`);
  return v;
}

async function reopenedVisit(t: SeededTenant, opts: { reason?: string; marker?: string } = {}): Promise<ClinicalVisit> {
  const v = await signedVisit(t, { marker: opts.marker });
  const { error } = await callReopen(members.doctor.client, reopenArgs(t, v.visitId, opts.reason ? { p_reason: opts.reason } : {}));
  if (error) throw new Error(`seed reopen failed: ${error.code} ${error.message}`);
  return v;
}

async function amendmentOutbox(tenantId: string, v: ClinicalVisit) {
  const completed = await outboxRows(tenantId, "visit.completed", v.visitId);
  const issued = (await Promise.all(v.prescriptionIds.map((id) => outboxRows(tenantId, "prescription.issued", id)))).flat();
  return { completed: completed.length, issued: issued.length };
}

describe("amendment commands: catalog", () => {
  it("are DEFINER with the pinned settings, EXECUTE for authenticated only, and a required p_client_request_id", () => {
    expectCommandCatalog({ signature: "public.reopen_visit_for_amendment(uuid, uuid, text, uuid)", definer: true });
    expectCommandCatalog({ signature: "public.finalize_visit_amendment(uuid, uuid, uuid)", definer: true });
  });
});

describe("reopen_visit_for_amendment: one transaction", () => {
  it("happy path: the revision (database number and snapshot), the reopened visit, the audit row and the claim commit together", async () => {
    const v = await signedVisit(tenantA);
    const signedBefore = (await visitRow(v.visitId)).signed_at;
    const reason = "Added antibiotic after the patient's callback";
    const args = reopenArgs(tenantA, v.visitId, { p_reason: `  ${reason}  ` });
    const { data, error } = await callReopen(members.doctor.client, args);
    expect(error).toBeNull();
    expect(data).toEqual({ visit_id: v.visitId, revision_number: 1, replayed: false });
    // F-5: the amendment reason is not in the stored result.
    expect(expectDataOnlyStoredResult(tenantA.tenantId, args.p_client_request_id)).toEqual({ visit_id: v.visitId, revision_number: 1, replayed: false });

    expect(await visitRow(v.visitId)).toMatchObject({ status: "in_consultation", signed_at: signedBefore, current_revision: 2 });
    const [revision] = await revisionsOfVisit(v.visitId);
    expect(revision).toMatchObject({ revision_number: 1, amended_by: members.doctor.userId, amendment_reason: reason });
    expect(revision.snapshot).toMatchObject({ captured_by: "database", visit: { status: "completed" } });
    expect(await auditRows(tenantA.tenantId, "visit.reopen_for_amendment", v.visitId)).toEqual([
      expect.objectContaining({
        actor_id: members.doctor.userId,
        actor_role: "doctor",
        metadata: { revision_number: 1, amendment_reason: reason },
      }),
    ]);
    expect(commandResultRows(tenantA.tenantId, args.p_client_request_id)).toEqual(["public.reopen_visit_for_amendment|true"]);
  });

  it("rollback: a fault on the visit update takes the revision row and the audit row with it; the same id then succeeds", async () => {
    const marker = `CI-FAULT-${randomUUID().slice(0, 8)}`;
    const v = await signedVisit(tenantA, { marker });
    const args = reopenArgs(tenantA, v.visitId);

    await withFault({ table: "public.visits", column: "reason_for_visit", marker, event: "update" }, async () => {
      const { data, error } = await callReopen(members.doctor.client, args);
      expect(data).toBeNull();
      expect(error?.code).toBe("XX000");
    });

    expect(await visitRow(v.visitId)).toMatchObject({ status: "completed", current_revision: 1 });
    expect(await revisionsOfVisit(v.visitId)).toEqual([]);
    expect(await auditRows(tenantA.tenantId, "visit.reopen_for_amendment", v.visitId)).toEqual([]);
    expect(commandResultRows(tenantA.tenantId, args.p_client_request_id)).toEqual([]);

    const retry = await callReopen(members.doctor.client, args);
    expect(retry.error).toBeNull();
    expect(retry.data).toMatchObject({ revision_number: 1, replayed: false });
  });

  it("a visit that is not signed, or is already reopened, is VISIT_NOT_SIGNED and nothing is written", async () => {
    const unsigned = await seedClinicalVisit(tenantA, { diagnosis: true, prescriptions: 0 });
    const reopened = await reopenedVisit(tenantA);
    for (const v of [unsigned, reopened]) {
      const args = reopenArgs(tenantA, v.visitId);
      const res = await callReopen(members.doctor.client, args);
      expect(res.error).toMatchObject({ code: "P0001", message: "VISIT_NOT_SIGNED" });
      expect(mapDbError(res.error)).toMatchObject({ code: "CONFLICT", reason: "VISIT_NOT_SIGNED" });
      expect(commandResultRows(tenantA.tenantId, args.p_client_request_id)).toEqual([]);
    }
    expect(await revisionsOfVisit(unsigned.visitId)).toEqual([]);
    expect(await revisionsOfVisit(reopened.visitId)).toHaveLength(1);
  });

  it.each([
    ["shorter than 10 characters", "too short"],
    ["only blanks", "            "],
    ["longer than 500 characters", "x".repeat(501)],
  ])("a reason %s is AMENDMENT_REASON_INVALID and writes nothing", async (_name, reason) => {
    const v = await signedVisit(tenantA);
    const args = reopenArgs(tenantA, v.visitId, { p_reason: reason });
    const res = await callReopen(members.doctor.client, args);
    expect(res.error).toMatchObject({ code: "P0001", message: "AMENDMENT_REASON_INVALID" });
    expect(mapDbError(res.error)).toMatchObject({ code: "VALIDATION_FAILED", reason: "AMENDMENT_REASON_INVALID" });
    expect((await visitRow(v.visitId)).status).toBe("completed");
    expect(await revisionsOfVisit(v.visitId)).toEqual([]);
    expect(commandResultRows(tenantA.tenantId, args.p_client_request_id)).toEqual([]);
  });
});

describe("finalize_visit_amendment: one transaction", () => {
  it("happy path: version 2 with the reason and a new signature, the visit completed again, the audit row, one prescription.issued ...:signed:v2", async () => {
    const v = await reopenedVisit(tenantA, { reason: "Corrected the dosage after the review" });
    const rxBefore = (await prescriptionsOfVisit(v.visitId))[0];
    const outboxBefore = await amendmentOutbox(tenantA.tenantId, v);
    const args = finalizeArgs(tenantA, v.visitId);
    const { data, error } = await callFinalize(members.doctor.client, args);
    expect(error).toBeNull();
    // F-5 (07-04a): the result carries no free text; the reason is in the prescription and the revision row.
    expect(data).toEqual({ visit_id: v.visitId, version: 2, replayed: false });
    expect(expectDataOnlyStoredResult(tenantA.tenantId, args.p_client_request_id)).toEqual({ visit_id: v.visitId, version: 2, replayed: false });

    const [rx] = await prescriptionsOfVisit(v.visitId);
    expect(rx).toMatchObject({ id: v.prescriptionIds[0], version: 2, amendment_reason: "Corrected the dosage after the review" });
    expect(new Date(rx.signed_at!).getTime()).toBeGreaterThan(new Date(rxBefore.signed_at!).getTime());
    expect(await visitRow(v.visitId)).toMatchObject({ status: "completed", signed_by: members.doctor.userId });
    expect(await auditRows(tenantA.tenantId, "visit.amend_finalized", v.visitId)).toEqual([
      expect.objectContaining({
        actor_id: members.doctor.userId,
        metadata: { version: 2, amendment_reason: "Corrected the dosage after the review" },
      }),
    ]);
    // R-10: the amended prescription is issued again, once for version 2; visit.completed is not re-emitted.
    expect(await amendmentOutbox(tenantA.tenantId, v)).toEqual({ completed: outboxBefore.completed, issued: outboxBefore.issued + 1 });
    const issued = await outboxRows(tenantA.tenantId, "prescription.issued", v.prescriptionIds[0]);
    expect(issued.map((r) => r.event_key).sort()).toEqual([
      `prescription.issued:${v.prescriptionIds[0]}:signed`,
      `prescription.issued:${v.prescriptionIds[0]}:signed:v2`,
    ]);
    const reissued = issued.find((r) => r.event_key?.endsWith(":v2"))!;
    expect(JSON.parse(reissued.payload).data).toEqual({ prescription_id: v.prescriptionIds[0], patient_id: v.patientId, visit_id: v.visitId, version: 2 });
    expect(commandResultRows(tenantA.tenantId, args.p_client_request_id)).toEqual(["public.finalize_visit_amendment|true"]);
  });

  it("a second amendment cycle makes version 3", async () => {
    const v = await reopenedVisit(tenantA);
    expect((await callFinalize(members.doctor.client, finalizeArgs(tenantA, v.visitId))).data).toMatchObject({ version: 2 });
    expect((await callReopen(members.doctor.client, reopenArgs(tenantA, v.visitId, { p_reason: "Second correction for the audit" }))).data).toMatchObject({ revision_number: 2 });
    const third = await callFinalize(members.doctor.client, finalizeArgs(tenantA, v.visitId));
    expect(third.data).toEqual({ visit_id: v.visitId, version: 3, replayed: false });
    expect((await prescriptionsOfVisit(v.visitId))[0]).toMatchObject({ version: 3, amendment_reason: "Second correction for the audit" });
    // One prescription.issued per version: the keys of version 1, 2 and 3 differ.
    const keys = (await outboxRows(tenantA.tenantId, "prescription.issued", v.prescriptionIds[0])).map((r) => r.event_key).sort();
    expect(keys).toEqual([
      `prescription.issued:${v.prescriptionIds[0]}:signed`,
      `prescription.issued:${v.prescriptionIds[0]}:signed:v2`,
      `prescription.issued:${v.prescriptionIds[0]}:signed:v3`,
    ]);
  });

  it("rollback: a fault on the prescription update leaves the visit reopened at version 1, no audit row, no claim; the same id then succeeds", async () => {
    // The update writes the revision's reason into the prescription, so the reason is the fault marker.
    const marker = `CI-FAULT-${randomUUID().slice(0, 8)}`;
    const v = await reopenedVisit(tenantA, { reason: marker });
    const args = finalizeArgs(tenantA, v.visitId);

    await withFault({ table: "public.prescriptions", column: "amendment_reason", marker, event: "update" }, async () => {
      const { data, error } = await callFinalize(members.doctor.client, args);
      expect(data).toBeNull();
      expect(error?.code).toBe("XX000");
    });

    expect(await visitRow(v.visitId)).toMatchObject({ status: "in_consultation" });
    expect((await prescriptionsOfVisit(v.visitId))[0]).toMatchObject({ version: 1, amendment_reason: null });
    // R-10: nothing is queued for a finalize that faulted after the prescription update (the outbox row shares the transaction).
    expect((await outboxRows(tenantA.tenantId, "prescription.issued", v.prescriptionIds[0])).map((r) => r.event_key)).toEqual([
      `prescription.issued:${v.prescriptionIds[0]}:signed`,
    ]);
    expect(await auditRows(tenantA.tenantId, "visit.amend_finalized", v.visitId)).toEqual([]);
    expect(commandResultRows(tenantA.tenantId, args.p_client_request_id)).toEqual([]);

    const retry = await callFinalize(members.doctor.client, args);
    expect(retry.error).toBeNull();
    expect(retry.data).toMatchObject({ version: 2, replayed: false });
  });

  it("a visit that is signed but not reopened, or never signed, is AMENDMENT_NOT_OPEN and nothing is written", async () => {
    const signed = await signedVisit(tenantA);
    const unsigned = await seedClinicalVisit(tenantA, { diagnosis: true, prescriptions: 1 });
    for (const v of [signed, unsigned]) {
      const args = finalizeArgs(tenantA, v.visitId);
      const res = await callFinalize(members.doctor.client, args);
      expect(res.error).toMatchObject({ code: "P0001", message: "AMENDMENT_NOT_OPEN" });
      expect(mapDbError(res.error)).toMatchObject({ code: "CONFLICT", reason: "AMENDMENT_NOT_OPEN" });
      expect((await prescriptionsOfVisit(v.visitId))[0].version).toBe(1);
      expect(commandResultRows(tenantA.tenantId, args.p_client_request_id)).toEqual([]);
    }
    expect((await visitRow(unsigned.visitId)).signed_at).toBeNull();
  });
});

describe("amendment commands: idempotency and races", () => {
  it("reopen with the same id twice: one revision, one audit row, the first result with replayed: true", async () => {
    const v = await signedVisit(tenantA);
    const args = reopenArgs(tenantA, v.visitId);
    const first = await callReopen(members.doctor.client, args);
    const second = await callReopen(members.doctor.client, args);
    expect(second.error).toBeNull();
    expect(second.data).toEqual({ ...(first.data as object), replayed: true });
    expect(await revisionsOfVisit(v.visitId)).toHaveLength(1);
    expect(await auditRows(tenantA.tenantId, "visit.reopen_for_amendment", v.visitId)).toHaveLength(1);
  });

  it("reopen with the same id and another reason is IDEMPOTENCY_MISMATCH and writes nothing", async () => {
    const v = await signedVisit(tenantA);
    const args = reopenArgs(tenantA, v.visitId);
    expect((await callReopen(members.doctor.client, args)).error).toBeNull();
    const res = await callReopen(members.doctor.client, { ...args, p_reason: "A different reason entirely" });
    expect(mapDbError(res.error)).toMatchObject({ code: "IDEMPOTENCY_MISMATCH" });
    expect(await revisionsOfVisit(v.visitId)).toHaveLength(1);
  });

  it("finalize with the same id twice: one version bump, one audit row, the first result with replayed: true", async () => {
    const v = await reopenedVisit(tenantA);
    const args = finalizeArgs(tenantA, v.visitId);
    const first = await callFinalize(members.doctor.client, args);
    const second = await callFinalize(members.doctor.client, args);
    expect(second.error).toBeNull();
    expect(second.data).toEqual({ ...(first.data as object), replayed: true });
    expect((await prescriptionsOfVisit(v.visitId))[0].version).toBe(2);
    expect(await auditRows(tenantA.tenantId, "visit.amend_finalized", v.visitId)).toHaveLength(1);
    // The replay queues no second prescription.issued.
    expect(await outboxRows(tenantA.tenantId, "prescription.issued", v.prescriptionIds[0])).toHaveLength(2);
  });

  it("two concurrent reopens of one visit (different ids): one revision; the other is VISIT_NOT_SIGNED", async () => {
    const v = await signedVisit(tenantA);
    const barrier = createBarrier(2);
    const [x, y] = await Promise.all([
      callReopen(gateClient(tenantA.client, { rpc: { reopen_visit_for_amendment: barrier } }), reopenArgs(tenantA, v.visitId)),
      callReopen(gateClient(members.doctor.client, { rpc: { reopen_visit_for_amendment: barrier } }), reopenArgs(tenantA, v.visitId)),
    ]);
    const failed = [x, y].filter((r) => r.error);
    expect(failed).toHaveLength(1);
    expect(mapDbError(failed[0].error)).toMatchObject({ code: "CONFLICT", reason: "VISIT_NOT_SIGNED" });
    expect(await revisionsOfVisit(v.visitId)).toHaveLength(1);
    expect(await auditRows(tenantA.tenantId, "visit.reopen_for_amendment", v.visitId)).toHaveLength(1);
  });

  it("two concurrent finalizes of one reopened visit (different ids): one version bump; the other is AMENDMENT_NOT_OPEN", async () => {
    const v = await reopenedVisit(tenantA);
    const barrier = createBarrier(2);
    const [x, y] = await Promise.all([
      callFinalize(gateClient(tenantA.client, { rpc: { finalize_visit_amendment: barrier } }), finalizeArgs(tenantA, v.visitId)),
      callFinalize(gateClient(members.doctor.client, { rpc: { finalize_visit_amendment: barrier } }), finalizeArgs(tenantA, v.visitId)),
    ]);
    const failed = [x, y].filter((r) => r.error);
    expect(failed).toHaveLength(1);
    expect(mapDbError(failed[0].error)).toMatchObject({ code: "CONFLICT", reason: "AMENDMENT_NOT_OPEN" });
    expect((await prescriptionsOfVisit(v.visitId))[0].version).toBe(2);
    expect(await auditRows(tenantA.tenantId, "visit.amend_finalized", v.visitId)).toHaveLength(1);
    // The replay queues no second prescription.issued.
    expect(await outboxRows(tenantA.tenantId, "prescription.issued", v.prescriptionIds[0])).toHaveLength(2);
  });
});

describe("amendment commands: who may call them", () => {
  it.each(ROLES)("%s: both commands are allowed exactly when the matrix grants consultations:edit", async (role) => {
    const v = await signedVisit(tenantA);
    const reopen = await callReopen(members[role].client, reopenArgs(tenantA, v.visitId));
    if (hasPerm(role, "consultations:edit")) {
      expect(reopen.error).toBeNull();
      const finalize = await callFinalize(members[role].client, finalizeArgs(tenantA, v.visitId));
      expect(finalize.error).toBeNull();
      expect((await visitRow(v.visitId)).signed_by).toBe(members[role].userId);
    } else {
      expect(reopen.error?.code).toBe("42501");
      expect((await callFinalize(members[role].client, finalizeArgs(tenantA, v.visitId))).error?.code).toBe("42501");
      expect(await visitRow(v.visitId)).toMatchObject({ status: "completed", current_revision: 1 });
      expect(await revisionsOfVisit(v.visitId)).toEqual([]);
    }
  });

  it("anon cannot execute either command (42501)", async () => {
    const v = await signedVisit(tenantA);
    const anon = createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    }) as TestDb;
    expect((await callReopen(anon, reopenArgs(tenantA, v.visitId))).error?.code).toBe("42501");
    expect((await callFinalize(anon, finalizeArgs(tenantA, v.visitId))).error?.code).toBe("42501");
    expect(await revisionsOfVisit(v.visitId)).toEqual([]);
  });

  it("another clinic's visit is NOT_FOUND, whichever clinic is named, and nothing is written", async () => {
    const visitB = await signedVisit(tenantB, { doctor: tenantB });
    for (const named of [tenantA, tenantB]) {
      for (const res of [
        await callReopen(tenantA.client, reopenArgs(named, visitB.visitId)),
        await callFinalize(tenantA.client, finalizeArgs(named, visitB.visitId)),
      ]) {
        expect(res.error).toMatchObject({ code: "P0002", message: "VISIT_NOT_FOUND" });
        expect(mapDbError(res.error).code).toBe("NOT_FOUND");
      }
    }
    expect(await visitRow(visitB.visitId)).toMatchObject({ status: "completed", current_revision: 1 });
    expect(await revisionsOfVisit(visitB.visitId)).toEqual([]);
  });

  it("a member of A and B acting in A cannot amend B's visit, naming B or A, but can in B", async () => {
    const visitB = await signedVisit(tenantB, { doctor: tenantB });
    const dual = await createDualMembershipUser(tenantA.tenantId, "doctor", tenantB.tenantId, "doctor");
    const actingInA = await signInActingIn(dual.userEmail, tenantA.tenantId);
    for (const named of [tenantB, tenantA]) {
      expect((await callReopen(actingInA, reopenArgs(named, visitB.visitId))).error).toMatchObject({ code: "P0002", message: "VISIT_NOT_FOUND" });
      expect((await callFinalize(actingInA, finalizeArgs(named, visitB.visitId))).error).toMatchObject({ code: "P0002", message: "VISIT_NOT_FOUND" });
    }
    expect(await revisionsOfVisit(visitB.visitId)).toEqual([]);

    const actingInB = await signInActingIn(dual.userEmail, tenantB.tenantId);
    const ok = await callReopen(actingInB, reopenArgs(tenantB, visitB.visitId));
    expect(ok.error).toBeNull();
    expect(await auditRows(tenantB.tenantId, "visit.reopen_for_amendment", visitB.visitId)).toEqual([
      expect.objectContaining({ actor_id: dual.userId, actor_role: "doctor", actor_type: "user" }),
    ]);
  });
});

describe("amendment (service)", () => {
  it("reopens and finalizes through the commands, replays on the same id, and keeps the fixed refusal texts", async () => {
    const v = await signedVisit(tenantA);
    const doctorCtx = ctxFor(members.doctor);

    const short = await reopenVisitForAmendment(doctorCtx, v.visitId, "too short", randomUUID());
    expect(short).toMatchObject({
      success: false,
      error: "A valid reason for amendment of at least 10 characters is required for medical audit compliance.",
      code: "VALIDATION_FAILED",
    });

    const id = randomUUID();
    const reopened = await reopenVisitForAmendment(doctorCtx, v.visitId, "Synthetic amendment reason text", id);
    expect(reopened).toEqual({ success: true, visitId: v.visitId, revisionNumber: 1, replayed: false });
    expect(await reopenVisitForAmendment(doctorCtx, v.visitId, "Synthetic amendment reason text", id)).toMatchObject({ success: true, replayed: true });
    expect(await reopenVisitForAmendment(doctorCtx, v.visitId, "Synthetic amendment reason text", randomUUID())).toMatchObject({
      success: false,
      error: "Only signed, completed consultations can be reopened for amendment.",
      reason: "VISIT_NOT_SIGNED",
    });

    const finalizeId = randomUUID();
    expect(await finalizeVisitAmendment(doctorCtx, v.visitId, finalizeId)).toEqual({ success: true, visitId: v.visitId, version: 2, replayed: false });
    expect(await finalizeVisitAmendment(doctorCtx, v.visitId, finalizeId)).toMatchObject({ success: true, version: 2, replayed: true });
    expect(await finalizeVisitAmendment(doctorCtx, v.visitId, randomUUID())).toMatchObject({ success: false, reason: "AMENDMENT_NOT_OPEN" });
    expect(await finalizeVisitAmendment(doctorCtx, v.visitId, "not-a-uuid")).toMatchObject({ success: false, code: "VALIDATION_FAILED" });
  });

  // F-11 (07-04a): the reason has two bounds and each has its own message.
  it("a reason of more than 500 characters gets its own message (not the 'at least 10 characters' one) and no command runs", async () => {
    const v = await signedVisit(tenantA);
    const doctorCtx = ctxFor(members.doctor);
    const long = await reopenVisitForAmendment(doctorCtx, v.visitId, "r".repeat(501), randomUUID());
    expect(long).toMatchObject({
      success: false,
      error: AMENDMENT_REASON_TOO_LONG_MESSAGE,
      code: "VALIDATION_FAILED",
      reason: "AMENDMENT_REASON_INVALID",
    });
    expect(AMENDMENT_REASON_TOO_LONG_MESSAGE).not.toBe(AMENDMENT_REASON_TOO_SHORT_MESSAGE);
    expect(AMENDMENT_REASON_TOO_LONG_MESSAGE).toMatch(/500/);
    const short = await reopenVisitForAmendment(doctorCtx, v.visitId, "too short", randomUUID());
    expect(short).toMatchObject({ success: false, error: AMENDMENT_REASON_TOO_SHORT_MESSAGE });
    expect(await revisionsOfVisit(v.visitId)).toEqual([]);
    // The limits themselves are in: 10 and 500 characters are accepted.
    expect((await reopenVisitForAmendment(doctorCtx, v.visitId, "r".repeat(500), randomUUID())).success).toBe(true);
  });

  // F-7 (07-04a): the amended PDF is rendered after a replay when its version is not archived (the first call may have died
  // right after the commit); it reads the reason from the amendment row now that the stored result holds none (F-5).
  it("a replayed finalize renders the missing amended PDF, stamped with the reason from the revision, and renders nothing when it is archived", async () => {
    const admin = getAdminClient();
    const v = await signedVisit(tenantA);
    const doctorCtx = ctxFor(members.doctor);
    expect((await reopenVisitForAmendment(doctorCtx, v.visitId, "Synthetic amendment reason text", randomUUID())).success).toBe(true);
    const finalizeId = randomUUID();
    const pdfPath = async () => (await admin.from("prescriptions").select("pdf_storage_path").eq("visit_id", v.visitId).single()).data?.pdf_storage_path ?? null;
    const archives = async () => (await auditRows(tenantA.tenantId, "prescription.generate_pdf", v.prescriptionIds[0])).length;

    expect(await finalizeVisitAmendment(doctorCtx, v.visitId, finalizeId)).toMatchObject({ success: true, version: 2, replayed: false });
    expect(await pdfPath()).toMatch(/rx_v2\.pdf$/);
    const archived = await archives();

    expect(await finalizeVisitAmendment(doctorCtx, v.visitId, finalizeId)).toMatchObject({ success: true, version: 2, replayed: true });
    expect(await archives()).toBe(archived);

    await admin.from("prescriptions").update({ pdf_storage_path: null }).eq("visit_id", v.visitId);
    expect(await finalizeVisitAmendment(doctorCtx, v.visitId, finalizeId)).toMatchObject({ success: true, version: 2, replayed: true });
    expect(await pdfPath()).toMatch(/rx_v2\.pdf$/);
    expect(await archives()).toBe(archived + 1);
  });

  it("a receptionist is refused with the permission text before any command runs", async () => {
    const v = await signedVisit(tenantA);
    const ctx = ctxFor(members.receptionist);
    for (const res of [
      await reopenVisitForAmendment(ctx, v.visitId, "Synthetic amendment reason text", randomUUID()),
      await finalizeVisitAmendment(ctx, v.visitId, randomUUID()),
    ]) {
      expect(res.success).toBe(false);
      expect((res as { error: string }).error).toMatch(/permission/i);
    }
    expect(await revisionsOfVisit(v.visitId)).toEqual([]);
  });
});
