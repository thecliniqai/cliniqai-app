import { describe, it, expect, beforeAll } from "vitest";
import { seedTenantWithOwner, addMemberToTenant } from "../helpers/tenants";
import { getAdminClient } from "../helpers/supabase-admin";
import { psql } from "../helpers/sql";

/**
 * Subscription & billing RLS boundary (REQ-multi-tenancy, REQ-nfr-security), rewritten off the v1 `subscriptions` /
 * `payment_records` tables (dropped in V2-05 05-09c, migration 000086) onto `tenant_subscriptions` and
 * `subscription_events` (05-09a): the owner and the admin of the active clinic read the clinic's one subscription row
 * and its events; a doctor (or nurse, receptionist) reads 0 rows; another clinic's owner reads 0 rows. Real JWT clients
 * against the local stack.
 */
describe("Subscription & Billing RLS Boundary (REQ-multi-tenancy, REQ-nfr-security)", () => {
  let tenantA: Awaited<ReturnType<typeof seedTenantWithOwner>>;
  let tenantB: Awaited<ReturnType<typeof seedTenantWithOwner>>;
  const admin = getAdminClient();

  beforeAll(async () => {
    tenantA = await seedTenantWithOwner("Apex Healthcare");
    tenantB = await seedTenantWithOwner("Beacon Clinic", { subscription: { status: "active" } });

    const { error } = await admin.from("subscription_events").insert([
      { tenant_id: tenantA.tenantId, type: "test.subscription_spec", actor_type: "system" },
      { tenant_id: tenantA.tenantId, type: "test.subscription_spec", actor_type: "system" },
      { tenant_id: tenantB.tenantId, type: "test.subscription_spec", actor_type: "system" },
    ]);
    expect(error).toBeNull();
  });

  it("proves Tenant A's owner and admin can read their own subscription and its events", async () => {
    const adminA = await addMemberToTenant(tenantA.tenantId, "admin");
    for (const reader of [tenantA.client, adminA.client]) {
      const { data: sub, error: subErr } = await reader
        .from("tenant_subscriptions")
        .select("tenant_id, status, plan_price_id")
        .eq("tenant_id", tenantA.tenantId)
        .single();

      expect(subErr).toBeNull();
      expect(sub?.status).toBe("trialing");
      expect(sub?.plan_price_id).not.toBeNull();

      const { data: events, error: evErr } = await reader
        .from("subscription_events")
        .select("tenant_id")
        .eq("type", "test.subscription_spec");

      expect(evErr).toBeNull();
      expect(events).toEqual([{ tenant_id: tenantA.tenantId }, { tenant_id: tenantA.tenantId }]);
    }
  });

  it("proves a doctor, nurse or receptionist in Tenant A receives 0 rows from the billing tables (RLS)", async () => {
    for (const role of ["doctor", "nurse", "receptionist"] as const) {
      const member = await addMemberToTenant(tenantA.tenantId, role);

      const { data: sub, error: subErr } = await member.client
        .from("tenant_subscriptions")
        .select("*")
        .eq("tenant_id", tenantA.tenantId);

      expect(subErr).toBeNull();
      expect(sub, role).toHaveLength(0);

      const { data: events, error: evErr } = await member.client
        .from("subscription_events")
        .select("*")
        .eq("tenant_id", tenantA.tenantId);

      expect(evErr).toBeNull();
      expect(events, role).toHaveLength(0);
    }
  });

  it("proves Tenant B's owner receives 0 rows when attempting to read Tenant A's billing data (Cross-tenant RLS)", async () => {
    const own = await tenantB.client.from("tenant_subscriptions").select("status").eq("tenant_id", tenantB.tenantId);
    expect(own.data).toEqual([{ status: "active" }]);

    const { data: sub } = await tenantB.client
      .from("tenant_subscriptions")
      .select("*")
      .eq("tenant_id", tenantA.tenantId);

    expect(sub?.length).toBe(0);

    const { data: events } = await tenantB.client
      .from("subscription_events")
      .select("*")
      .eq("tenant_id", tenantA.tenantId);

    expect(events?.length).toBe(0);
  });

  it("proves no member can write the subscription or its events (no write privilege for API roles)", async () => {
    const upd = await tenantA.client
      .from("tenant_subscriptions")
      .update({ status: "active" })
      .eq("tenant_id", tenantA.tenantId);
    expect(upd.error?.code).toBe("42501");

    const ins = await tenantA.client
      .from("subscription_events")
      .insert({ tenant_id: tenantA.tenantId, type: "test.forged", actor_type: "owner" });
    expect(ins.error?.code).toBe("42501");
  });

  it("proves the v1 subscription tables are gone (000086)", () => {
    expect(psql("select to_regclass('public.subscriptions') is null, to_regclass('public.payment_records') is null")).toEqual([
      "t|t",
    ]);
  });
});
