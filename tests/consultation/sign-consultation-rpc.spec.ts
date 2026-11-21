/**
 * V2-07 07-01 (R-1, R-2, R-3, R-4): `public.sign_consultation`, the sign-off as one atomic command.
 *
 * The visit's signature, the sealed prescriptions, the `visit.complete_and_sign` audit row and the `visit.completed` /
 * `prescription.issued` outbox rows commit together or not at all; the same client_request_id replays the first result.
 * SECURITY DEFINER; consultations:edit only (owner, doctor). Called through the caller's own client; rows are seeded
 * and read back with the service-role client. Synthetic data only.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import { mapDbError } from "@/lib/db/errors";
import { hasPerm } from "@/lib/permissions";
import type { UserRole } from "@/lib/db/types";
import { completeAndSignConsultation } from "@/features/consultation/service";
import { addMemberToTenant, createDualMembershipUser, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import type { TestDb } from "../helpers/db";
import { ctxFor } from "../helpers/context";
import { signInActingIn } from "../helpers/active-tenant";
import { installScopedFault, leftoverFaults, withFault } from "../helpers/fault";
import { expectCommandCatalog } from "../helpers/command-catalog";
import { createBarrier, gateClient } from "../helpers/write-barrier";
import { getAdminClient } from "../helpers/supabase-admin";
import { psql } from "../helpers/sql";
import { auditRows, commandResultRows, expectDataOnlyStoredResult } from "../helpers/billing-commands";
import {
  callSign,
  deactivateSubscription,
  outboxRows,
  prescriptionsOfVisit,
  seedClinicalVisit,
  signArgs,
  subscribeSignEvents,
  visitRow,
} from "../helpers/clinical-commands";

const ROLES: UserRole[] = ["owner", "admin", "doctor", "nurse", "receptionist"];

let tenantA: SeededTenant;
let tenantB: SeededTenant;
let tenantNoHooks: SeededTenant;
let subscriptionA: string;
const members = {} as Record<UserRole, SeededTenant>;

beforeAll(async () => {
  tenantA = await seedTenantWithOwner("CI Sign Clinic A");
  tenantB = await seedTenantWithOwner("CI Sign Clinic B");
  tenantNoHooks = await seedTenantWithOwner("CI Sign Clinic No Hooks");
  members.owner = tenantA;
  for (const role of ROLES.filter((r) => r !== "owner")) members[role] = await addMemberToTenant(tenantA.tenantId, role);
  subscriptionA = await subscribeSignEvents(tenantA);
});

afterAll(async () => {
  await deactivateSubscription(subscriptionA);
  expect(leftoverFaults()).toBe(0);
});

/** Everything a sign-off writes for one visit: audit, outbox (visit + each prescription) and the claim. */
async function writes(tenantId: string, visitId: string, rxIds: string[], requestId?: string) {
  return {
    audit: (await auditRows(tenantId, "visit.complete_and_sign", visitId)).length,
    completed: (await outboxRows(tenantId, "visit.completed", visitId)).length,
    issued: (await Promise.all(rxIds.map((id) => outboxRows(tenantId, "prescription.issued", id)))).flat().length,
    claim: requestId ? commandResultRows(tenantId, requestId).length : 0,
  };
}

describe("sign_consultation: catalog", () => {
  it("is DEFINER with the pinned settings, EXECUTE for authenticated only, and a required p_client_request_id", () => {
    expectCommandCatalog({ signature: "public.sign_consultation(uuid, uuid, uuid)", definer: true });
  });

  it("the shared step has no API grant", () => {
    expect(
      psql(
        `select has_function_privilege('authenticated', 'private.step_sign_consultation(uuid, uuid)', 'EXECUTE')::text || ',' || ` +
          `has_function_privilege('service_role', 'private.step_sign_consultation(uuid, uuid)', 'EXECUTE')::text`
      )
    ).toEqual(["false,false"]);
  });
});

