/**
 * V2-07 07-01 (R-1, R-2, R-3): `public.check_in_visit`, check-in as one atomic command.
 *
 * The visit's queue token (existing or the next of the clinic-local day), the `waiting` status and the `queue.check_in`
 * audit row commit together or not at all; a visit that already holds a token but was left without the status is
 * repaired. SECURITY DEFINER; appointments:edit (every staff role). Synthetic data only.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import { mapDbError } from "@/lib/db/errors";
import { hasPerm } from "@/lib/permissions";
import type { UserRole } from "@/lib/db/types";
import { checkInVisit } from "@/features/queue/service";
import { addMemberToTenant, createDualMembershipUser, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { getAdminClient } from "../helpers/supabase-admin";
import { insertReturningId, type TestDb } from "../helpers/db";
import { ctxFor } from "../helpers/context";
import { signInActingIn } from "../helpers/active-tenant";
import { leftoverFaults, withFault } from "../helpers/fault";
import { expectCommandCatalog } from "../helpers/command-catalog";
import { psql } from "../helpers/sql";
import { auditRows, commandResultRows, seedVisit, expectDataOnlyStoredResult } from "../helpers/billing-commands";
import { callCheckIn, checkInArgs, tokensOfVisit, visitFlags, visitRow } from "../helpers/clinical-commands";
import { clearOfClinicMidnight, earlierToday } from "../helpers/clinic-day";

const ROLES: UserRole[] = ["owner", "admin", "doctor", "nurse", "receptionist"];

let tenantA: SeededTenant;
let tenantB: SeededTenant;
let tenantRace: SeededTenant;
const members = {} as Record<UserRole, SeededTenant>;

beforeAll(async () => {
  tenantA = await seedTenantWithOwner("CI CheckIn Clinic A");
  tenantB = await seedTenantWithOwner("CI CheckIn Clinic B");
  tenantRace = await seedTenantWithOwner("CI CheckIn Race Clinic");
  members.owner = tenantA;
  for (const role of ROLES.filter((r) => r !== "owner")) members[role] = await addMemberToTenant(tenantA.tenantId, role);
});

afterAll(() => {
  expect(leftoverFaults()).toBe(0);
});

const HOUR = 3_600_000;
/** A scheduled visit `offsetMs` from now: today in the clinic's zone for 0, another clinic-local day for +-36 h. A late
 * appointment of today is `earlierToday` (tests/helpers/clinic-day.ts), never `at(-x)`, which is yesterday just after midnight. */
const at = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

describe("check_in_visit: catalog", () => {
  it("is DEFINER with the pinned settings, EXECUTE for authenticated only, and a required p_client_request_id", () => {
    expectCommandCatalog({ signature: "public.check_in_visit(uuid, uuid, text, uuid, bigint)", definer: true });
  });

  it("the shared step has no API grant", () => {
    expect(
      psql(
        `select has_function_privilege('authenticated', 'private.step_check_in(uuid, uuid, text)', 'EXECUTE')::text || ',' || ` +
          `has_function_privilege('service_role', 'private.step_check_in(uuid, uuid, text)', 'EXECUTE')::text`
      )
    ).toEqual(["false,false"]);
  });
});

