/**
 * V2-08 08-01b (R-7): `public.complete_visit`, desk completion as one atomic command.
 *
 * An unsigned waiting or in-consultation visit becomes `completed`, its queue token gets `completed_at` and the
 * `visit.complete_at_desk` audit row is written, in one transaction. A visit that is already completed (the checkout after a
 * sign-off) answers `already_completed`. Booked, confirmed, no-show, cancelled and a reopened signed visit are refused.
 * SECURITY DEFINER; appointments:edit. Synthetic data only.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import { mapDbError } from "@/lib/db/errors";
import { hasPerm } from "@/lib/permissions";
import type { UserRole } from "@/lib/db/types";
import { completeVisit } from "@/features/queue/service";
import { addMemberToTenant, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { getAdminClient } from "../helpers/supabase-admin";
import type { TestDb } from "../helpers/db";
import { ctxFor } from "../helpers/context";
import { leftoverFaults, withFault } from "../helpers/fault";
import { expectCommandCatalog } from "../helpers/command-catalog";
import { auditRows, commandResultRows, expectDataOnlyStoredResult, seedVisit } from "../helpers/billing-commands";
import { callCheckIn, callCompleteVisit, checkInArgs, completeVisitArgs, reopenVisitAs, seedClinicalVisit, signVisitAs, tokensOfVisit, visitRow } from "../helpers/clinical-commands";

const ROLES: UserRole[] = ["owner", "admin", "doctor", "nurse", "receptionist"];

let tenantA: SeededTenant;
let tenantB: SeededTenant;
const members = {} as Record<UserRole, SeededTenant>;

beforeAll(async () => {
  tenantA = await seedTenantWithOwner("CI CompleteVisit Clinic A");
  tenantB = await seedTenantWithOwner("CI CompleteVisit Clinic B");
  members.owner = tenantA;
  for (const role of ROLES.filter((r) => r !== "owner")) members[role] = await addMemberToTenant(tenantA.tenantId, role);
});

afterAll(() => {
  expect(leftoverFaults()).toBe(0);
});

const completeAudit = (visitId: string) => auditRows(tenantA.tenantId, "visit.complete_at_desk", visitId);

describe("complete_visit: catalog", () => {
  it("is DEFINER with the pinned settings, EXECUTE for authenticated only, and a required p_client_request_id", () => {
    expectCommandCatalog({ signature: "public.complete_visit(uuid, uuid, uuid)", definer: true });
  });
});

describe("complete_visit: one transaction", () => {
  it("a waiting visit completes: status, token completed_at, audit row and claim together", async () => {
    const status = "waiting";
    const { visitId } = await seedVisit(tenantA);
    const checkedIn = await callCheckIn(tenantA.client, checkInArgs(tenantA, visitId));
    expect(checkedIn.error).toBeNull();
    const args = completeVisitArgs(tenantA, visitId);
    const { data, error } = await callCompleteVisit(members.receptionist.client, args);
    expect(error).toBeNull();
    expect(data).toEqual({ visit_id: visitId, already_completed: false, replayed: false });
    expect((await visitRow(visitId)).status).toBe("completed");
    expect((await tokensOfVisit(visitId))[0].completed_at).not.toBeNull();
    expect(await completeAudit(visitId)).toEqual([
      expect.objectContaining({
        actor_id: members.receptionist.userId,
        actor_role: "receptionist",
        entity_type: "visit",
        metadata: { old_status: status, new_status: "completed" },
      }),
    ]);
    expect(commandResultRows(tenantA.tenantId, args.p_client_request_id)).toEqual(["public.complete_visit|true"]);
    expectDataOnlyStoredResult(tenantA.tenantId, args.p_client_request_id);
  });

  it("a visit that is already completed is a no-op that stamps a missing completed_at, with no audit row", async () => {
    const { visitId } = await seedVisit(tenantA, undefined, { status: "completed" });
    const first = await callCompleteVisit(tenantA.client, completeVisitArgs(tenantA, visitId));
    expect(first.error).toBeNull();
    expect(first.data).toEqual({ visit_id: visitId, already_completed: true, replayed: false });
    expect(await completeAudit(visitId)).toEqual([]);
    expect((await visitRow(visitId)).status).toBe("completed");

    // With a token that has no completion time: the checkout after a sign-off stamps it.
    // The sign-off is the command (V2-09a R-15: a system-path UPDATE can no longer sign a visit).
    const { visitId: withToken } = await seedClinicalVisit(tenantA, { status: "waiting" });
    await callCheckIn(tenantA.client, checkInArgs(tenantA, withToken));
    await signVisitAs(tenantA, withToken);
    expect((await tokensOfVisit(withToken))[0].completed_at).toBeNull();
    const stamped = await callCompleteVisit(tenantA.client, completeVisitArgs(tenantA, withToken));
    expect(stamped.data).toMatchObject({ already_completed: true });
    expect((await tokensOfVisit(withToken))[0].completed_at).not.toBeNull();
    expect(await completeAudit(withToken)).toEqual([]);
  });

  it.each(["booked", "confirmed", "no_show", "cancelled"] as const)("a %s visit is VISIT_NOT_COMPLETABLE: nothing changes", async (status) => {
    const { visitId } = await seedVisit(tenantA, undefined, { status });
    const args = completeVisitArgs(tenantA, visitId);
    const res = await callCompleteVisit(tenantA.client, args);
    expect(res.error).toMatchObject({ code: "P0001", message: "VISIT_NOT_COMPLETABLE" });
    expect(mapDbError(res.error)).toMatchObject({ code: "CONFLICT", reason: "VISIT_NOT_COMPLETABLE" });
    expect((await visitRow(visitId)).status).toBe(status);
    expect(await completeAudit(visitId)).toEqual([]);
    expect(commandResultRows(tenantA.tenantId, args.p_client_request_id)).toEqual([]);
  });

  // V2-08 08-06a (S-4): a desk completion of an open consultation left it unsigned for good (ALREADY_SIGNED for the doctor's sign-off,
  // no notes, no sealed prescriptions). It is completed only by the sign-off commands.
  it.each(["receptionist", "nurse", "admin", "owner", "doctor"] as const)("S-4: %s cannot complete an in_consultation visit at the desk (it stays open for the sign-off)", async (role) => {
    const { visitId } = await seedVisit(tenantA, members.doctor.userId);
    const checkedIn = await callCheckIn(tenantA.client, checkInArgs(tenantA, visitId));
    expect(checkedIn.error).toBeNull();
    await getAdminClient().from("visits").update({ status: "in_consultation" }).eq("id", visitId);
    const args = completeVisitArgs(tenantA, visitId);
    const res = await callCompleteVisit(members[role].client, args);
    expect(res.error).toMatchObject({ code: "P0001", message: "VISIT_NOT_COMPLETABLE" });
    expect((await visitRow(visitId)).status).toBe("in_consultation");
    expect(await completeAudit(visitId)).toEqual([]);
    expect((await tokensOfVisit(visitId))[0].completed_at).toBeNull();
    expect(commandResultRows(tenantA.tenantId, args.p_client_request_id)).toEqual([]);
  });

  it("a signed visit reopened for amendment (in_consultation) is VISIT_NOT_COMPLETABLE: only finalize_visit_amendment ends it", async () => {
    // Signed and reopened the way production does it (V2-09a R-15; a system-path UPDATE can no longer sign, and failed silently here).
    const { visitId } = await seedClinicalVisit(tenantA, { status: "waiting" });
    await signVisitAs(tenantA, visitId);
    await reopenVisitAs(tenantA, visitId);
    const res = await callCompleteVisit(tenantA.client, completeVisitArgs(tenantA, visitId));
    expect(res.error).toMatchObject({ code: "P0001", message: "VISIT_NOT_COMPLETABLE" });
    expect((await visitRow(visitId)).status).toBe("in_consultation");
  });

  it("rollback: a fault on the move to completed leaves the visit, the token and the audit log as they were; the same id then succeeds", async () => {
    const marker = `CI-FAULT-${randomUUID().slice(0, 8)}`;
    const { visitId } = await seedVisit(tenantA, undefined, { status: "waiting" });
    await callCheckIn(tenantA.client, checkInArgs(tenantA, visitId));
    await getAdminClient().from("visits").update({ reason_for_visit: marker }).eq("id", visitId);
    const args = completeVisitArgs(tenantA, visitId);

    await withFault({ table: "public.visits", column: "reason_for_visit", marker, event: "update", and: { column: "status", value: "completed" } }, async () => {
      const { data, error } = await callCompleteVisit(tenantA.client, args);
      expect(data).toBeNull();
      expect(error?.code).toBe("XX000");
      const viaService = await completeVisit(ctxFor(tenantA), visitId, randomUUID());
      expect(viaService).toMatchObject({ ok: false, error: { code: "INTERNAL", message: "Failed to complete the visit." } });
      expect(JSON.stringify(viaService)).not.toContain("SPIKE_FAULT");
    });
    expect((await visitRow(visitId)).status).toBe("waiting");
    expect((await tokensOfVisit(visitId))[0].completed_at).toBeNull();
    expect(await completeAudit(visitId)).toEqual([]);
    expect(commandResultRows(tenantA.tenantId, args.p_client_request_id)).toEqual([]);

    expect((await callCompleteVisit(tenantA.client, args)).error).toBeNull();
    expect((await visitRow(visitId)).status).toBe("completed");
  });
});

describe("complete_visit: idempotency and races", () => {
  it("the same id twice: one completion, one audit row, the first result with replayed: true", async () => {
    const { visitId } = await seedVisit(tenantA, undefined, { status: "waiting" });
    const args = completeVisitArgs(tenantA, visitId);
    const first = await callCompleteVisit(tenantA.client, args);
    const second = await callCompleteVisit(tenantA.client, args);
    expect(second.error).toBeNull();
    expect(second.data).toEqual({ ...(first.data as object), replayed: true });
    expect(await completeAudit(visitId)).toHaveLength(1);
  });

  it("the same id for another visit is IDEMPOTENCY_MISMATCH and writes nothing", async () => {
    const one = await seedVisit(tenantA, undefined, { status: "waiting" });
    const two = await seedVisit(tenantA, undefined, { status: "waiting" });
    const args = completeVisitArgs(tenantA, one.visitId);
    expect((await callCompleteVisit(tenantA.client, args)).error).toBeNull();
    const res = await callCompleteVisit(tenantA.client, { ...args, p_visit_id: two.visitId });
    expect(mapDbError(res.error)).toMatchObject({ code: "IDEMPOTENCY_MISMATCH" });
    expect((await visitRow(two.visitId)).status).toBe("waiting");
  });

  it("two parallel completions of one visit (different ids): one completes, the other answers already_completed, one audit row", async () => {
    const { visitId } = await seedVisit(tenantA, undefined, { status: "waiting" });
    const [x, y] = await Promise.all([
      callCompleteVisit(tenantA.client, completeVisitArgs(tenantA, visitId)),
      callCompleteVisit(members.nurse.client, completeVisitArgs(tenantA, visitId)),
    ]);
    expect(x.error).toBeNull();
    expect(y.error).toBeNull();
    expect([(x.data as { already_completed: boolean }).already_completed, (y.data as { already_completed: boolean }).already_completed].sort()).toEqual([false, true]);
    expect(await completeAudit(visitId)).toHaveLength(1);
  });
});

describe("complete_visit: who may call it", () => {
  it.each(ROLES)("%s: allowed exactly when the matrix grants appointments:edit", async (role) => {
    const { visitId } = await seedVisit(tenantA, undefined, { status: "waiting" });
    const { error } = await callCompleteVisit(members[role].client, completeVisitArgs(tenantA, visitId));
    if (hasPerm(role, "appointments:edit")) {
      expect(error).toBeNull();
      expect((await visitRow(visitId)).status).toBe("completed");
    } else {
      expect(error?.code).toBe("42501");
      expect((await visitRow(visitId)).status).toBe("waiting");
    }
  });

  it("anon cannot execute it (42501)", async () => {
    const { visitId } = await seedVisit(tenantA, undefined, { status: "waiting" });
    const anon = createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    }) as TestDb;
    const { data, error } = await callCompleteVisit(anon, completeVisitArgs(tenantA, visitId));
    expect(data).toBeNull();
    expect(error?.code).toBe("42501");
    expect((await visitRow(visitId)).status).toBe("waiting");
  });

  it("another clinic's visit is NOT_FOUND, whichever clinic is named, and nothing is written", async () => {
    const visitB = await seedVisit(tenantB, undefined, { status: "waiting" });
    for (const named of [tenantA, tenantB]) {
      const res = await callCompleteVisit(tenantA.client, completeVisitArgs(named, visitB.visitId));
      expect(res.error).toMatchObject({ code: "P0002", message: "VISIT_NOT_FOUND" });
    }
    expect((await visitRow(visitB.visitId)).status).toBe("waiting");
  });
});

describe("completeVisit (service)", () => {
  it("completes, replays on the same id and refuses a malformed id with fixed texts", async () => {
    const { visitId } = await seedVisit(tenantA, undefined, { status: "waiting" });
    const id = randomUUID();
    expect(await completeVisit(ctxFor(members.receptionist), visitId, id)).toMatchObject({ ok: true, value: { alreadyCompleted: false, replayed: false } });
    expect(await completeVisit(ctxFor(members.receptionist), visitId, id)).toMatchObject({ ok: true, value: { replayed: true } });
    expect(await completeVisit(ctxFor(tenantA), visitId, "not-a-uuid")).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
    const closed = await seedVisit(tenantA, undefined, { status: "cancelled" });
    expect(await completeVisit(ctxFor(tenantA), closed.visitId, randomUUID())).toMatchObject({
      ok: false,
      error: { code: "CONFLICT", reason: "VISIT_NOT_COMPLETABLE" },
    });
  });
});
