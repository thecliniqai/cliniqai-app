/**
 * V2-08 08-04a (R-7, R-15): `public.mark_no_show` and `public.confirm_appointment`, two single-status commands.
 *
 * mark_no_show: a booked or confirmed visit whose appointment time has passed becomes `no_show` (NO_SHOW_TOO_EARLY before that;
 * VISIT_NOT_MARKABLE for any other status), with the `visit.no_show` audit row. confirm_appointment: a booked visit becomes
 * `confirmed` (the staff-confirmation metadata) with the `visit.confirm` audit row; an already confirmed visit answers
 * `already_confirmed` with no second row; any other status is VISIT_NOT_CONFIRMABLE. SECURITY DEFINER; appointments:edit.
 * Synthetic data only.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import { mapDbError } from "@/lib/db/errors";
import { hasPerm } from "@/lib/permissions";
import type { UserRole } from "@/lib/db/types";
import { confirmAppointment, markNoShow } from "@/features/visits/scheduling-service";
import { addMemberToTenant, createDualMembershipUser, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import type { TestDb } from "../helpers/db";
import { ctxFor } from "../helpers/context";
import { signInActingIn } from "../helpers/active-tenant";
import { leftoverFaults, withFault } from "../helpers/fault";
import { expectCommandCatalog } from "../helpers/command-catalog";
import { auditRows, commandResultRows, expectDataOnlyStoredResult } from "../helpers/billing-commands";
import { seedBookedVisit, seedPatient } from "../helpers/front-desk-commands";
import { callConfirm, callMarkNoShow, confirmArgs, ist, markNoShowArgs, schedRow } from "../helpers/scheduling-commands";

const ROLES: UserRole[] = ["owner", "admin", "doctor", "nurse", "receptionist"];

let tenantA: SeededTenant;
let tenantB: SeededTenant;
const members = {} as Record<UserRole, SeededTenant>;

let freshWeek = 60;
const nextWeek = () => freshWeek++;
const DAY = 86_400_000;

/** A booked visit of the owner at `at` (overbooked: a past or arbitrary time never collides with another seed). */
async function visitAt(at: string, over: Record<string, unknown> = {}): Promise<string> {
  return seedBookedVisit(tenantA, await seedPatient(tenantA), tenantA.userId, at, { is_overbooked: true, ...over });
}

const past = () => new Date(Date.now() - DAY).toISOString();
const future = () => new Date(Date.now() + 3 * DAY).toISOString();

beforeAll(async () => {
  tenantA = await seedTenantWithOwner("CI NoShow Clinic A");
  tenantB = await seedTenantWithOwner("CI NoShow Clinic B");
  members.owner = tenantA;
  for (const role of ROLES.filter((r) => r !== "owner")) members[role] = await addMemberToTenant(tenantA.tenantId, role);
});

afterAll(() => {
  expect(leftoverFaults()).toBe(0);
});

describe("mark_no_show / confirm_appointment: catalog", () => {
  it("are DEFINER with the pinned settings, EXECUTE for authenticated only, and a required p_client_request_id", () => {
    expectCommandCatalog({ signature: "public.mark_no_show(uuid, uuid, uuid)", definer: true });
    expectCommandCatalog({ signature: "public.confirm_appointment(uuid, uuid, uuid)", definer: true });
  });
});