describe("sign_consultation: one transaction", () => {
  it("happy path: visit signed by the caller, every active prescription sealed, audit, outbox and claim commit together", async () => {
    const v = await seedClinicalVisit(tenantA, { doctorId: members.doctor.userId, diagnosis: true, prescriptions: 2 });
    const args = signArgs(tenantA, v.visitId);
    const { data, error } = await callSign(members.doctor.client, args);
    expect(error).toBeNull();
    expect(data).toMatchObject({ visit_id: v.visitId, sealed_prescriptions: 2, replayed: false });

    const visit = await visitRow(v.visitId);
    expect(visit).toMatchObject({ status: "completed", signed_by: members.doctor.userId });
    expect(visit.signed_at).not.toBeNull();
    expect((data as { signed_at: string }).signed_at).toBeTruthy();
    const rx = await prescriptionsOfVisit(v.visitId);
    expect(rx).toHaveLength(2);
    for (const row of rx) expect(row.signed_at).not.toBeNull();

    expect(await auditRows(tenantA.tenantId, "visit.complete_and_sign", v.visitId)).toEqual([
      expect.objectContaining({
        actor_id: members.doctor.userId,
        actor_role: "doctor",
        actor_type: "user",
        entity_type: "visit",
        metadata: { version: 1 },
      }),
    ]);

    // Outbox: one visit.completed and one prescription.issued per sealed prescription (event key ...:signed).
    const completed = await outboxRows(tenantA.tenantId, "visit.completed", v.visitId);
    expect(completed).toEqual([expect.objectContaining({ subscription_id: subscriptionA, event_key: `visit.completed:${v.visitId}` })]);
    expect(JSON.parse(completed[0].payload).data).toMatchObject({ visit_id: v.visitId, doctor_id: members.doctor.userId });
    // V2-09a 000108 (R-10): the event data carries the header's version, and the key of version n > 1 ends :v<n> (the seed makes versions 1..n).
    for (const [index, id] of v.prescriptionIds.entries()) {
      const version = index + 1;
      const issued = await outboxRows(tenantA.tenantId, "prescription.issued", id);
      expect(issued).toEqual([
        expect.objectContaining({ subscription_id: subscriptionA, event_key: `prescription.issued:${id}:signed${version > 1 ? `:v${version}` : ""}` }),
      ]);
      expect(JSON.parse(issued[0].payload).data).toEqual({ prescription_id: id, patient_id: v.patientId, visit_id: v.visitId, version });
    }
    expect(commandResultRows(tenantA.tenantId, args.p_client_request_id)).toEqual(["public.sign_consultation|true"]);
    // F-5 (07-04a): the stored result holds ids, numbers, amounts, statuses and flags only, no free text.
    expectDataOnlyStoredResult(tenantA.tenantId, args.p_client_request_id);
  });

  it("a clinic without a webhook subscription: signed and audited, no outbox row", async () => {
    const v = await seedClinicalVisit(tenantNoHooks, { diagnosis: true, prescriptions: 1 });
    const { error } = await callSign(tenantNoHooks.client, signArgs(tenantNoHooks, v.visitId));
    expect(error).toBeNull();
    expect((await visitRow(v.visitId)).status).toBe("completed");
    expect(await writes(tenantNoHooks.tenantId, v.visitId, v.prescriptionIds)).toEqual({ audit: 1, completed: 0, issued: 0, claim: 0 });
  });

  it("a visit without a prescription signs with nothing to seal and raises only visit.completed", async () => {
    const v = await seedClinicalVisit(tenantA, { doctorId: members.doctor.userId, prescriptions: 0 });
    const { data, error } = await callSign(members.doctor.client, signArgs(tenantA, v.visitId));
    expect(error).toBeNull();
    expect(data).toMatchObject({ sealed_prescriptions: 0 });
    expect(await writes(tenantA.tenantId, v.visitId, [])).toMatchObject({ audit: 1, completed: 1, issued: 0 });
  });

  it("a diagnosis alone is enough; neither a diagnosis nor a (non-blank) note is SIGN_CONTENT_REQUIRED and writes nothing", async () => {
    const withDiagnosis = await seedClinicalVisit(tenantA, { notes: null, diagnosis: true, prescriptions: 0 });
    expect((await callSign(tenantA.client, signArgs(tenantA, withDiagnosis.visitId))).error).toBeNull();

    for (const notes of [null, "   "]) {
      const v = await seedClinicalVisit(tenantA, { notes, prescriptions: 1 });
      const args = signArgs(tenantA, v.visitId);
      const res = await callSign(tenantA.client, args);
      expect(res.data).toBeNull();
      expect(res.error).toMatchObject({ code: "P0001", message: "SIGN_CONTENT_REQUIRED" });
      expect(mapDbError(res.error)).toMatchObject({ code: "PRECONDITION_FAILED", reason: "SIGN_CONTENT_REQUIRED" });
      expect((await visitRow(v.visitId)).signed_at).toBeNull();
      expect(await writes(tenantA.tenantId, v.visitId, v.prescriptionIds, args.p_client_request_id)).toEqual({ audit: 0, completed: 0, issued: 0, claim: 0 });
    }
  });

  it("rollback: a fault on the prescription update leaves the visit unsigned, no audit, no outbox, no claim; the same id then succeeds", async () => {
    const marker = `CI-FAULT-${randomUUID().slice(0, 8)}`;
    const v = await seedClinicalVisit(tenantA, { diagnosis: true, prescriptions: 1, marker });
    const args = signArgs(tenantA, v.visitId);

    await withFault({ table: "public.prescriptions", column: "amendment_reason", marker, event: "update" }, async () => {
      const { data, error } = await callSign(tenantA.client, args);
      expect(data).toBeNull();
      expect(error?.code).toBe("XX000");
    });

    expect(await visitRow(v.visitId)).toMatchObject({ status: "waiting", signed_at: null, signed_by: null });
    expect((await prescriptionsOfVisit(v.visitId))[0].signed_at).toBeNull();
    expect(await writes(tenantA.tenantId, v.visitId, v.prescriptionIds, args.p_client_request_id)).toEqual({ audit: 0, completed: 0, issued: 0, claim: 0 });

    const retry = await callSign(tenantA.client, args);
    expect(retry.error).toBeNull();
    expect(retry.data).toMatchObject({ replayed: false, sealed_prescriptions: 1 });
  });

  it("rollback: a fault in the outbox insert (the last write) takes the signature, the seal and the audit row with it", async () => {
    const v = await seedClinicalVisit(tenantA, { diagnosis: true, prescriptions: 1 });
    const hook = await subscribeSignEvents(tenantA);
    const fault = installScopedFault({ table: "public.webhook_delivery_queue", column: "subscription_id", marker: hook });
    const args = signArgs(tenantA, v.visitId);
    try {
      const { data, error } = await callSign(tenantA.client, args);
      expect(data).toBeNull();
      expect(error?.code).toBe("XX000");
    } finally {
      fault.remove();
      await deactivateSubscription(hook);
    }
    expect(await visitRow(v.visitId)).toMatchObject({ status: "waiting", signed_at: null });
    expect((await prescriptionsOfVisit(v.visitId))[0].signed_at).toBeNull();
    expect(await writes(tenantA.tenantId, v.visitId, v.prescriptionIds, args.p_client_request_id)).toEqual({ audit: 0, completed: 0, issued: 0, claim: 0 });
  });

  it("a visit that is already signed is ALREADY_SIGNED and nothing changes", async () => {
    const v = await seedClinicalVisit(tenantA, { diagnosis: true, prescriptions: 1 });
    const first = await callSign(tenantA.client, signArgs(tenantA, v.visitId));
    expect(first.error).toBeNull();
    const signedAt = (await visitRow(v.visitId)).signed_at;

    const again = signArgs(tenantA, v.visitId);
    const res = await callSign(members.doctor.client, again);
    expect(res.error).toMatchObject({ code: "P0001", message: "ALREADY_SIGNED" });
    expect(mapDbError(res.error)).toMatchObject({ code: "CONFLICT", reason: "ALREADY_SIGNED" });
    expect(await visitRow(v.visitId)).toMatchObject({ signed_at: signedAt, signed_by: tenantA.userId });
    expect(await writes(tenantA.tenantId, v.visitId, v.prescriptionIds, again.p_client_request_id)).toEqual({ audit: 1, completed: 1, issued: 1, claim: 0 });
  });
});

