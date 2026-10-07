import { describe, it, expect, beforeAll } from "vitest";
import { seedTenantWithOwner, createUnlinkedUser } from "../helpers/tenants";
import { getAdminClient } from "../helpers/supabase-admin";

describe("Multi-Tenancy & Tenant Isolation (REQ-multi-tenancy)", () => {
  let tenantA: Awaited<ReturnType<typeof seedTenantWithOwner>>;
  let tenantB: Awaited<ReturnType<typeof seedTenantWithOwner>>;

  beforeAll(async () => {
    // Seed two independent clinics with their own owner users
    tenantA = await seedTenantWithOwner("Apex Family Clinic");
    tenantB = await seedTenantWithOwner("Beacon Dental Care");
  });

  it("proves a tenant owner can read their own tenant row via anon/authenticated client", async () => {
    const { data, error } = await tenantA.client
      .from("tenants")
      .select("id, name")
      .eq("id", tenantA.tenantId)
      .single();

    expect(error).toBeNull();
    expect(data?.id).toBe(tenantA.tenantId);
    expect(data?.name).toBe("Apex Family Clinic");
  });

  it("proves Tenant A cannot read Tenant B data under Row Level Security", async () => {
    // Tenant A's authenticated client attempts to select Tenant B's row
    const { data, error } = await tenantA.client
      .from("tenants")
      .select("id, name")
      .eq("id", tenantB.tenantId);

    // RLS filters the row completely: returns empty array (0 rows), never leaks data
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("proves Tenant B cannot read Tenant A memberships", async () => {
    const { data, error } = await tenantB.client
      .from("memberships")
      .select("*")
      .eq("tenant_id", tenantA.tenantId);

    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("enforces database constraint: unique(user_id, tenant_id) rejects duplicate membership", async () => {
    const admin = getAdminClient();

    // Attempting to insert a duplicate membership for the same user in tenant A
    const { error } = await admin.from("memberships").insert({
      user_id: tenantA.userId,
      tenant_id: tenantA.tenantId,
      role: "doctor",
    });

    expect(error).not.toBeNull();
    expect(error?.code).toBe("23505"); // Postgres unique_violation code
  });

  it("proves a user with zero memberships gets 0 rows under RLS and cannot view any tenant", async () => {
    const unlinked = await createUnlinkedUser();

    const { data: tenantRows } = await unlinked.client.from("tenants").select("*");
    const { data: membershipRows } = await unlinked.client.from("memberships").select("*");

    expect(tenantRows).toHaveLength(0);
    expect(membershipRows).toHaveLength(0);
  });

  it("proves atomic clinic creation function (create_clinic_with_owner) inserts tenant and owner membership together", async () => {
    const unlinked = await createUnlinkedUser();

    // Call atomic RPC
    const { data: newTenantId, error } = await unlinked.client.rpc(
      "create_clinic_with_owner",
      {
        p_name: "Sunrise Pediatrics",
      }
    );

    expect(error).toBeNull();
    expect(newTenantId).toBeDefined();

    // Now unlinked user has access to newly created tenant
    const { data: tenantData } = await unlinked.client
      .from("tenants")
      .select("id, name")
      .eq("id", newTenantId as string)
      .single();

    expect(tenantData?.name).toBe("Sunrise Pediatrics");

    const { data: memData } = await unlinked.client
      .from("memberships")
      .select("role")
      .eq("tenant_id", newTenantId as string)
      .single();

    expect(memData?.role).toBe("owner");
  });
});