describe("mark_no_show", () => {
  it.each(["booked", "confirmed"] as const)("a %s visit whose time has passed becomes no_show with its audit row and claim", async (status) => {
    const visitId = await visitAt(past(), { status });
    const args = markNoShowArgs(tenantA, visitId);
    const { data, error } = await callMarkNoShow(members.receptionist.client, args);
    expect(error).toBeNull();
    expect(data).toEqual({ visit_id: visitId, replayed: false });
    expect((await schedRow(visitId)).status).toBe("no_show");
    expect(await auditRows(tenantA.tenantId, "visit.no_show", visitId)).toEqual([
      expect.objectContaining({
        actor_id: members.receptionist.userId,
        actor_role: "receptionist",
        entity_type: "visit",
        metadata: { old_status: status, new_status: "no_show" },
      }),
    ]);
    expect(commandResultRows(tenantA.tenantId, args.p_client_request_id)).toEqual(["public.mark_no_show|true"]);
    expectDataOnlyStoredResult(tenantA.tenantId, args.p_client_request_id);
  });

  it("before the appointment time it is NO_SHOW_TOO_EARLY; a visit without a time is too early too; nothing changes", async () => {
    const visitId = await visitAt(future());
    const args = markNoShowArgs(tenantA, visitId);
    const res = await callMarkNoShow(tenantA.client, args);
    expect(res.error).toMatchObject({ code: "P0001", message: "NO_SHOW_TOO_EARLY" });
    expect(mapDbError(res.error)).toMatchObject({ code: "CONFLICT", reason: "NO_SHOW_TOO_EARLY" });
    expect((await schedRow(visitId)).status).toBe("booked");
    expect(await auditRows(tenantA.tenantId, "visit.no_show", visitId)).toEqual([]);
    expect(commandResultRows(tenantA.tenantId, args.p_client_request_id)).toEqual([]);
  });

  it.each(["waiting", "in_consultation", "completed", "cancelled", "no_show"] as const)("a %s visit is VISIT_NOT_MARKABLE", async (status) => {
    const visitId = await visitAt(past(), { status });
    const res = await callMarkNoShow(tenantA.client, markNoShowArgs(tenantA, visitId));
    expect(res.error).toMatchObject({ code: "P0001", message: "VISIT_NOT_MARKABLE" });
    expect((await schedRow(visitId)).status).toBe(status);
  });

  it("rollback: a fault on the audit insert leaves the visit booked and no claim; the same id then succeeds", async () => {
    const visitId = await visitAt(past());
    const args = markNoShowArgs(tenantA, visitId);
    await withFault({ table: "public.audit_logs", column: "entity_id", marker: visitId }, async () => {
      const { data, error } = await callMarkNoShow(tenantA.client, args);
      expect(data).toBeNull();
      expect(error?.code).toBe("XX000");
      const viaService = await markNoShow(ctxFor(tenantA), visitId, randomUUID());
      expect(viaService).toMatchObject({ ok: false, error: { code: "INTERNAL", message: "Failed to update the appointment." } });
      expect(JSON.stringify(viaService)).not.toContain("SPIKE_FAULT");
    });
    expect((await schedRow(visitId)).status).toBe("booked");
    expect(commandResultRows(tenantA.tenantId, args.p_client_request_id)).toEqual([]);
    expect((await callMarkNoShow(tenantA.client, args)).error).toBeNull();
    expect((await schedRow(visitId)).status).toBe("no_show");
  });

  it("the same id twice: one no-show, one audit row, the first result with replayed: true; the same id for another visit is IDEMPOTENCY_MISMATCH", async () => {
    const visitId = await visitAt(past());
    const other = await visitAt(past());
    const args = markNoShowArgs(tenantA, visitId);
    const first = await callMarkNoShow(tenantA.client, args);
    const second = await callMarkNoShow(tenantA.client, args);
    expect(second.data).toEqual({ ...(first.data as object), replayed: true });
    expect(await auditRows(tenantA.tenantId, "visit.no_show", visitId)).toHaveLength(1);
    const mismatch = await callMarkNoShow(tenantA.client, { ...args, p_visit_id: other });
    expect(mapDbError(mismatch.error)).toMatchObject({ code: "IDEMPOTENCY_MISMATCH" });
    expect((await schedRow(other)).status).toBe("booked");
  });

  it("two desks at once (different ids): one no-show; the other is VISIT_NOT_MARKABLE", async () => {
    const visitId = await visitAt(past());
    const [x, y] = await Promise.all([
      callMarkNoShow(members.receptionist.client, markNoShowArgs(tenantA, visitId)),
      callMarkNoShow(members.owner.client, markNoShowArgs(tenantA, visitId)),
    ]);
    expect([x.error?.message, y.error?.message].filter(Boolean)).toEqual(["VISIT_NOT_MARKABLE"]);
    expect(await auditRows(tenantA.tenantId, "visit.no_show", visitId)).toHaveLength(1);
  });

  it("input: a missing visit or request id is refused; roles, anon and another clinic as for every command", async () => {
    const visitId = await visitAt(past());
    expect((await callMarkNoShow(tenantA.client, markNoShowArgs(tenantA, visitId, { p_visit_id: null as unknown as string }))).error).toMatchObject({ message: "INPUT_INVALID" });
    expect((await callMarkNoShow(tenantA.client, markNoShowArgs(tenantA, visitId, { p_client_request_id: null as unknown as string }))).error).toMatchObject({ message: "CLIENT_REQUEST_ID_REQUIRED" });

    for (const role of ROLES) {
      const own = await visitAt(past());
      const { error } = await callMarkNoShow(members[role].client, markNoShowArgs(tenantA, own));
      if (hasPerm(role, "appointments:edit")) expect(error, role).toBeNull();
      else expect(error?.code, role).toBe("42501");
    }

    const anon = createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    }) as TestDb;
    expect((await callMarkNoShow(anon, markNoShowArgs(tenantA, visitId))).error?.code).toBe("42501");

    const visitB = await seedBookedVisit(tenantB, await seedPatient(tenantB), tenantB.userId, past(), { is_overbooked: true });
    for (const named of [tenantA, tenantB]) {
      expect((await callMarkNoShow(tenantA.client, markNoShowArgs(named, visitB))).error).toMatchObject({ code: "P0002", message: "VISIT_NOT_FOUND" });
    }
    const dual = await createDualMembershipUser(tenantA.tenantId, "receptionist", tenantB.tenantId, "receptionist");
    const actingInA = await signInActingIn(dual.userEmail, tenantA.tenantId);
    for (const named of [tenantB, tenantA]) {
      expect((await callMarkNoShow(actingInA, markNoShowArgs(named, visitB))).error).toMatchObject({ code: "P0002", message: "VISIT_NOT_FOUND" });
    }
    expect((await schedRow(visitB)).status).toBe("booked");
    const actingInB = await signInActingIn(dual.userEmail, tenantB.tenantId);
    expect((await callMarkNoShow(actingInB, markNoShowArgs(tenantB, visitB))).error).toBeNull();
  });
});