// F-6 (07-04a): only a visit in the queue or in the consultation is signed (a signature emits guaranteed webhooks).
describe("sign_consultation: the visit's status", () => {
  it.each(["booked", "confirmed", "cancelled", "no_show"] as const)("a %s visit is VISIT_NOT_SIGNABLE: nothing is signed, audited or queued", async (status) => {
    const v = await seedClinicalVisit(tenantA, { diagnosis: true, status });
    const args = signArgs(tenantA, v.visitId);
    const res = await callSign(members.doctor.client, args);
    expect(res.error).toMatchObject({ code: "P0001", message: "VISIT_NOT_SIGNABLE" });
    expect(mapDbError(res.error)).toMatchObject({ code: "CONFLICT", reason: "VISIT_NOT_SIGNABLE" });
    expect(await visitRow(v.visitId)).toMatchObject({ status, signed_at: null });
    expect(await auditRows(tenantA.tenantId, "visit.complete_and_sign", v.visitId)).toEqual([]);
    expect(await outboxRows(tenantA.tenantId, "visit.completed", v.visitId)).toEqual([]);
    expect(commandResultRows(tenantA.tenantId, args.p_client_request_id)).toEqual([]);
  });

  it.each(["waiting", "in_consultation"] as const)("a %s visit is signed", async (status) => {
    const v = await seedClinicalVisit(tenantA, { diagnosis: true, status });
    expect((await callSign(members.doctor.client, signArgs(tenantA, v.visitId))).error).toBeNull();
    expect(await visitRow(v.visitId)).toMatchObject({ status: "completed", signed_by: members.doctor.userId });
  });

  it("the service reports it with the fixed 'check the patient in' text", async () => {
    const v = await seedClinicalVisit(tenantA, { diagnosis: true, status: "booked", doctorId: members.doctor.userId });
    expect(await completeAndSignConsultation(ctxFor(members.doctor), v.visitId, randomUUID())).toMatchObject({
      success: false,
      error: "Check the patient in before signing this consultation.",
      code: "CONFLICT",
      reason: "VISIT_NOT_SIGNABLE",
    });
  });
});

