import { describe, it, expect, beforeAll } from "vitest";
import { seedTenantWithOwner, addMemberToTenant, createUnlinkedUser } from "../helpers/tenants";
import { getAdminClient } from "../helpers/supabase-admin";
import { generateInviteToken, hashInviteToken } from "@/features/staff/invite";
import { psql } from "../helpers/sql";

/** Runs `sql` as `authenticated` with `userId` as the JWT subject (one transaction); "ok" or the database error text. */
function psqlAs(userId: string, sql: string): string {
  if (!/^[0-9a-f-]{36}$/.test(userId)) throw new Error("psqlAs: not a uuid");
  try {
    psql(
      `begin; select set_config('request.jwt.claims', '{"sub":"${userId}","role":"authenticated"}', true); ` +
        `set local role authenticated; ${sql}; commit;`
    );
    return "ok";
  } catch (err) {
    return String((err as { stderr?: string }).stderr ?? err);
  }
}

describe("Staff Invitations & Join Flow (REQ-multi-tenancy, REQ-nfr-security)", () => {
  let tenantA: Awaited<ReturnType<typeof seedTenantWithOwner>>;
  let tenantB: Awaited<ReturnType<typeof seedTenantWithOwner>>;
  const admin = getAdminClient();

  beforeAll(async () => {
    tenantA = await seedTenantWithOwner("Alpha Hospital");
    tenantB = await seedTenantWithOwner("Beta Diagnostics");
  });

  // V2-05 05-07a (000088): invite_staff is the only way a member creates an invitation; it stores no token (minted at
  // send time, R-30) and a direct INSERT is refused for everyone, the owner included.
  it("the owner invites through invite_staff; the row holds no token yet; a direct INSERT is refused", async () => {
    const { data, error } = await tenantA.client.rpc("invite_staff", {
      p_tenant: tenantA.tenantId,
      p_email: "dr.smith@alpha.com",
      p_role: "doctor",
    });
    expect(error).toBeNull();
    const id = (data as { id: string; deduped: boolean }).id;
    expect((data as { deduped: boolean }).deduped).toBe(false);
    const { data: row } = await admin.from("invitations").select("token_hash, token_version, created_by").eq("id", id).single();
    expect(row).toEqual({ token_hash: null, token_version: 1, created_by: tenantA.userId });

    const { tokenHash, expiresAt } = generateInviteToken(7);
    const direct = await tenantA.client.from("invitations").insert({
      tenant_id: tenantA.tenantId,
      role: "doctor",
      invited_address: "dr.direct@alpha.com",
      token_hash: tokenHash,
      expires_at: expiresAt,
      created_by: tenantA.userId,
    });
    expect(direct.error?.code).toBe("42501");
  });

  it("blocks a doctor (no staff:invite) from inviting", async () => {
    const doctorA = await addMemberToTenant(tenantA.tenantId, "doctor");
    const { error } = await doctorA.client.rpc("invite_staff", {
      p_tenant: tenantA.tenantId,
      p_email: "another.doc@alpha.com",
      p_role: "doctor",
    });
    expect(error?.code).toBe("42501");
    expect(error?.message).toBe("STAFF_INVITE_FORBIDDEN");
  });

  it("atomically consumes invitation and binds joining user to the correct tenant and role", async () => {
    const { tokenHash, expiresAt } = generateInviteToken(7);

    // 1. A new user with zero memberships (confirmed email), and an invite to that address for Tenant A
    const newcomer = await createUnlinkedUser();
    await admin.from("invitations").insert({
      tenant_id: tenantA.tenantId,
      role: "doctor",
      invited_address: newcomer.userEmail,
      token_hash: tokenHash,
      expires_at: expiresAt,
      created_by: tenantA.userId,
    });

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

    const user1 = await createUnlinkedUser();
    const user2 = await createUnlinkedUser();
    await admin.from("invitations").insert({
      tenant_id: tenantA.tenantId,
      role: "nurse",
      invited_address: user1.userEmail,
      token_hash: tokenHash,
      expires_at: expiresAt,
      created_by: tenantA.userId,
    });

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

    const candidate = await createUnlinkedUser();
    await admin.from("invitations").insert({
      tenant_id: tenantA.tenantId,
      role: "receptionist",
      invited_address: candidate.userEmail,
      token_hash: tokenHash,
      expires_at: pastDate,
      created_by: tenantA.userId,
    });
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
  /**
   * V2-05 05-11b, H-INVITE (05a review RLS H-1, migration 000071). Before: an admin read the pending owner invitation's
   * token_hash through the Data API and redeemed it from a second account of their own, which became an owner.
   */
  describe("H-INVITE: the invitation hash is not a bearer credential", () => {
    it("an admin cannot read token_hash through the Data API, but still lists the pending invitations", async () => {
      const adminA = await addMemberToTenant(tenantA.tenantId, "admin");
      const { tokenHash, expiresAt } = generateInviteToken(7);
      const { data: inv } = await admin
        .from("invitations")
        .insert({
          tenant_id: tenantA.tenantId,
          role: "owner",
          invited_address: "partner-h-invite@example.com",
          token_hash: tokenHash,
          expires_at: expiresAt,
          created_by: tenantA.userId,
        })
        .select("id")
        .single();

      const hashRead = await adminA.client.from("invitations").select("token_hash").eq("id", inv!.id);
      expect(hashRead.error?.code).toBe("42501");
      expect(hashRead.data).toBeNull();
      const starRead = await adminA.client.from("invitations").select("*").eq("id", inv!.id);
      expect(starRead.error?.code).toBe("42501");

      // The staff page's columns (app/(dashboard)/staff/page.tsx) stay readable.
      const list = await adminA.client
        .from("invitations")
        .select("id, invited_address, role, expires_at, consumed_at")
        .eq("id", inv!.id);
      expect(list.error).toBeNull();
      expect(list.data).toEqual([expect.objectContaining({ id: inv!.id, role: "owner" })]);
    });

    it("a second account holding the hash cannot redeem an invitation addressed to someone else", async () => {
      const { tokenHash, expiresAt } = generateInviteToken(7);
      await admin.from("invitations").insert({
        tenant_id: tenantA.tenantId,
        role: "owner",
        invited_address: "partner-h-invite-2@example.com",
        token_hash: tokenHash,
        expires_at: expiresAt,
        created_by: tenantA.userId,
      });
      const sockPuppet = await createUnlinkedUser();

      const { data, error } = await sockPuppet.client.rpc("consume_invitation", { p_token_hash: tokenHash });
      expect(data).toBeNull();
      expect(error).toMatchObject({ code: "42501", message: "INVITATION_EMAIL_MISMATCH" });
      const { data: mems } = await admin.from("memberships").select("id").eq("user_id", sockPuppet.userId);
      expect(mems).toEqual([]);
      const { data: row } = await admin.from("invitations").select("consumed_at").eq("token_hash", tokenHash).single();
      expect(row?.consumed_at).toBeNull();
    });

    it("an invitee whose email is not confirmed cannot redeem yet", async () => {
      const { tokenHash, expiresAt } = generateInviteToken(7);
      const email = `unconfirmed-${Date.now()}@example.com`;
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        password: "Synthetic-Unconfirmed-Pass-1",
        email_confirm: false,
      });
      expect(createErr).toBeNull();
      await admin.from("invitations").insert({
        tenant_id: tenantA.tenantId,
        role: "doctor",
        invited_address: email,
        token_hash: tokenHash,
        expires_at: expiresAt,
        created_by: tenantA.userId,
      });
      // An unconfirmed user cannot sign in through the API, so call the RPC as them through SQL claims.
      const out = psqlAs(created.user!.id, `select public.consume_invitation('${tokenHash}')`);
      expect(out).toContain("INVITATION_EMAIL_UNCONFIRMED");
      const { data: mems } = await admin.from("memberships").select("id").eq("user_id", created.user!.id);
      expect(mems).toEqual([]);
    });
  });
});