describe("confirm_appointment", () => {
  it("a booked visit becomes confirmed with the staff metadata, its audit row and claim", async () => {
    const visitId = await visitAt(future(), { metadata: { note: "keep" } });
    const args = confirmArgs(tenantA, visitId);
    const { data, error } = await callConfirm(members.receptionist.client, args);
    expect(error).toBeNull();
    expect(data).toEqual({ visit_id: visitId, already_confirmed: false, replayed: false });
    const row = await schedRow(visitId);
    expect(row.status).toBe("confirmed");
    expect(row.metadata).toMatchObject({ note: "keep", clinic_confirmed: true, confirmed_by: members.receptionist.userId, confirmed_via: "staff_calendar" });
    expect(typeof (row.metadata as Record<string, unknown>).confirmed_at).toBe("string");
    expect(await auditRows(tenantA.tenantId, "visit.confirm", visitId)).toEqual([
      expect.objectContaining({
        actor_id: members.receptionist.userId,
        entity_type: "visit",
        metadata: { old_status: "booked", new_status: "confirmed" },
      }),
    ]);
    expect(commandResultRows(tenantA.tenantId, args.p_client_request_id)).toEqual(["public.confirm_appointment|true"]);
    expectDataOnlyStoredResult(tenantA.tenantId, args.p_client_request_id);
  });

  it("an already confirmed visit answers already_confirmed and writes no second audit row", async () => {
    const visitId = await visitAt(future(), { status: "confirmed" });
    const res = await callConfirm(tenantA.client, confirmArgs(tenantA, visitId));
    expect(res.data).toEqual({ visit_id: visitId, already_confirmed: true, replayed: false });
    expect(await auditRows(tenantA.tenantId, "visit.confirm", visitId)).toEqual([]);
  });

  it.each(["waiting", "in_consultation", "completed", "cancelled", "no_show"] as const)("a %s visit is VISIT_NOT_CONFIRMABLE", async (status) => {
    const visitId = await visitAt(past(), { status });
    const res = await callConfirm(tenantA.client, confirmArgs(tenantA, visitId));
    expect(res.error).toMatchObject({ code: "P0001", message: "VISIT_NOT_CONFIRMABLE" });
    expect(mapDbError(res.error)).toMatchObject({ code: "CONFLICT", reason: "VISIT_NOT_CONFIRMABLE" });
    expect((await schedRow(visitId)).status).toBe(status);
  });

  it("rollback: a fault on the audit insert leaves the visit booked and no claim; the same id then succeeds", async () => {
    const visitId = await visitAt(future());
    const args = confirmArgs(tenantA, visitId);
    await withFault({ table: "public.audit_logs", column: "entity_id", marker: visitId }, async () => {
      const { data, error } = await callConfirm(tenantA.client, args);
      expect(data).toBeNull();
      expect(error?.code).toBe("XX000");
      const viaService = await confirmAppointment(ctxFor(tenantA), visitId, randomUUID());
      expect(viaService).toMatchObject({ ok: false, error: { code: "INTERNAL", message: "Failed to update the appointment." } });
    });
    expect((await schedRow(visitId)).status).toBe("booked");
    expect(commandResultRows(tenantA.tenantId, args.p_client_request_id)).toEqual([]);
    expect((await callConfirm(tenantA.client, args)).error).toBeNull();
    expect((await schedRow(visitId)).status).toBe("confirmed");
  });

  it("the same id twice replays; the same id for another visit is IDEMPOTENCY_MISMATCH", async () => {
    const visitId = await visitAt(future());
    const other = await visitAt(future());
    const args = confirmArgs(tenantA, visitId);
    const first = await callConfirm(tenantA.client, args);
    expect((await callConfirm(tenantA.client, args)).data).toEqual({ ...(first.data as object), replayed: true });
    expect(await auditRows(tenantA.tenantId, "visit.confirm", visitId)).toHaveLength(1);
    expect(mapDbError((await callConfirm(tenantA.client, { ...args, p_visit_id: other })).error)).toMatchObject({ code: "IDEMPOTENCY_MISMATCH" });
    expect((await schedRow(other)).status).toBe("booked");
  });

  it("two desks at once (different ids): one confirms (one audit row), the other answers already_confirmed", async () => {
    const visitId = await visitAt(future());
    const [x, y] = await Promise.all([
      callConfirm(members.receptionist.client, confirmArgs(tenantA, visitId)),
      callConfirm(members.owner.client, confirmArgs(tenantA, visitId)),
    ]);
    expect(x.error).toBeNull();
    expect(y.error).toBeNull();
    expect([(x.data as { already_confirmed: boolean }).already_confirmed, (y.data as { already_confirmed: boolean }).already_confirmed].sort()).toEqual([false, true]);
    expect(await auditRows(tenantA.tenantId, "visit.confirm", visitId)).toHaveLength(1);
  });

  it("input, roles, anon and another clinic as for every command", async () => {
    const visitId = await visitAt(future());
    expect((await callConfirm(tenantA.client, confirmArgs(tenantA, visitId, { p_visit_id: null as unknown as string }))).error).toMatchObject({ message: "INPUT_INVALID" });
    expect((await callConfirm(tenantA.client, confirmArgs(tenantA, visitId, { p_client_request_id: null as unknown as string }))).error).toMatchObject({ message: "CLIENT_REQUEST_ID_REQUIRED" });
    for (const role of ROLES) {
      const own = await visitAt(future());
      const { error } = await callConfirm(members[role].client, confirmArgs(tenantA, own));
      if (hasPerm(role, "appointments:edit")) expect(error, role).toBeNull();
      else expect(error?.code, role).toBe("42501");
    }
    const anon = createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    }) as TestDb;
    expect((await callConfirm(anon, confirmArgs(tenantA, visitId))).error?.code).toBe("42501");

    const visitB = await seedBookedVisit(tenantB, await seedPatient(tenantB), tenantB.userId, ist(nextWeek(), 0, 11, 0));
    for (const named of [tenantA, tenantB]) {
      expect((await callConfirm(tenantA.client, confirmArgs(named, visitB))).error).toMatchObject({ code: "P0002", message: "VISIT_NOT_FOUND" });
    }
    const dual = await createDualMembershipUser(tenantA.tenantId, "receptionist", tenantB.tenantId, "receptionist");
    const actingInA = await signInActingIn(dual.userEmail, tenantA.tenantId);
    for (const named of [tenantB, tenantA]) {
      expect((await callConfirm(actingInA, confirmArgs(named, visitB))).error).toMatchObject({ code: "P0002", message: "VISIT_NOT_FOUND" });
    }
    const actingInB = await signInActingIn(dual.userEmail, tenantB.tenantId);
    expect((await callConfirm(actingInB, confirmArgs(tenantB, visitB))).error).toBeNull();
  });
});

