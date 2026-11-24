/**
 * V2-08 08-01b (R-1, R-7, R-8): `public.start_consultation`, "Start Consultation" as one atomic command.
 *
 * A booked, confirmed, no-show or waiting visit is checked in first (token, `waiting`, `queue.check_in` audit row) and then
 * moved to `in_consultation` (token `called_at`, `visit.consultation_start` audit row) in ONE transaction: a failure on the
 * second step leaves the visit as it was, with no token. SECURITY DEFINER; consultations:edit and appointments:edit
 * (owner and doctor). Synthetic data only.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import { mapDbError } from "@/lib/db/errors";
import { hasPerm } from "@/lib/permissions";
import type { UserRole } from "@/lib/db/types";
import { startConsultation } from "@/features/queue/service";
import { addMemberToTenant, createDualMembershipUser, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { getAdminClient } from "../helpers/supabase-admin";
import type { TestDb } from "../helpers/db";
import { ctxFor } from "../helpers/context";
import { signInActingIn } from "../helpers/active-tenant";
import { leftoverFaults, withFault } from "../helpers/fault";
import { expectCommandCatalog } from "../helpers/command-catalog";
import { auditRows, commandResultRows, expectDataOnlyStoredResult, seedVisit } from "../helpers/billing-commands";
import { callCheckIn, callStartConsultation, checkInArgs, startConsultationArgs, tokensOfVisit, visitFlags, visitRow } from "../helpers/clinical-commands";

const ROLES: UserRole[] = ["owner", "admin", "doctor", "nurse", "receptionist"];
const HOUR = 3_600_000;
const at = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

let tenantA: SeededTenant;
let tenantB: SeededTenant;
const members = {} as Record<UserRole, SeededTenant>;

beforeAll(async () => {
  tenantA = await seedTenantWithOwner("CI StartConsult Clinic A");
  tenantB = await seedTenantWithOwner("CI StartConsult Clinic B");
  members.owner = tenantA;
  for (const role of ROLES.filter((r) => r !== "owner")) members[role] = await addMemberToTenant(tenantA.tenantId, role);
});

afterAll(() => {
  expect(leftoverFaults()).toBe(0);
});

const startAudit = (visitId: string) => auditRows(tenantA.tenantId, "visit.consultation_start", visitId);

describe("start_consultation: catalog", () => {
  it("is DEFINER with the pinned settings, EXECUTE for authenticated only, and a required p_client_request_id", () => {
    expectCommandCatalog({ signature: "public.start_consultation(uuid, uuid, uuid, bigint)", definer: true });
  });
});

describe("start_consultation: one transaction", () => {
  it("a booked visit of today: checked in and started together, with both audit rows, the token's called_at and the claim", async () => {
    const { visitId } = await seedVisit(tenantA, undefined, { status: "booked", scheduledAt: at(0), overbooked: true });
    const args = startConsultationArgs(tenantA, visitId);
    const { data, error } = await callStartConsultation(members.doctor.client, args);
    expect(error).toBeNull();
    const [token] = await tokensOfVisit(visitId);
    expect(data).toEqual({ visit_id: visitId, token_number: token.token_number, already_started: false, replayed: false });
    expect((await visitRow(visitId)).status).toBe("in_consultation");
    expect(token.called_at).not.toBeNull();
    expect(token.completed_at).toBeNull();

    expect(await auditRows(tenantA.tenantId, "queue.check_in", token.id)).toEqual([
      expect.objectContaining({ actor_id: members.doctor.userId, entity_type: "queue_token", metadata: { token_number: token.token_number, priority: "normal" } }),
    ]);
    expect(await startAudit(visitId)).toEqual([
      expect.objectContaining({ actor_id: members.doctor.userId, actor_role: "doctor", entity_type: "visit", metadata: { token_number: token.token_number } }),
    ]);
    expect(commandResultRows(tenantA.tenantId, args.p_client_request_id)).toEqual(["public.start_consultation|true"]);
    expectDataOnlyStoredResult(tenantA.tenantId, args.p_client_request_id);
  });

  it("a confirmed visit of today is started the same way; a walk-in already waiting reuses its token and adds no check-in row", async () => {
    const confirmed = await seedVisit(tenantA, undefined, { status: "confirmed", scheduledAt: at(0), overbooked: true });
    expect((await callStartConsultation(tenantA.client, startConsultationArgs(tenantA, confirmed.visitId))).error).toBeNull();
    expect((await visitRow(confirmed.visitId)).status).toBe("in_consultation");

    const walkIn = await seedVisit(tenantA);
    const checkedIn = await callCheckIn(members.receptionist.client, checkInArgs(tenantA, walkIn.visitId));
    const tokenId = (checkedIn.data as { queue_token_id: string }).queue_token_id;
    const started = await callStartConsultation(tenantA.client, startConsultationArgs(tenantA, walkIn.visitId));
    expect(started.error).toBeNull();
    expect(started.data).toMatchObject({ already_started: false, token_number: (checkedIn.data as { token_number: number }).token_number });
    expect(await tokensOfVisit(walkIn.visitId)).toHaveLength(1);
    expect(await auditRows(tenantA.tenantId, "queue.check_in", tokenId)).toHaveLength(1);
    expect(await startAudit(walkIn.visitId)).toHaveLength(1);
    expect((await tokensOfVisit(walkIn.visitId))[0].called_at).not.toBeNull();
  });

  it("a no-show that arrives late is started: waiting, a token marked late_arrival, then in_consultation", async () => {
    const { visitId } = await seedVisit(tenantA, undefined, { status: "no_show", scheduledAt: at(-HOUR / 4), overbooked: true });
    expect((await callStartConsultation(tenantA.client, startConsultationArgs(tenantA, visitId))).error).toBeNull();
    expect((await visitRow(visitId)).status).toBe("in_consultation");
    const [token] = await tokensOfVisit(visitId);
    expect(await auditRows(tenantA.tenantId, "queue.check_in", token.id)).toEqual([
      expect.objectContaining({ metadata: { token_number: token.token_number, priority: "normal", late_arrival: true } }),
    ]);
  });

  it("A-3: a late no-show whose slot was rebooked is started as an overbooked visit (before: CONFLICT 23P01 on the slot rule)", async () => {
    const slot = at(-HOUR / 4);
    const late = await seedVisit(tenantA, undefined, { status: "no_show", scheduledAt: slot });
    const holder = await seedVisit(tenantA, undefined, { status: "booked", scheduledAt: slot });
    const { data, error } = await callStartConsultation(tenantA.client, startConsultationArgs(tenantA, late.visitId));
    expect(error).toBeNull();
    expect(data).toMatchObject({ already_started: false });
    expect(await visitFlags(late.visitId)).toEqual({ status: "in_consultation", is_overbooked: true });
    expect(await visitFlags(holder.visitId)).toEqual({ status: "booked", is_overbooked: false });
  });

  it("rollback: a fault on the move to in_consultation takes the token, the waiting status and both audit rows with it; the same id then succeeds", async () => {
    const marker = `CI-FAULT-${randomUUID().slice(0, 8)}`;
    const { visitId } = await seedVisit(tenantA, undefined, { status: "booked", scheduledAt: at(0), overbooked: true });
    await getAdminClient().from("visits").update({ reason_for_visit: marker }).eq("id", visitId);
    const args = startConsultationArgs(tenantA, visitId);
    const checkInsBefore = (await auditRows(tenantA.tenantId, "queue.check_in")).length;

    await withFault({ table: "public.visits", column: "reason_for_visit", marker, event: "update", and: { column: "status", value: "in_consultation" } }, async () => {
      const { data, error } = await callStartConsultation(members.doctor.client, args);
      expect(data).toBeNull();
      expect(error?.code).toBe("XX000");

      // Through the service: a fixed message, never the driver's text.
      const viaService = await startConsultation(ctxFor(members.doctor), visitId, randomUUID());
      expect(viaService).toMatchObject({ ok: false, error: { code: "INTERNAL", message: "Failed to start the consultation." } });
      expect(JSON.stringify(viaService)).not.toContain("SPIKE_FAULT");
    });

    // The first step (the check-in) had already written: none of it persists.
    expect((await visitRow(visitId)).status).toBe("booked");
    expect(await tokensOfVisit(visitId)).toEqual([]);
    expect(await startAudit(visitId)).toEqual([]);
    expect((await auditRows(tenantA.tenantId, "queue.check_in")).length).toBe(checkInsBefore);
    expect(commandResultRows(tenantA.tenantId, args.p_client_request_id)).toEqual([]);

    const retry = await callStartConsultation(members.doctor.client, args);
    expect(retry.error).toBeNull();
    expect(retry.data).toMatchObject({ already_started: false, replayed: false });
    expect((await visitRow(visitId)).status).toBe("in_consultation");
  });

  it("a visit already in consultation (also a reopened signed one) answers already_started and writes nothing", async () => {
    const { visitId } = await seedVisit(tenantA, undefined, { status: "in_consultation" });
    const res = await callStartConsultation(tenantA.client, startConsultationArgs(tenantA, visitId));
    expect(res.error).toBeNull();
    expect(res.data).toMatchObject({ visit_id: visitId, already_started: true, replayed: false });
    expect(await startAudit(visitId)).toEqual([]);
    expect(await tokensOfVisit(visitId)).toEqual([]);
  });

  it.each(["completed", "cancelled"] as const)("a %s visit is VISIT_NOT_CHECKABLE: nothing is written", async (status) => {
    const { visitId } = await seedVisit(tenantA, undefined, { status });
    const args = startConsultationArgs(tenantA, visitId);
    const res = await callStartConsultation(tenantA.client, args);
    expect(res.error).toMatchObject({ code: "P0001", message: "VISIT_NOT_CHECKABLE" });
    expect((await visitRow(visitId)).status).toBe(status);
    expect(await tokensOfVisit(visitId)).toEqual([]);
    expect(commandResultRows(tenantA.tenantId, args.p_client_request_id)).toEqual([]);
  });

  it("a booking of another clinic-local day is VISIT_NOT_TODAY: still booked, no token", async () => {
    const { visitId } = await seedVisit(tenantA, undefined, { status: "booked", scheduledAt: at(36 * HOUR), overbooked: true });
    const res = await callStartConsultation(tenantA.client, startConsultationArgs(tenantA, visitId));
    expect(res.error).toMatchObject({ code: "P0001", message: "VISIT_NOT_TODAY" });
    expect(mapDbError(res.error)).toMatchObject({ code: "CONFLICT", reason: "VISIT_NOT_TODAY" });
    expect((await visitRow(visitId)).status).toBe("booked");
    expect(await tokensOfVisit(visitId)).toEqual([]);
  });
});

describe("start_consultation: idempotency and races", () => {
  it("the same id twice: one start, one check-in, the first result with replayed: true", async () => {
    const { visitId } = await seedVisit(tenantA, undefined, { status: "confirmed", scheduledAt: at(0), overbooked: true });
    const args = startConsultationArgs(tenantA, visitId);
    const first = await callStartConsultation(tenantA.client, args);
    const second = await callStartConsultation(tenantA.client, args);
    expect(second.error).toBeNull();
    expect(second.data).toEqual({ ...(first.data as object), replayed: true });
    const tokens = await tokensOfVisit(visitId);
    expect(tokens).toHaveLength(1);
    expect(await startAudit(visitId)).toHaveLength(1);
    expect(await auditRows(tenantA.tenantId, "queue.check_in", tokens[0].id)).toHaveLength(1);
  });

  it("the same id for another visit is IDEMPOTENCY_MISMATCH and writes nothing", async () => {
    const one = await seedVisit(tenantA, undefined, { status: "waiting" });
    const two = await seedVisit(tenantA, undefined, { status: "waiting" });
    const args = startConsultationArgs(tenantA, one.visitId);
    expect((await callStartConsultation(tenantA.client, args)).error).toBeNull();
    const res = await callStartConsultation(tenantA.client, { ...args, p_visit_id: two.visitId });
    expect(mapDbError(res.error)).toMatchObject({ code: "IDEMPOTENCY_MISMATCH" });
    expect((await visitRow(two.visitId)).status).toBe("waiting");
    expect(await startAudit(two.visitId)).toEqual([]);
  });

  it("two parallel starts of one visit (owner and doctor, different ids): one start and one already_started, one audit row", async () => {
    const { visitId } = await seedVisit(tenantA, undefined, { status: "confirmed", scheduledAt: at(0), overbooked: true });
    const [x, y] = await Promise.all([
      callStartConsultation(tenantA.client, startConsultationArgs(tenantA, visitId)),
      callStartConsultation(members.doctor.client, startConsultationArgs(tenantA, visitId)),
    ]);
    expect(x.error).toBeNull();
    expect(y.error).toBeNull();
    expect([(x.data as { already_started: boolean }).already_started, (y.data as { already_started: boolean }).already_started].sort()).toEqual([false, true]);
    expect(await tokensOfVisit(visitId)).toHaveLength(1);
    expect(await startAudit(visitId)).toHaveLength(1);
    expect((await visitRow(visitId)).status).toBe("in_consultation");
  });
});

describe("start_consultation: input", () => {
  it("a missing visit and a missing request id are refused and write nothing", async () => {
    const { visitId } = await seedVisit(tenantA, undefined, { status: "waiting" });
    const noVisit = await callStartConsultation(tenantA.client, startConsultationArgs(tenantA, visitId, { p_visit_id: null as unknown as string }));
    expect(noVisit.error).toMatchObject({ code: "P0001", message: "INPUT_INVALID" });
    const noId = await callStartConsultation(tenantA.client, startConsultationArgs(tenantA, visitId, { p_client_request_id: null as unknown as string }));
    expect(noId.error).toMatchObject({ code: "P0001", message: "CLIENT_REQUEST_ID_REQUIRED" });
    expect((await visitRow(visitId)).status).toBe("waiting");
  });
});

describe("start_consultation: who may call it", () => {
  it.each(ROLES)("%s: allowed exactly when the matrix grants consultations:edit and appointments:edit", async (role) => {
    const { visitId } = await seedVisit(tenantA, undefined, { status: "waiting" });
    const { error } = await callStartConsultation(members[role].client, startConsultationArgs(tenantA, visitId));
    if (hasPerm(role, "consultations:edit") && hasPerm(role, "appointments:edit")) {
      expect(error).toBeNull();
      expect((await visitRow(visitId)).status).toBe("in_consultation");
    } else {
      expect(error?.code).toBe("42501");
      expect((await visitRow(visitId)).status).toBe("waiting");
      expect(await tokensOfVisit(visitId)).toEqual([]);
    }
  });

  it("anon cannot execute it (42501)", async () => {
    const { visitId } = await seedVisit(tenantA, undefined, { status: "waiting" });
    const anon = createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    }) as TestDb;
    const { data, error } = await callStartConsultation(anon, startConsultationArgs(tenantA, visitId));
    expect(data).toBeNull();
    expect(error?.code).toBe("42501");
    expect((await visitRow(visitId)).status).toBe("waiting");
  });

  it("another clinic's visit is NOT_FOUND, whichever clinic is named, and nothing is written", async () => {
    const visitB = await seedVisit(tenantB, undefined, { status: "waiting" });
    for (const named of [tenantA, tenantB]) {
      const res = await callStartConsultation(tenantA.client, startConsultationArgs(named, visitB.visitId));
      expect(res.error).toMatchObject({ code: "P0002", message: "VISIT_NOT_FOUND" });
      expect(mapDbError(res.error).code).toBe("NOT_FOUND");
    }
    expect((await visitRow(visitB.visitId)).status).toBe("waiting");
    expect(await tokensOfVisit(visitB.visitId)).toEqual([]);
  });

  it("a doctor of A and B acting in A cannot start B's visit, naming B or A, but can in B", async () => {
    const visitB = await seedVisit(tenantB, undefined, { status: "waiting" });
    const dual = await createDualMembershipUser(tenantA.tenantId, "doctor", tenantB.tenantId, "doctor");
    const actingInA = await signInActingIn(dual.userEmail, tenantA.tenantId);
    for (const named of [tenantB, tenantA]) {
      const res = await callStartConsultation(actingInA, startConsultationArgs(named, visitB.visitId));
      expect(res.error).toMatchObject({ code: "P0002", message: "VISIT_NOT_FOUND" });
    }
    expect((await visitRow(visitB.visitId)).status).toBe("waiting");

    const actingInB = await signInActingIn(dual.userEmail, tenantB.tenantId);
    expect((await callStartConsultation(actingInB, startConsultationArgs(tenantB, visitB.visitId))).error).toBeNull();
    expect((await visitRow(visitB.visitId)).status).toBe("in_consultation");
  });
});

describe("startConsultation (service)", () => {
  it("starts, replays on the same id, refuses a malformed id and a role without consultations:edit with fixed texts", async () => {
    const { visitId } = await seedVisit(tenantA, undefined, { status: "waiting" });
    const id = randomUUID();
    const first = await startConsultation(ctxFor(members.doctor), visitId, id);
    expect(first).toMatchObject({ ok: true, value: { alreadyStarted: false, replayed: false } });
    expect(await startConsultation(ctxFor(members.doctor), visitId, id)).toMatchObject({ ok: true, value: { replayed: true } });
    expect(await startConsultation(ctxFor(tenantA), visitId, "not-a-uuid")).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });

    const other = await seedVisit(tenantA, undefined, { status: "waiting" });
    expect(await startConsultation(ctxFor(members.receptionist), other.visitId, randomUUID())).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN", message: "You do not have permission to start consultations." },
    });
    expect((await visitRow(other.visitId)).status).toBe("waiting");
  });

  it("a closed visit and another clinic's visit give fixed texts", async () => {
    const closed = await seedVisit(tenantA, undefined, { status: "cancelled" });
    expect(await startConsultation(ctxFor(tenantA), closed.visitId, randomUUID())).toMatchObject({
      ok: false,
      error: { code: "CONFLICT", reason: "VISIT_NOT_CHECKABLE", message: "This visit can no longer be started." },
    });
    const visitB = await seedVisit(tenantB, undefined, { status: "waiting" });
    expect(await startConsultation(ctxFor(tenantA), visitB.visitId, randomUUID())).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND", message: "Visit record not found." },
    });
  });
});