describe("sign_consultation: idempotency and races", () => {
  it("the same id twice: the first result with replayed: true, one audit row, one outbox set", async () => {
    const v = await seedClinicalVisit(tenantA, { diagnosis: true, prescriptions: 1 });
    const args = signArgs(tenantA, v.visitId);
    const first = await callSign(tenantA.client, args);
    const second = await callSign(tenantA.client, args);
    expect(second.error).toBeNull();
    expect(second.data).toEqual({ ...(first.data as object), replayed: true });
    expect(await writes(tenantA.tenantId, v.visitId, v.prescriptionIds)).toEqual({ audit: 1, completed: 1, issued: 1, claim: 0 });
  });

  it("the same id for another visit, or the id of another command, is IDEMPOTENCY_MISMATCH and writes nothing", async () => {
    const v = await seedClinicalVisit(tenantA, { diagnosis: true, prescriptions: 0 });
    const other = await seedClinicalVisit(tenantA, { diagnosis: true, prescriptions: 0 });
    const args = signArgs(tenantA, v.visitId);
    expect((await callSign(tenantA.client, args)).error).toBeNull();
    const res = await callSign(tenantA.client, { ...args, p_visit_id: other.visitId });
    expect(mapDbError(res.error)).toMatchObject({ code: "IDEMPOTENCY_MISMATCH" });
    expect((await visitRow(other.visitId)).signed_at).toBeNull();

    const id = randomUUID();
    const checkIn = await tenantA.client.rpc("check_in_visit", { p_tenant_id: tenantA.tenantId, p_visit_id: other.visitId, p_priority: "normal", p_client_request_id: id });
    expect(checkIn.error).toBeNull();
    const reused = await callSign(tenantA.client, signArgs(tenantA, other.visitId, { p_client_request_id: id }));
    expect(mapDbError(reused.error)).toMatchObject({ code: "IDEMPOTENCY_MISMATCH" });
    expect((await visitRow(other.visitId)).signed_at).toBeNull();
  });

  it("two concurrent sign-offs of one visit (different ids): one signature, one audit row, one outbox set; the other is ALREADY_SIGNED", async () => {
    const v = await seedClinicalVisit(tenantA, { doctorId: members.doctor.userId, diagnosis: true, prescriptions: 2 });
    const barrier = createBarrier(2);
    const [x, y] = await Promise.all([
      callSign(gateClient(tenantA.client, { rpc: { sign_consultation: barrier } }), signArgs(tenantA, v.visitId)),
      callSign(gateClient(members.doctor.client, { rpc: { sign_consultation: barrier } }), signArgs(tenantA, v.visitId)),
    ]);
    const failed = [x, y].filter((r) => r.error);
    expect(failed).toHaveLength(1);
    expect(mapDbError(failed[0].error)).toMatchObject({ code: "CONFLICT", reason: "ALREADY_SIGNED" });
    const winner = [x, y].find((r) => !r.error)!;
    expect(winner.data).toMatchObject({ sealed_prescriptions: 2, replayed: false });

    const visit = await visitRow(v.visitId);
    expect(visit.status).toBe("completed");
    expect([tenantA.userId, members.doctor.userId]).toContain(visit.signed_by);
    expect(await writes(tenantA.tenantId, v.visitId, v.prescriptionIds)).toEqual({ audit: 1, completed: 1, issued: 2, claim: 0 });
  });

  it("two concurrent submits of one id: the loser replays the winner's result", async () => {
    const v = await seedClinicalVisit(tenantA, { diagnosis: true, prescriptions: 1 });
    const args = signArgs(tenantA, v.visitId);
    const barrier = createBarrier(2);
    const [x, y] = await Promise.all([
      callSign(gateClient(tenantA.client, { rpc: { sign_consultation: barrier } }), args),
      callSign(gateClient(tenantA.client, { rpc: { sign_consultation: barrier } }), args),
    ]);
    expect(x.error).toBeNull();
    expect(y.error).toBeNull();
    expect([(x.data as { replayed: boolean }).replayed, (y.data as { replayed: boolean }).replayed].sort()).toEqual([false, true]);
    expect(await writes(tenantA.tenantId, v.visitId, v.prescriptionIds)).toEqual({ audit: 1, completed: 1, issued: 1, claim: 0 });
  });
});

