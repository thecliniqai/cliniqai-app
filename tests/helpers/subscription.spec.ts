/**
 * V2-05 05-09c (SUB §11 "Test seeds", ruling R-25, acceptance 11 preparation): every test clinic gets a subscription
 * row with the access a test expects BEFORE the RLS helpers read the access level (05-10a).
 *   - `seedTenantWithOwner` seeds `trialing` on the Standard price by default: the owner reads `full` through
 *     `my_tenant_access` and the Standard trial entitlements (Smart Assist, core, ai.scribe with 1,500 drafts, PO-21)
 *     through `my_entitlements`;
 *   - `seedTenantSubscription(…, { comp: true })` on an `incomplete` clinic is `full` with status `incomplete`, and
 *     carries the Standard keys (Pitfall 8: a comp without a price has none);
 *   - `active` is `full` with the Standard keys and no ai.scribe (PO-25), `expired` and a past `accessEndsAt` are
 *     `locked`, `incomplete` is `onboarding`;
 *   - a clinic created through `create_clinic_with_owner` (onboarding) stays `incomplete` until a test seeds it.
 * Real JWT clients against the local stack; synthetic data only (the run teardown removes it).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { getAdminClient } from "./supabase-admin";
import { createUnlinkedUser, seedTenantSubscription, seedTenantWithOwner, standardPlanPriceId } from "./tenants";
import type { SeededTenant } from "./tenants";

type Entitlement = { key: string; enabled: boolean; limit_value: number };

async function accessOf(t: SeededTenant): Promise<string | null> {
  const { data, error } = await t.client.rpc("my_tenant_access", { p_tenant: t.tenantId });
  expect(error).toBeNull();
  return data as string | null;
}

async function entitlementsOf(t: SeededTenant): Promise<Map<string, Entitlement>> {
  const { data, error } = await t.client.rpc("my_entitlements", { p_tenant: t.tenantId });
  expect(error).toBeNull();
  return new Map(((data ?? []) as Entitlement[]).map((e) => [e.key, e]));
}

async function statusOf(tenantId: string): Promise<{ status: string; plan_price_id: string | null }> {
  const { data, error } = await getAdminClient()
    .from("tenant_subscriptions")
    .select("status, plan_price_id")
    .eq("tenant_id", tenantId)
    .single();
  expect(error).toBeNull();
  return data!;
}

describe("seedTenantWithOwner: a trialing Standard clinic by default (R-25)", () => {
  let t: SeededTenant;
  beforeAll(async () => {
    t = await seedTenantWithOwner("Synthetic Subscription Default Clinic");
  });

  it("is trialing on the Standard price with full access", async () => {
    expect(await statusOf(t.tenantId)).toEqual({ status: "trialing", plan_price_id: await standardPlanPriceId() });
    expect(await accessOf(t)).toBe("full");
  });

  it("has the Standard trial entitlements: Smart Assist and core on, ai.scribe on with 1,500 drafts (PO-21)", async () => {
    const e = await entitlementsOf(t);
    expect(e.get("ai.scribe")).toMatchObject({ enabled: true });
    expect(e.get("ai.scribe.monthly_drafts")).toMatchObject({ enabled: true, limit_value: 1500 });
    expect(e.get("assist.allergy_check")?.enabled).toBe(true);
    expect(e.get("core.*")?.enabled).toBe(true);
    expect(e.get("ai.clinical_copilot")?.enabled).toBe(false);
  });

  it("ends access at trial end + 24 h, 14 days out", async () => {
    const { data } = await getAdminClient()
      .from("tenant_subscriptions")
      .select("trial_start, trial_end, access_ends_at")
      .eq("tenant_id", t.tenantId)
      .single();
    const start = Date.parse(data!.trial_start!);
    const end = Date.parse(data!.trial_end!);
    expect(end - start).toBe(14 * 86_400_000);
    expect(Date.parse(data!.access_ends_at!) - end).toBe(86_400_000);
  });
});

describe("seedTenantSubscription variants", () => {
  let t: SeededTenant;
  beforeAll(async () => {
    t = await seedTenantWithOwner("Synthetic Subscription Variant Clinic");
  });

  it("comp on an incomplete clinic: full access, status stays incomplete, Standard keys present (Pitfall 8)", async () => {
    const s = await seedTenantSubscription(t.tenantId, { status: "incomplete", comp: true });
    expect(s.compUntil).not.toBeNull();
    expect(await statusOf(t.tenantId)).toEqual({ status: "incomplete", plan_price_id: await standardPlanPriceId() });
    expect(await accessOf(t)).toBe("full");
    const e = await entitlementsOf(t);
    expect(e.get("core.*")?.enabled).toBe(true);
    expect(e.get("ai.scribe")?.enabled).toBe(false);
  });

  it("active: full access with the Standard keys and no ai.scribe (PO-25 default)", async () => {
    await seedTenantSubscription(t.tenantId, { status: "active" });
    expect(await accessOf(t)).toBe("full");
    const e = await entitlementsOf(t);
    expect(e.get("assist.allergy_check")?.enabled).toBe(true);
    expect(e.get("ai.scribe")?.enabled).toBe(false);
    expect(e.get("ai.scribe.monthly_drafts")?.limit_value).toBe(0);
  });

  it("expired: locked, no keys", async () => {
    await seedTenantSubscription(t.tenantId, { status: "expired" });
    expect(await accessOf(t)).toBe("locked");
    expect([...(await entitlementsOf(t)).values()].filter((e) => e.enabled)).toEqual([]);
  });

  it("trialing with a past accessEndsAt: locked (time travel for lock tests)", async () => {
    await seedTenantSubscription(t.tenantId, { status: "trialing", accessEndsAt: new Date(Date.now() - 60_000) });
    expect(await accessOf(t)).toBe("locked");
  });

  it("incomplete: onboarding, no price, and re-seeding clears every earlier lifecycle field", async () => {
    await seedTenantSubscription(t.tenantId, { status: "incomplete" });
    expect(await accessOf(t)).toBe("onboarding");
    const { data } = await getAdminClient().from("tenant_subscriptions").select("*").eq("tenant_id", t.tenantId).single();
    expect(data).toMatchObject({
      status: "incomplete",
      plan_price_id: null,
      trial_start: null,
      trial_end: null,
      current_period_end: null,
      access_ends_at: null,
      expired_at: null,
      comp_until: null,
    });
  });

  it("refuses a clinic without a subscription row instead of silently doing nothing", async () => {
    await expect(seedTenantSubscription("00000000-0000-4000-8000-0000000c09c0")).rejects.toThrow(/expected its one row/);
  });
});

describe("onboarding clinics are not seeded", () => {
  it("a clinic made through create_clinic_with_owner stays incomplete (onboarding) until a test seeds it", async () => {
    const user = await createUnlinkedUser();
    const { data: tenantId, error } = await user.client.rpc("create_clinic_with_owner", {
      p_name: "Synthetic Onboarding Clinic",
    });
    expect(error).toBeNull();
    expect((await statusOf(tenantId as string)).status).toBe("incomplete");
    const { data: level } = await user.client.rpc("my_tenant_access", { p_tenant: tenantId as string });
    expect(level).toBe("onboarding");
  });
});