describe("check_in_visit: one transaction", () => {
  it("happy path: token, waiting status, audit row and claim commit together; the token carries the clinic's location", async () => {
    const { visitId } = await seedVisit(tenantA);
    const args = checkInArgs(tenantA, visitId, { p_priority: "urgent" });
    const { data, error } = await callCheckIn(members.receptionist.client, args);
    expect(error).toBeNull();
    const result = data as { queue_token_id: string; token_number: number };
    expect(data).toMatchObject({ visit_id: visitId, priority: "urgent", reused: false, status_repaired: false, replayed: false });

    expect((await visitRow(visitId)).status).toBe("waiting");
    const [token] = await tokensOfVisit(visitId);
    expect(token).toMatchObject({ id: result.queue_token_id, token_number: result.token_number, priority: "urgent", tenant_id: tenantA.tenantId });
    expect(token.location_id).toBeTruthy();
    expect(await auditRows(tenantA.tenantId, "queue.check_in", token.id)).toEqual([
      expect.objectContaining({
        actor_id: members.receptionist.userId,
        actor_role: "receptionist",
        entity_type: "queue_token",
        metadata: { token_number: token.token_number, priority: "urgent" },
      }),
    ]);
    expect(commandResultRows(tenantA.tenantId, args.p_client_request_id)).toEqual(["public.check_in_visit|true"]);
    // F-5 (07-04a): the stored result holds ids, numbers, amounts, statuses and flags only, no free text.
    expectDataOnlyStoredResult(tenantA.tenantId, args.p_client_request_id);
  });

  it("rollback: a fault on the visit update takes the token and the audit row with it; the same id then succeeds", async () => {
    const marker = `CI-FAULT-${randomUUID().slice(0, 8)}`;
    const { visitId } = await seedVisit(tenantA);
    await getAdminClient().from("visits").update({ reason_for_visit: marker }).eq("id", visitId);
    const args = checkInArgs(tenantA, visitId);
    const auditBefore = (await auditRows(tenantA.tenantId, "queue.check_in")).length;

    await withFault({ table: "public.visits", column: "reason_for_visit", marker, event: "update" }, async () => {
      const { data, error } = await callCheckIn(tenantA.client, args);
      expect(data).toBeNull();
      expect(error?.code).toBe("XX000");

      // Through the service: a fixed message, never the driver's text.
      const viaService = await checkInVisit(ctxFor(tenantA), visitId, "normal", randomUUID());
      expect(viaService).toMatchObject({ success: false, error: "Failed to generate queue token.", code: "INTERNAL" });
      expect(JSON.stringify(viaService)).not.toContain("SPIKE_FAULT");
    });

    expect((await visitRow(visitId)).status).toBe("booked");
    expect(await tokensOfVisit(visitId)).toEqual([]);
    expect(commandResultRows(tenantA.tenantId, args.p_client_request_id)).toEqual([]);
    expect((await auditRows(tenantA.tenantId, "queue.check_in")).length).toBe(auditBefore);

    const retry = await callCheckIn(tenantA.client, args);
    expect(retry.error).toBeNull();
    expect(retry.data).toMatchObject({ reused: false, replayed: false });
    expect((await visitRow(visitId)).status).toBe("waiting");
  });

  it("a visit that holds a token but never became waiting is repaired, with one audit row; a further check-in changes nothing", async () => {
    const { visitId } = await seedVisit(tenantA);
    const tokenId = await insertReturningId(getAdminClient(), "queue_tokens", {
      tenant_id: tenantA.tenantId,
      visit_id: visitId,
      date: new Date().toISOString().slice(0, 10),
      token_number: 9000 + Math.floor(Math.random() * 900),
      priority: "vip",
    });
    expect((await visitRow(visitId)).status).toBe("booked");

    const repaired = await callCheckIn(tenantA.client, checkInArgs(tenantA, visitId));
    expect(repaired.error).toBeNull();
    expect(repaired.data).toMatchObject({ queue_token_id: tokenId, reused: true, status_repaired: true, priority: "vip" });
    expect((await visitRow(visitId)).status).toBe("waiting");
    expect(await auditRows(tenantA.tenantId, "queue.check_in", tokenId)).toHaveLength(1);

    const again = await callCheckIn(tenantA.client, checkInArgs(tenantA, visitId));
    expect(again.data).toMatchObject({ queue_token_id: tokenId, reused: true, status_repaired: false });
    expect(await tokensOfVisit(visitId)).toHaveLength(1);
    expect(await auditRows(tenantA.tenantId, "queue.check_in", tokenId)).toHaveLength(1);
  });

  it("a visit already in consultation gets its token without a status change", async () => {
    // Inserted in that state: the visit state machine (000100) refuses booked -> in_consultation.
    const { visitId } = await seedVisit(tenantA, undefined, { status: "in_consultation" });
    const { data, error } = await callCheckIn(tenantA.client, checkInArgs(tenantA, visitId));
    expect(error).toBeNull();
    expect(data).toMatchObject({ reused: false });
    expect((await visitRow(visitId)).status).toBe("in_consultation");
    expect(await tokensOfVisit(visitId)).toHaveLength(1);
  });

  it.each(["completed", "cancelled"] as const)("a %s visit is VISIT_NOT_CHECKABLE and gets no token", async (status) => {
    const { visitId } = await seedVisit(tenantA, undefined, { status });
    const args = checkInArgs(tenantA, visitId);
    const res = await callCheckIn(tenantA.client, args);
    expect(res.error).toMatchObject({ code: "P0001", message: "VISIT_NOT_CHECKABLE" });
    expect(mapDbError(res.error)).toMatchObject({ code: "CONFLICT", reason: "VISIT_NOT_CHECKABLE" });
    expect((await visitRow(visitId)).status).toBe(status);
    expect(await tokensOfVisit(visitId)).toEqual([]);
    expect(commandResultRows(tenantA.tenantId, args.p_client_request_id)).toEqual([]);
  });
});