describe("sign_consultation: input", () => {
  it("a missing request id and a missing visit are refused and write nothing", async () => {
    const v = await seedClinicalVisit(tenantA, { diagnosis: true, prescriptions: 0 });
    const noId = await callSign(tenantA.client, signArgs(tenantA, v.visitId, { p_client_request_id: null as unknown as string }));
    expect(noId.error).toMatchObject({ code: "P0001", message: "CLIENT_REQUEST_ID_REQUIRED" });
    const noVisit = await callSign(tenantA.client, signArgs(tenantA, v.visitId, { p_visit_id: null as unknown as string }));
    expect(noVisit.error).toMatchObject({ code: "P0001", message: "INPUT_INVALID" });
    expect((await visitRow(v.visitId)).signed_at).toBeNull();
  });
});

describe("sign_consultation: who may call it", () => {
  it.each(ROLES)("%s: allowed exactly when the matrix grants consultations:edit", async (role) => {
    const v = await seedClinicalVisit(tenantA, { doctorId: members.doctor.userId, diagnosis: true, prescriptions: 1 });
    const { error } = await callSign(members[role].client, signArgs(tenantA, v.visitId));
    if (hasPerm(role, "consultations:edit")) {
      expect(error).toBeNull();
      expect((await visitRow(v.visitId)).signed_by).toBe(members[role].userId);
    } else {
      expect(error?.code).toBe("42501");
      expect(await visitRow(v.visitId)).toMatchObject({ status: "waiting", signed_at: null });
      expect(await writes(tenantA.tenantId, v.visitId, v.prescriptionIds)).toEqual({ audit: 0, completed: 0, issued: 0, claim: 0 });
    }
  });

  it("anon cannot execute it (42501)", async () => {
    const v = await seedClinicalVisit(tenantA, { diagnosis: true, prescriptions: 0 });
    const anon = createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    }) as TestDb;
    const { data, error } = await callSign(anon, signArgs(tenantA, v.visitId));
    expect(data).toBeNull();
    expect(error?.code).toBe("42501");
    expect((await visitRow(v.visitId)).signed_at).toBeNull();
  });

  it("another clinic's visit is NOT_FOUND, whichever clinic is named, and nothing is written", async () => {
    const visitB = await seedClinicalVisit(tenantB, { diagnosis: true, prescriptions: 1 });
    for (const named of [tenantA, tenantB]) {
      const res = await callSign(tenantA.client, signArgs(named, visitB.visitId));
      expect(res.error).toMatchObject({ code: "P0002", message: "VISIT_NOT_FOUND" });
      expect(mapDbError(res.error).code).toBe("NOT_FOUND");
    }
    expect(await visitRow(visitB.visitId)).toMatchObject({ status: "waiting", signed_at: null });
    expect(await writes(tenantB.tenantId, visitB.visitId, visitB.prescriptionIds)).toEqual({ audit: 0, completed: 0, issued: 0, claim: 0 });
  });

  it("a member of A and B acting in A cannot sign B's visit, naming B or A, but can in B", async () => {
    const visitB = await seedClinicalVisit(tenantB, { diagnosis: true, prescriptions: 1 });
    const dual = await createDualMembershipUser(tenantA.tenantId, "doctor", tenantB.tenantId, "doctor");
    const actingInA = await signInActingIn(dual.userEmail, tenantA.tenantId);
    for (const named of [tenantB, tenantA]) {
      const res = await callSign(actingInA, signArgs(named, visitB.visitId));
      expect(res.error).toMatchObject({ code: "P0002", message: "VISIT_NOT_FOUND" });
    }
    expect((await visitRow(visitB.visitId)).signed_at).toBeNull();

    const actingInB = await signInActingIn(dual.userEmail, tenantB.tenantId);
    const ok = await callSign(actingInB, signArgs(tenantB, visitB.visitId));
    expect(ok.error).toBeNull();
    expect(await auditRows(tenantB.tenantId, "visit.complete_and_sign", visitB.visitId)).toEqual([
      expect.objectContaining({ actor_id: dual.userId, actor_role: "doctor", actor_type: "user" }),
    ]);
  });
});

