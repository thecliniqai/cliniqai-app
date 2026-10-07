import { describe, it, expect, beforeAll } from "vitest";
import { seedTenantWithOwner, addMemberToTenant } from "../helpers/tenants";
import { getAdminClient } from "../helpers/supabase-admin";

describe("Subscription & Billing RLS Boundary (REQ-multi-tenancy, REQ-nfr-security)", () => {
  let tenantA: Awaited<ReturnType<typeof seedTenantWithOwner>>;
  let tenantB: Awaited<ReturnType<typeof seedTenantWithOwner>>;
  const admin = getAdminClient();

  beforeAll(async () => {
    tenantA = await seedTenantWithOwner("Apex Healthcare");
    tenantB = await seedTenantWithOwner("Beacon Clinic");

    // Seed standard subscription and payments for Tenant A
    await admin.from("subscriptions").insert({
      tenant_id: tenantA.tenantId,
      plan: "standard",
      amount_inr: 1000,
      status: "active",
      current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    });

    await admin.from("payment_records").insert([
      {
        tenant_id: tenantA.tenantId,
        amount_inr: 1000,
        method: "upi",
        reference: "UPI/TXN/10001",
      },
      {
        tenant_id: tenantA.tenantId,
        amount_inr: 1000,
        method: "card",
        reference: "CARD/TXN/10002",
      },
    ]);
  });

  it("proves Tenant A's owner can read their own subscription and payment records", async () => {
    const { data: sub, error: subErr } = await tenantA.client
      .from("subscriptions")
      .select("*")
      .eq("tenant_id", tenantA.tenantId)
      .single();

    expect(subErr).toBeNull();
    expect(sub?.amount_inr).toBe(1000);
    expect(sub?.plan).toBe("standard");

    const { data: payments, error: payErr } = await tenantA.client
      .from("payment_records")
      .select("*")
      .eq("tenant_id", tenantA.tenantId);

    expect(payErr).toBeNull();
    expect(payments?.length).toBe(2);
  });

  it("proves a doctor in Tenant A receives 0 rows when attempting to query billing tables directly (RLS)", async () => {
    const doctorA = await addMemberToTenant(tenantA.tenantId, "doctor");

    // Doctor querying subscriptions directly
    const { data: sub, error: subErr } = await doctorA.client
      .from("subscriptions")
      .select("*")
      .eq("tenant_id", tenantA.tenantId);

    expect(subErr).toBeNull();
    expect(sub?.length).toBe(0);

    // Doctor querying payment records directly
    const { data: payments, error: payErr } = await doctorA.client
      .from("payment_records")
      .select("*")
      .eq("tenant_id", tenantA.tenantId);

    expect(payErr).toBeNull();
    expect(payments?.length).toBe(0);
  });

  it("proves Tenant B's owner receives 0 rows when attempting to read Tenant A's billing data (Cross-tenant RLS)", async () => {
    // Tenant B owner querying Tenant A's subscription
    const { data: sub } = await tenantB.client
      .from("subscriptions")
      .select("*")
      .eq("tenant_id", tenantA.tenantId);

    expect(sub?.length).toBe(0);

    // Tenant B owner querying Tenant A's payments
    const { data: payments } = await tenantB.client
      .from("payment_records")
      .select("*")
      .eq("tenant_id", tenantA.tenantId);

    expect(payments?.length).toBe(0);
  });
});
