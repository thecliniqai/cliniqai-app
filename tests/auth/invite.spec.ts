import { describe, it, expect, beforeAll } from "vitest";
import { seedTenantWithOwner, addMemberToTenant, createUnlinkedUser } from "../helpers/tenants";
import { getAdminClient } from "../helpers/supabase-admin";
import { generateInviteToken, hashInviteToken } from "@/features/staff/invite";

describe("Staff Invitations & Join Flow (REQ-multi-tenancy, REQ-nfr-security)", () => {
  let tenantA: Awaited<ReturnType<typeof seedTenantWithOwner>>;
  let tenantB: Awaited<ReturnType<typeof seedTenantWithOwner>>;
  const admin = getAdminClient();

  beforeAll(async () => {
    tenantA = await seedTenantWithOwner("Alpha Hospital");
    tenantB = await seedTenantWithOwner("Beta Diagnostics");
  });

  it("allows Owner/Admin of tenant to insert an invitation row under RLS", async () => {
    const { rawToken, tokenHash, expiresAt } = generateInviteToken(7);

    // Insert invitation using tenant A owner's authenticated client
    const { data, error } = await tenantA.client
      .from("invitations")
      .insert({
        tenant_id: tenantA.tenantId,
        role: "doctor",
        invited_address: "dr.smith@alpha.com",
        token_hash: tokenHash,
        expires_at: expiresAt,
        created_by: tenantA.userId,
      })
      .select("id")
      .single();

    expect(error).toBeNull();
    expect(data?.id).toBeDefined();
  });

  it("blocks non-admin/doctor of tenant from inserting an invitation row", async () => {
    const doctorA = await addMemberToTenant(tenantA.tenantId, "doctor");
    const { tokenHash, expiresAt } = generateInviteToken(7);

    // Doctor attempting to insert invite directly into DB
    const { error } = await doctorA.client
      .from("invitations")
      .insert({
        tenant_id: tenantA.tenantId,
        role: "doctor",
        invited_address: "another.doc@alpha.com",
        token_hash: tokenHash,
        expires_at: expiresAt,
        created_by: doctorA.userId,
      });

    // RLS policy denies insert for non-owner/non-admin
    expect(error).not.toBeNull();
  });

  it("atomically consumes invitation and binds joining user to the correct tenant and role", async () => {
    const { rawToken, tokenHash, expiresAt } = generateInviteToken(7);

    // 1. Seed invite for Tenant A
    await admin.from("invitations").insert({
      tenant_id: tenantA.tenantId,
      role: "doctor",
      invited_address: "incoming.doctor@alpha.com",
      token_hash: tokenHash,
      expires_at: expiresAt,
      created_by: tenantA.userId,
    });

    // 2. Create a new user with zero memberships
    const newcomer = await createUnlinkedUser();

    // 3. Newcomer calls consume_invitation RPC
    const { data: joinedTenantId, error: joinError } = await newcomer.client.rpc(
      "consume_invitation",
      { p_token_hash: tokenHash }
    );

    expect(joinError).toBeNull();
    expect(joinedTenantId).toBe(tenantA.tenantId);

    // Verify membership was inserted
    const { data: mem } = await admin
      .from("memberships")
      .select("tenant_id, role")
      .eq("user_id", newcomer.userId)
      .single();

    expect(mem?.tenant_id).toBe(tenantA.tenantId);
    expect(mem?.role).toBe("doctor");

    // Verify invite marked consumed
    const { data: inv } = await admin
      .from("invitations")
      .select("consumed_at, consumed_by")
      .eq("token_hash", tokenHash)
      .single();

    expect(inv?.consumed_at).not.toBeNull();
    expect(inv?.consumed_by).toBe(newcomer.userId);
  });

  it("prevents replay: consuming an already-used invitation throws an error and creates no duplicate", async () => {
    const { tokenHash, expiresAt } = generateInviteToken(7);

    await admin.from("invitations").insert({
      tenant_id: tenantA.tenantId,
      role: "nurse",
      invited_address: "nurse.joy@alpha.com",
      token_hash: tokenHash,
      expires_at: expiresAt,
      created_by: tenantA.userId,
    });

    const user1 = await createUnlinkedUser();
    const user2 = await createUnlinkedUser();

    // First consumption succeeds
    const { error: err1 } = await user1.client.rpc("consume_invitation", {
      p_token_hash: tokenHash,
    });
    expect(err1).toBeNull();

    // Replay / second consumption fails
    const { error: err2 } = await user2.client.rpc("consume_invitation", {
      p_token_hash: tokenHash,
    });
    expect(err2).not.toBeNull();
    expect(err2?.message).toContain("already been used");

    // Assert user2 has no memberships created
    const { data: user2Mems } = await admin
      .from("memberships")
      .select("id")
      .eq("user_id", user2.userId);
    expect(user2Mems?.length).toBe(0);
  });

  it("rejects expired invitations and creates no membership", async () => {
    const { tokenHash } = generateInviteToken(7);
    const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    await admin.from("invitations").insert({
      tenant_id: tenantA.tenantId,
      role: "receptionist",
      invited_address: "old.invite@alpha.com",
      token_hash: tokenHash,
      expires_at: pastDate,
      created_by: tenantA.userId,
    });

    const candidate = await createUnlinkedUser();
    const { error } = await candidate.client.rpc("consume_invitation", {
      p_token_hash: tokenHash,
    });

    expect(error).not.toBeNull();
    expect(error?.message).toContain("expired");

    const { data: mems } = await admin
      .from("memberships")
      .select("id")
      .eq("user_id", candidate.userId);
    expect(mems?.length).toBe(0);
  });
});