describe("check_in_visit: the booking's own day (R-8) and the late arrival", () => {
  // A visit seeded "today" must still be today when the RPC reads it (CI 46049011705).
  beforeEach(() => clearOfClinicMidnight());

  it("a booking of another clinic-local day is VISIT_NOT_TODAY (tomorrow and yesterday): no token, status unchanged", async () => {
    for (const [status, when] of [["booked", at(36 * HOUR)], ["confirmed", at(-36 * HOUR)], ["no_show", at(36 * HOUR)]] as const) {
      const { visitId } = await seedVisit(tenantA, undefined, { status, scheduledAt: when, overbooked: true });
      const args = checkInArgs(tenantA, visitId);
      const res = await callCheckIn(tenantA.client, args);
      expect(res.error, status).toMatchObject({ code: "P0001", message: "VISIT_NOT_TODAY" });
      expect(mapDbError(res.error), status).toMatchObject({ code: "CONFLICT", reason: "VISIT_NOT_TODAY" });
      expect((await visitRow(visitId)).status).toBe(status);
      expect(await tokensOfVisit(visitId)).toEqual([]);
      expect(commandResultRows(tenantA.tenantId, args.p_client_request_id)).toEqual([]);
    }
  });

  it("a booking of today is checked in, confirmed or not", async () => {
    for (const status of ["booked", "confirmed"] as const) {
      const { visitId } = await seedVisit(tenantA, undefined, { status, scheduledAt: at(0), overbooked: true });
      const { data, error } = await callCheckIn(tenantA.client, checkInArgs(tenantA, visitId));
      expect(error, status).toBeNull();
      expect(data).toMatchObject({ reused: false, replayed: false });
      expect((await visitRow(visitId)).status).toBe("waiting");
    }
  });

  it("a no-show that arrives late is checked in: waiting, a token, and one audit row marked late_arrival", async () => {
    const { visitId } = await seedVisit(tenantA, undefined, { status: "no_show", scheduledAt: earlierToday(HOUR / 4), overbooked: true });
    const { data, error } = await callCheckIn(members.receptionist.client, checkInArgs(tenantA, visitId));
    expect(error).toBeNull();
    const result = data as { queue_token_id: string; token_number: number };
    expect((await visitRow(visitId)).status).toBe("waiting");
    expect(await auditRows(tenantA.tenantId, "queue.check_in", result.queue_token_id)).toEqual([
      expect.objectContaining({ metadata: { token_number: result.token_number, priority: "normal", late_arrival: true } }),
    ]);
  });

  // V2-08 08-06a (A-3): a no-show frees its slot (visits_no_double_booking skips no_show rows), the desk rebooks it, and the patient
  // then arrives. Before, the move back to waiting re-entered the constraint and the check-in failed with a generic CONFLICT (23P01).
  it("A-3: a late no-show whose slot was rebooked is checked in as an overbooked visit; the audit row says so; the slot's holder is untouched", async () => {
    const slot = earlierToday(HOUR / 4);
    const late = await seedVisit(tenantA, undefined, { status: "no_show", scheduledAt: slot });
    const holder = await seedVisit(tenantA, undefined, { status: "booked", scheduledAt: slot });
    const { data, error } = await callCheckIn(members.receptionist.client, checkInArgs(tenantA, late.visitId));
    expect(error).toBeNull();
    const result = data as { queue_token_id: string; token_number: number };
    expect(await visitFlags(late.visitId)).toEqual({ status: "waiting", is_overbooked: true });
    expect(await visitFlags(holder.visitId)).toEqual({ status: "booked", is_overbooked: false });
    expect(await tokensOfVisit(late.visitId)).toHaveLength(1);
    expect(await auditRows(tenantA.tenantId, "queue.check_in", result.queue_token_id)).toEqual([
      expect.objectContaining({ metadata: { token_number: result.token_number, priority: "normal", late_arrival: true, is_overbooked: true } }),
    ]);
  });

  it("A-3 control: a late no-show whose slot is still free is not marked overbooked (and says nothing about it)", async () => {
    // Another doctor than the A-3 case above, so that case's holder (the same moment just after midnight, when both are clamped to
    // it) is not this slot's.
    const late = await seedVisit(tenantA, members.doctor.userId, { status: "no_show", scheduledAt: earlierToday(HOUR / 2) });
    const { data, error } = await callCheckIn(tenantA.client, checkInArgs(tenantA, late.visitId));
    expect(error).toBeNull();
    expect(await visitFlags(late.visitId)).toEqual({ status: "waiting", is_overbooked: false });
    const [row] = await auditRows(tenantA.tenantId, "queue.check_in", (data as { queue_token_id: string }).queue_token_id);
    expect(row.metadata).toHaveProperty("late_arrival", true);
    expect(row.metadata).not.toHaveProperty("is_overbooked");
  });

  it("an ordinary check-in carries no late_arrival, and a walk-in (no appointment time) is never refused for its day", async () => {
    const { visitId } = await seedVisit(tenantA);
    const { data } = await callCheckIn(tenantA.client, checkInArgs(tenantA, visitId));
    const tokenId = (data as { queue_token_id: string }).queue_token_id;
    const [row] = await auditRows(tenantA.tenantId, "queue.check_in", tokenId);
    expect(row.metadata).not.toHaveProperty("late_arrival");
  });
});

