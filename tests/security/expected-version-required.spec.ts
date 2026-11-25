/**
 * V2-09e 09E-14a (E): the actions that take a row version refuse, at run time, a missing, null, negative, fractional or non-numeric one, before any read or write
 * (the session, the permission and the tenant are still checked first, so a stranger learns nothing). The pure check, and every action that must call it.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import { expectedVersionError } from "@/lib/errors/expected-version";
import { addMemberToTenant, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { seedVisit } from "../helpers/billing-commands";

const mockState = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => mockState.client }));

import { checkInVisit, completeVisit, startConsultation } from "@/features/queue/actions";
import { cancelVisit, confirmAppointment, markNoShow, rescheduleVisit } from "@/features/visits/scheduling";
import { recordPayment } from "@/features/billing/actions";

describe("expectedVersionError", () => {
  it.each([0, 1, 7, 2 ** 31])("accepts %s", (v) => expect(expectedVersionError(v)).toBeNull());
  it.each([undefined, null, -1, 1.5, "3", NaN, Infinity, 2 ** 60, {}, []])("refuses %s with the fixed text", (v) => {
    const error = expectedVersionError(v);
    expect(error).toMatchObject({ code: "VALIDATION_FAILED", reason: "EXPECTED_VERSION_REQUIRED", message: "This screen is out of date. Refresh and try again." });
  });
});

describe("the actions refuse a missing or malformed version before they touch anything", () => {
  let owner: SeededTenant;
  let nurse: SeededTenant;
  let visitId: string;
  const bad = [undefined, null, -1, 1.5, "3"] as unknown as number[];

  beforeAll(async () => {
    owner = await seedTenantWithOwner("CI Expected Version");
    nurse = await addMemberToTenant(owner.tenantId, "nurse");
    visitId = (await seedVisit(owner, owner.userId)).visitId;
  });

  it("a signed-in owner: every bad version is VALIDATION_FAILED and the visit is unchanged", async () => {
    mockState.client = owner.client;
    for (const v of bad) {
      const calls = [
        await checkInVisit(visitId, "normal", randomUUID(), v),
        await startConsultation(visitId, randomUUID(), v),
        await completeVisit(visitId, randomUUID(), v),
        await markNoShow(visitId, randomUUID(), v),
        await confirmAppointment(visitId, randomUUID(), v),
        await rescheduleVisit({ visit_id: visitId, expected_version: v } as never, randomUUID()),
        await cancelVisit({ visit_id: visitId, expected_version: v } as never, randomUUID()),
      ];
      for (const r of calls) expect(r).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED", reason: "EXPECTED_VERSION_REQUIRED" } });
      const paid = await recordPayment({ visit_id: visitId, expected_invoice_version: v } as never);
      expect(paid).toMatchObject({ success: false });
    }
    const { data } = await owner.client.from("visits").select("status").eq("id", visitId).single();
    expect(data?.status).not.toBe("completed");
  });

  it("the permission is checked first: a nurse (no consultations:edit) and a stranger get the permission answer, not the version one", async () => {
    mockState.client = nurse.client;
    const r = await startConsultation(visitId, randomUUID(), undefined as unknown as number);
    expect(r).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    mockState.client = createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const anon = await checkInVisit(visitId, "normal", randomUUID(), undefined as unknown as number);
    expect(anon).toMatchObject({ ok: false, error: { code: "UNAUTHENTICATED" } });
  });
});