describe("services", () => {
  it("markNoShow and confirmAppointment replay on the same id and refuse a malformed one with a fixed text", async () => {
    const missed = await visitAt(past());
    const id = randomUUID();
    expect(await markNoShow(ctxFor(members.receptionist), missed, id)).toMatchObject({ ok: true, value: { visitId: missed, replayed: false } });
    expect(await markNoShow(ctxFor(members.receptionist), missed, id)).toMatchObject({ ok: true, value: { replayed: true } });
    expect(await markNoShow(ctxFor(tenantA), missed, "nope")).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
    expect(await markNoShow(ctxFor(tenantA), missed, randomUUID())).toMatchObject({ ok: false, error: { code: "CONFLICT", reason: "VISIT_NOT_MARKABLE" } });

    const upcoming = await visitAt(future());
    expect(await confirmAppointment(ctxFor(tenantA), upcoming, randomUUID())).toMatchObject({ ok: true, value: { alreadyConfirmed: false } });
    expect(await confirmAppointment(ctxFor(tenantA), upcoming, randomUUID())).toMatchObject({ ok: true, value: { alreadyConfirmed: true } });
    expect(await confirmAppointment(ctxFor(tenantA), upcoming, "nope")).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
    const cancelled = await visitAt(past(), { status: "cancelled" });
    expect(await confirmAppointment(ctxFor(tenantA), cancelled, randomUUID())).toMatchObject({
      ok: false,
      error: { code: "CONFLICT", reason: "VISIT_NOT_CONFIRMABLE", message: "Only a booked appointment can be confirmed." },
    });
  });
});