describe("check_in_visit: idempotency and races", () => {
  it("the same id twice: one token, one audit row, the first result with replayed: true", async () => {
    const { visitId } = await seedVisit(tenantA);
    const args = checkInArgs(tenantA, visitId);
    const first = await callCheckIn(tenantA.client, args);
    const second = await callCheckIn(tenantA.client, args);
    expect(second.error).toBeNull();
    expect(second.data).toEqual({ ...(first.data as object), replayed: true });
    const tokens = await tokensOfVisit(visitId);
    expect(tokens).toHaveLength(1);
    expect(await auditRows(tenantA.tenantId, "queue.check_in", tokens[0].id)).toHaveLength(1);
  });

  it("a new id on a visit already checked in returns its token (reused) and writes no second audit row", async () => {
    const { visitId } = await seedVisit(tenantA);
    const first = await callCheckIn(tenantA.client, checkInArgs(tenantA, visitId));
    const second = await callCheckIn(tenantA.client, checkInArgs(tenantA, visitId, { p_priority: "urgent" }));
    expect(second.error).toBeNull();
    expect(second.data).toMatchObject({
      queue_token_id: (first.data as { queue_token_id: string }).queue_token_id,
      token_number: (first.data as { token_number: number }).token_number,
      reused: true,
      priority: "normal",
    });
    expect(await auditRows(tenantA.tenantId, "queue.check_in", (first.data as { queue_token_id: string }).queue_token_id)).toHaveLength(1);
  });

  it("the same id for another visit or priority is IDEMPOTENCY_MISMATCH and writes nothing", async () => {
    const one = await seedVisit(tenantA);
    const two = await seedVisit(tenantA);
    const args = checkInArgs(tenantA, one.visitId);
    expect((await callCheckIn(tenantA.client, args)).error).toBeNull();
    for (const over of [{ p_visit_id: two.visitId }, { p_priority: "urgent" }]) {
      const res = await callCheckIn(tenantA.client, { ...args, ...over });
      expect(mapDbError(res.error), JSON.stringify(over)).toMatchObject({ code: "IDEMPOTENCY_MISMATCH" });
    }
    expect(await tokensOfVisit(two.visitId)).toEqual([]);
  });

  it("ten parallel check-ins of ten visits get ten distinct tokens, ten waiting visits and ten audit rows", async () => {
    const visits = await Promise.all(Array.from({ length: 10 }, () => seedVisit(tenantRace)));
    const results = await Promise.all(visits.map((v) => callCheckIn(tenantRace.client, checkInArgs(tenantRace, v.visitId))));
    for (const r of results) expect(r.error).toBeNull();
    const numbers = results.map((r) => (r.data as { token_number: number }).token_number);
    expect(new Set(numbers).size).toBe(10);
    expect([...numbers].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    for (const v of visits) expect((await visitRow(v.visitId)).status).toBe("waiting");
    const audits = await Promise.all(results.map((r) => auditRows(tenantRace.tenantId, "queue.check_in", (r.data as { queue_token_id: string }).queue_token_id)));
    for (const rows of audits) expect(rows).toHaveLength(1);
  });

  it("two concurrent check-ins of one visit (different ids): one token; the second is reused", async () => {
    const { visitId } = await seedVisit(tenantA);
    const [x, y] = await Promise.all([
      callCheckIn(tenantA.client, checkInArgs(tenantA, visitId)),
      callCheckIn(members.nurse.client, checkInArgs(tenantA, visitId)),
    ]);
    expect(x.error).toBeNull();
    expect(y.error).toBeNull();
    expect([(x.data as { reused: boolean }).reused, (y.data as { reused: boolean }).reused].sort()).toEqual([false, true]);
    const tokens = await tokensOfVisit(visitId);
    expect(tokens).toHaveLength(1);
    expect(await auditRows(tenantA.tenantId, "queue.check_in", tokens[0].id)).toHaveLength(1);
  });
});

describe("check_in_visit: input", () => {
  it("an unknown priority, a missing visit and a missing request id are refused and write nothing", async () => {
    const { visitId } = await seedVisit(tenantA);
    const badPriority = await callCheckIn(tenantA.client, checkInArgs(tenantA, visitId, { p_priority: "emergency" }));
    expect(badPriority.error).toMatchObject({ code: "P0001", message: "INPUT_INVALID" });
    const noVisit = await callCheckIn(tenantA.client, checkInArgs(tenantA, visitId, { p_visit_id: null as unknown as string }));
    expect(noVisit.error).toMatchObject({ code: "P0001", message: "INPUT_INVALID" });
    const noId = await callCheckIn(tenantA.client, checkInArgs(tenantA, visitId, { p_client_request_id: null as unknown as string }));
    expect(noId.error).toMatchObject({ code: "P0001", message: "CLIENT_REQUEST_ID_REQUIRED" });
    expect(await tokensOfVisit(visitId)).toEqual([]);
    expect((await visitRow(visitId)).status).toBe("booked");
  });
});

describe("check_in_visit: who may call it", () => {
  it.each(ROLES)("%s: allowed exactly when the matrix grants appointments:edit", async (role) => {
    const { visitId } = await seedVisit(tenantA);
    const { error } = await callCheckIn(members[role].client, checkInArgs(tenantA, visitId));
    if (hasPerm(role, "appointments:edit")) {
      expect(error).toBeNull();
      expect((await visitRow(visitId)).status).toBe("waiting");
    } else {
      expect(error?.code).toBe("42501");
      expect(await tokensOfVisit(visitId)).toEqual([]);
    }
  });

  it("anon cannot execute it (42501)", async () => {
    const { visitId } = await seedVisit(tenantA);
    const anon = createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    }) as TestDb;
    const { data, error } = await callCheckIn(anon, checkInArgs(tenantA, visitId));
    expect(data).toBeNull();
    expect(error?.code).toBe("42501");
    expect(await tokensOfVisit(visitId)).toEqual([]);
  });

  it("another clinic's visit is NOT_FOUND, whichever clinic is named, and nothing is written", async () => {
    const visitB = await seedVisit(tenantB);
    for (const named of [tenantA, tenantB]) {
      const res = await callCheckIn(tenantA.client, checkInArgs(named, visitB.visitId));
      expect(res.error).toMatchObject({ code: "P0002", message: "VISIT_NOT_FOUND" });
      expect(mapDbError(res.error).code).toBe("NOT_FOUND");
    }
    expect(await tokensOfVisit(visitB.visitId)).toEqual([]);
    expect((await visitRow(visitB.visitId)).status).toBe("booked");
  });

  it("a member of A and B acting in A cannot check in B's visit, naming B or A, but can in B", async () => {
    const visitB = await seedVisit(tenantB);
    const dual = await createDualMembershipUser(tenantA.tenantId, "receptionist", tenantB.tenantId, "receptionist");
    const actingInA = await signInActingIn(dual.userEmail, tenantA.tenantId);
    for (const named of [tenantB, tenantA]) {
      const res = await callCheckIn(actingInA, checkInArgs(named, visitB.visitId));
      expect(res.error).toMatchObject({ code: "P0002", message: "VISIT_NOT_FOUND" });
    }
    expect(await tokensOfVisit(visitB.visitId)).toEqual([]);

    const actingInB = await signInActingIn(dual.userEmail, tenantB.tenantId);
    const ok = await callCheckIn(actingInB, checkInArgs(tenantB, visitB.visitId));
    expect(ok.error).toBeNull();
    const [token] = await tokensOfVisit(visitB.visitId);
    expect(await auditRows(tenantB.tenantId, "queue.check_in", token.id)).toEqual([
      expect.objectContaining({ actor_id: dual.userId, actor_role: "receptionist", actor_type: "user" }),
    ]);
  });
});