describe("completeAndSignConsultation (service)", () => {
  it("signs, replays on the same id, and refuses a signed visit and a malformed id with fixed texts", async () => {
    const v = await seedClinicalVisit(tenantA, { doctorId: members.doctor.userId, diagnosis: true, prescriptions: 1 });
    const id = randomUUID();
    const first = await completeAndSignConsultation(ctxFor(members.doctor), v.visitId, id);
    expect(first).toEqual({ success: true, visitId: v.visitId, replayed: false });
    expect(await completeAndSignConsultation(ctxFor(members.doctor), v.visitId, id)).toEqual({ success: true, visitId: v.visitId, replayed: true });

    expect(await completeAndSignConsultation(ctxFor(members.doctor), v.visitId, randomUUID())).toMatchObject({
      success: false,
      error: "This consultation is already signed.",
      code: "CONFLICT",
      reason: "ALREADY_SIGNED",
    });
    expect(await completeAndSignConsultation(ctxFor(members.doctor), v.visitId, "not-a-uuid")).toMatchObject({ success: false, code: "VALIDATION_FAILED" });
    expect(await auditRows(tenantA.tenantId, "visit.complete_and_sign", v.visitId)).toHaveLength(1);
  });

  // F-7 (07-04a): a replay means the first call's response may have been lost after the commit, so the archive that follows
  // the commit is made then too, when it is missing; an archive that is already there is left alone (write-once since V2-09a 000109:
  // a recorded path and hash can no longer be cleared to fake a lost archive, so the loss is simulated honestly: the command runs
  // alone, as when the process died between the commit and the archive).
  it("a replay archives the prescription PDF when the first call's post-commit step never ran, and does nothing when it did", async () => {
    const admin = getAdminClient();
    const v = await seedClinicalVisit(tenantA, { doctorId: members.doctor.userId, diagnosis: true, prescriptions: 1 });
    const id = randomUUID();
    const pdfPath = async () => (await admin.from("prescriptions").select("pdf_storage_path").eq("visit_id", v.visitId).single()).data?.pdf_storage_path ?? null;
    const archives = async () => (await auditRows(tenantA.tenantId, "prescription.generate_pdf", v.prescriptionIds[0])).length;

    // The first call died right after the commit: the command ran, the archive never did.
    const first = await callSign(members.doctor.client, signArgs(tenantA, v.visitId, { p_client_request_id: id }));
    expect(first.error).toBeNull();
    expect(await pdfPath()).toBeNull();
    expect(await archives()).toBe(0);
    // The replay finds the archive missing and makes it, once.
    expect(await completeAndSignConsultation(ctxFor(members.doctor), v.visitId, id)).toMatchObject({ success: true, replayed: true });
    expect(await pdfPath()).toMatch(/rx_v1\.pdf$/);
    expect(await archives()).toBe(1);
    // Untouched replay: the archive is there, nothing is rendered again.
    expect(await completeAndSignConsultation(ctxFor(members.doctor), v.visitId, id)).toMatchObject({ success: true, replayed: true });
    expect(await archives()).toBe(1);
    expect(await auditRows(tenantA.tenantId, "visit.complete_and_sign", v.visitId)).toHaveLength(1);
  });

  it("a first call signs and archives in one step: the archive is recorded once and the replay does not repeat it", async () => {
    const admin = getAdminClient();
    const v = await seedClinicalVisit(tenantA, { doctorId: members.doctor.userId, diagnosis: true, prescriptions: 1 });
    const id = randomUUID();
    expect(await completeAndSignConsultation(ctxFor(members.doctor), v.visitId, id)).toMatchObject({ success: true, replayed: false });
    const { data } = await admin.from("prescriptions").select("pdf_storage_path, pdf_sha256").eq("visit_id", v.visitId).single();
    expect(data?.pdf_storage_path).toMatch(/rx_v1\.pdf$/);
    expect(data?.pdf_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect((await auditRows(tenantA.tenantId, "prescription.generate_pdf", v.prescriptionIds[0])).length).toBe(1);
    expect(await completeAndSignConsultation(ctxFor(members.doctor), v.visitId, id)).toMatchObject({ success: true, replayed: true });
    expect((await auditRows(tenantA.tenantId, "prescription.generate_pdf", v.prescriptionIds[0])).length).toBe(1);
  });

  it("a fault is a fixed message, never the driver's text", async () => {
    const marker = `CI-FAULT-${randomUUID().slice(0, 8)}`;
    const v = await seedClinicalVisit(tenantA, { diagnosis: true, prescriptions: 1, marker });
    await withFault({ table: "public.prescriptions", column: "amendment_reason", marker, event: "update" }, async () => {
      const res = await completeAndSignConsultation(ctxFor(tenantA), v.visitId, randomUUID());
      expect(res).toMatchObject({ success: false, error: "Failed to complete and sign consultation.", code: "INTERNAL" });
      expect(JSON.stringify(res)).not.toContain("SPIKE_FAULT");
    });
    expect((await visitRow(v.visitId)).signed_at).toBeNull();
  });

  it("the actor's role is checked before the command (a receptionist is refused with the permission text)", async () => {
    const v = await seedClinicalVisit(tenantA, { diagnosis: true, prescriptions: 0 });
    const res = await completeAndSignConsultation(ctxFor(members.receptionist), v.visitId, randomUUID());
    expect(res.success).toBe(false);
    expect((res as { error: string }).error).toMatch(/permission/i);
    expect((await visitRow(v.visitId)).signed_at).toBeNull();
  });
});