describe("checkInVisit (service)", () => {
  it("checks in, replays on the same id, and refuses a malformed id and a closed visit with fixed texts", async () => {
    const { visitId } = await seedVisit(tenantA);
    const id = randomUUID();
    const first = await checkInVisit(ctxFor(members.nurse), visitId, "normal", id);
    expect(first).toMatchObject({ success: true, replayed: false });
    expect(await checkInVisit(ctxFor(members.nurse), visitId, "normal", id)).toEqual({ ...(first as object), replayed: true });
    expect(await checkInVisit(ctxFor(tenantA), visitId, "normal", "not-a-uuid")).toMatchObject({ success: false, code: "VALIDATION_FAILED" });

    const closed = await seedVisit(tenantA, undefined, { status: "cancelled" });
    expect(await checkInVisit(ctxFor(tenantA), closed.visitId, "normal", randomUUID())).toMatchObject({
      success: false,
      error: "This visit can no longer be checked in.",
      code: "CONFLICT",
      reason: "VISIT_NOT_CHECKABLE",
    });
    expect(await tokensOfVisit(closed.visitId)).toEqual([]);
  });

  it("another clinic's visit reads as not found", async () => {
    const visitB = await seedVisit(tenantB);
    expect(await checkInVisit(ctxFor(tenantA), visitB.visitId, "normal", randomUUID())).toMatchObject({
      success: false,
      error: "Visit record not found.",
      code: "NOT_FOUND",
    });
    expect(await tokensOfVisit(visitB.visitId)).toEqual([]);
  });
});
