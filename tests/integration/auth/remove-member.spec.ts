/**
 * V2-05 05-05 (AUTH-05, SEC-07; acceptance 4 "a removed member reads 0 rows with a still-valid JWT"; threats T-05-24,
 * T-05-25, T-05-26). The acceptance path with real GoTrue sessions on the local stack:
 *   - the owner removes an admin through the `removeStaff` server action (staff:invite, the `remove_member` RPC);
 *   - the removed admin's EXISTING client (its access token still valid) reads nothing from any tenant table of the
 *     matrix, `session_is_live()` turns false, and its refresh token is dead (sessions deleted inside the RPC, R-43);
 *   - their API key answers 401 (`authenticateApiKey` filters `revoked_at`), their pending invitation is revoked;
 *   - signing in again lands on "no clinic";
 *   - a removed doctor is no longer offered or assignable, but still named on past records;
 *   - the action's refusals keep fixed texts (no staff:invite, admin removing an owner, self, bad input).
 * Synthetic data only; passwords are the per-run seeded password, never printed.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { authenticateApiKey, createApiKeySecret } from "@/lib/api/auth";
import { memberOfTenant } from "@/lib/auth/tenant-refs";
import { resolveServiceContext } from "@/lib/auth/context";
import { getTenantDoctorDirectory, getTenantDoctorMap } from "@/features/staff/service";
import { addMemberToTenant, seedTenantSubscription, seedTenantWithOwner, seededUserPassword, type SeededTenant } from "../../helpers/tenants";
import { DEFAULT_APP_ERROR_MESSAGES } from "@/lib/errors/app-error";
import { getAdminClient } from "../../helpers/supabase-admin";
import { ctxFor } from "../../helpers/context";
import { enableApiV1ForFile } from "../../helpers/api-v1";
import { refreshRevoked, signedInClient, type BrowserLikeClient } from "../../helpers/auth-flows";
import { TARGETS, type Rule, type TableTarget } from "../../authz/table-matrix";
// vi.mock below is hoisted above this import: the action resolves the session through the mocked user client.
import { removeStaff } from "@/features/staff/actions";

const state = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/supabase/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/server")>();
  return { ...actual, createClient: async () => state.client };
});

enableApiV1ForFile();

const admin = getAdminClient();

function kinds(rule: Rule): string[] {
  return rule.kind === "all" || rule.kind === "any" ? rule.rules.flatMap(kinds) : [rule.kind];
}

/** Every public table of the matrix that holds tenant data (global reference data excluded). */
const TENANT_DATA_TABLES = TARGETS.filter(
  (t): t is TableTarget => t.kind === "table" && t.schema === "public" && !kinds(t.rules.select).includes("catalogue"),
);

async function visibleRows(client: BrowserLikeClient, t: TableTarget): Promise<number | "denied"> {
  const { data, error } = await client.from(t.table as never).select(t.key.join(",")).limit(50);
  if (error) {
    if (error.code === "42501") return "denied";
    throw new Error(`${t.table}: unexpected error ${error.code}`);
  }
  return (data as unknown[]).length;
}

async function seedKey(tenantId: string, createdBy: string): Promise<string> {
  const secret = createApiKeySecret();
  const { error } = await admin.from("api_keys").insert({
    tenant_id: tenantId,
    name: `Synthetic removal key ${randomUUID().slice(0, 6)}`,
    key_prefix: secret.keyPrefix,
    key_hash: secret.keyHash,
    created_by: createdBy,
  });
  if (error) throw new Error(`seed api key failed: ${error.code}`);
  return secret.rawToken;
}

const apiKeyAuth = (raw: string) =>
  authenticateApiKey(new NextRequest("http://localhost/api/v1/patients", { headers: { authorization: `Bearer ${raw}` } }), () => admin);

async function membershipIdOf(tenantId: string, userId: string): Promise<string> {
  const { data, error } = await admin.from("memberships").select("id").eq("tenant_id", tenantId).eq("user_id", userId).single();
  if (error || !data) throw new Error(`membership lookup failed: ${error?.code}`);
  return data.id;
}

describe("AUTH-05: a removed member is cut off at once (acceptance 4, R-43)", () => {
  let owner: SeededTenant;
  let target: SeededTenant;
  let targetClient: BrowserLikeClient;
  let rawKey: string;
  let inviteId: string;
  let before: Map<string, number | "denied">;
  let result: Awaited<ReturnType<typeof removeStaff>>;

  beforeAll(async () => {
    owner = await seedTenantWithOwner(`Removal Clinic ${randomUUID().slice(0, 8)}`);
    target = await addMemberToTenant(owner.tenantId, "admin");

    const { data: patient, error: pErr } = await admin
      .from("patients")
      .insert({
        tenant_id: owner.tenantId,
        full_name: "Synthetic Removal Patient",
        phone: `+9198${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
        created_by: owner.userId,
      })
      .select("id")
      .single();
    if (pErr || !patient) throw new Error(`seed patient failed: ${pErr?.code}`);

    rawKey = await seedKey(owner.tenantId, target.userId);
    const { data: invite, error: iErr } = await admin
      .from("invitations")
      .insert({
        tenant_id: owner.tenantId,
        role: "nurse",
        invited_address: `removal-invitee-${randomUUID().slice(0, 8)}@example.com`,
        token_hash: randomUUID().replace(/-/g, "").repeat(2),
        expires_at: new Date(Date.now() + 3 * 86_400_000).toISOString(),
        created_by: target.userId,
      })
      .select("id")
      .single();
    if (iErr || !invite) throw new Error(`seed invitation failed: ${iErr?.code}`);
    inviteId = invite.id;

    // The removed user's own browser session, signed in before the removal.
    const signed = await signedInClient(target.userEmail, seededUserPassword());
    if (!signed.result.ok) throw new Error("target sign-in failed");
    targetClient = signed.client;

    before = new Map();
    for (const t of TENANT_DATA_TABLES) before.set(t.table, await visibleRows(targetClient, t));
    expect((await targetClient.rpc("session_is_live" as never)).data).toBe(true);
    expect((await apiKeyAuth(rawKey)).success).toBe(true);

    state.client = owner.client;
    result = await removeStaff({ membershipId: await membershipIdOf(owner.tenantId, target.userId), reason: "Synthetic: left the clinic" });
  });

  it("removes the member through the action and reports the revocation counts", () => {
    expect(result).toEqual({
      success: true,
      result: { userId: target.userId, keysRevoked: 1, invitesRevoked: 1, sessionsRevoked: expect.any(Number) },
    });
    if (result.success) expect(result.result.sessionsRevoked).toBeGreaterThanOrEqual(2);
  });

  it("before the removal the admin read clinic data (control)", () => {
    for (const table of ["patients", "memberships", "tenants", "api_keys", "invitations"]) {
      expect(before.get(table), table).toBeGreaterThan(0);
    }
  });

  it("the still-valid JWT now reads 0 rows from every tenant table of the matrix", async () => {
    // PostgREST still accepts the access token (an expired or invalid JWT would be an error, which visibleRows throws
    // on): this is the "still-valid JWT" leg, not a sign-out. RLS alone returns nothing.
    const after: Record<string, number | "denied"> = {};
    for (const t of TENANT_DATA_TABLES) after[t.table] = await visibleRows(targetClient, t);
    const leaks = Object.entries(after).filter(([, n]) => n !== 0 && n !== "denied");
    expect(leaks).toEqual([]);
    expect(Object.keys(after)).toHaveLength(TENANT_DATA_TABLES.length);
    expect(TENANT_DATA_TABLES.length).toBeGreaterThanOrEqual(40);
  });

  it("session_is_live() is false and the refresh token is dead (sessions deleted inside remove_member)", async () => {
    expect((await targetClient.rpc("session_is_live" as never)).data).toBe(false);
    expect(await refreshRevoked(targetClient)).toBe(true);
  });

  it("their API key answers 401 and their pending invitation is revoked", async () => {
    const auth = await apiKeyAuth(rawKey);
    expect(auth.success).toBe(false);
    if (!auth.success) expect(auth.response.status).toBe(401);
    const { data } = await admin.from("invitations").select("revoked_at, revoked_by").eq("id", inviteId).single();
    expect(data?.revoked_at).not.toBeNull();
    expect(data?.revoked_by).toBe(owner.userId);
  });

  it("writes one staff.removed audit row with counts only", async () => {
    const { data } = await admin
      .from("audit_logs")
      .select("actor_id, actor_role, metadata")
      .eq("tenant_id", owner.tenantId)
      .eq("action", "staff.removed");
    expect(data).toHaveLength(1);
    expect(data![0]).toMatchObject({
      actor_id: owner.userId,
      actor_role: "owner",
      metadata: { target_user_id: target.userId, role: "admin", keys_revoked: 1, invites_revoked: 1 },
    });
    expect(Object.keys(data![0].metadata as object).sort()).toEqual(
      // 05-12 (IND L-3): plus the count of the member's webhook subscriptions disabled.
      ["invites_revoked", "keys_revoked", "reason", "role", "sessions_revoked", "target_user_id", "webhooks_disabled"].sort(),
    );
  });

  it("signing in again lands on 'no clinic'", async () => {
    const again = await signedInClient(target.userEmail, seededUserPassword());
    expect(again.result.ok).toBe(true);
    state.client = again.client;
    const resolved = await resolveServiceContext();
    expect(resolved).toEqual({ ok: false, error: "Your account is not linked to a clinic yet", reason: "no_membership" });
  });
});

describe("AUTH-05: a removed doctor is not offered or assignable, but stays on past records", () => {
  it("drops out of the directory and memberOfTenant, keeps the name map", async () => {
    const owner = await seedTenantWithOwner(`Removal Doctor Clinic ${randomUUID().slice(0, 8)}`);
    const doctor = await addMemberToTenant(owner.tenantId, "doctor");
    await admin.from("memberships").update({ full_name: "Synthetic Removed Doctor" }).eq("tenant_id", owner.tenantId).eq("user_id", doctor.userId);
    const ctx = ctxFor(owner);
    expect(await memberOfTenant(ctx, doctor.userId)).toBe(true);
    expect((await getTenantDoctorDirectory(ctx)).map((d) => d.id)).toContain(doctor.userId);

    state.client = owner.client;
    const removed = await removeStaff({ membershipId: await membershipIdOf(owner.tenantId, doctor.userId), reason: "Synthetic" });
    expect(removed.success).toBe(true);

    expect(await memberOfTenant(ctx, doctor.userId)).toBe(false);
    expect((await getTenantDoctorDirectory(ctx)).map((d) => d.id)).not.toContain(doctor.userId);
    expect((await getTenantDoctorMap(ctx))[doctor.userId]).toBeDefined();
  });
});

describe("removeStaff refusals (fixed texts, nothing removed)", () => {
  let owner: SeededTenant;
  let adminMember: SeededTenant;
  let receptionist: SeededTenant;

  beforeAll(async () => {
    owner = await seedTenantWithOwner(`Removal Refusal Clinic ${randomUUID().slice(0, 8)}`);
    adminMember = await addMemberToTenant(owner.tenantId, "admin");
    receptionist = await addMemberToTenant(owner.tenantId, "receptionist");
  });

  const statusOf = async (userId: string) =>
    (await admin.from("memberships").select("status").eq("tenant_id", owner.tenantId).eq("user_id", userId).single()).data?.status;

  it("a receptionist (no staff:invite) is refused before any database call", async () => {
    state.client = receptionist.client;
    const out = await removeStaff({ membershipId: await membershipIdOf(owner.tenantId, adminMember.userId), reason: "Synthetic" });
    expect(out.success).toBe(false);
    expect(await statusOf(adminMember.userId)).toBe("active");
  });

  it("an admin removing the owner gets the owner-only text", async () => {
    state.client = adminMember.client;
    const out = await removeStaff({ membershipId: await membershipIdOf(owner.tenantId, owner.userId), reason: "Synthetic" });
    expect(out).toEqual({ success: false, error: "Only a clinic owner can remove an owner or an admin." });
    expect(await statusOf(owner.userId)).toBe("active");
  });

  it("the sole owner cannot remove themself", async () => {
    state.client = owner.client;
    const out = await removeStaff({ membershipId: await membershipIdOf(owner.tenantId, owner.userId), reason: "Synthetic" });
    expect(out).toEqual({
      success: false,
      error: "The clinic's only owner cannot be removed. Make someone else an owner first.",
    });
  });

  it("refuses a malformed id or an empty reason before the database", async () => {
    state.client = owner.client;
    expect(await removeStaff({ membershipId: "not-a-uuid", reason: "Synthetic" })).toEqual({
      success: false,
      error: "Select a staff member to remove.",
    });
    expect(await removeStaff({ membershipId: randomUUID(), reason: "  " })).toEqual({
      success: false,
      error: "Give a reason for removing this staff member.",
    });
  });

  it("another clinic's membership id is not found", async () => {
    const other = await seedTenantWithOwner(`Removal Other Clinic ${randomUUID().slice(0, 8)}`);
    state.client = owner.client;
    const out = await removeStaff({ membershipId: await membershipIdOf(other.tenantId, other.userId), reason: "Synthetic" });
    expect(out).toEqual({ success: false, error: "Staff member not found." });
    expect((await admin.from("memberships").select("status").eq("tenant_id", other.tenantId).single()).data?.status).toBe("active");
  });
});

// V2-05 05-12 (IND L-5): a dismissed member must not regain access when a lapsed clinic renews, so the OWNER of a
// locked clinic can still remove staff (same database rules, audited); every other role gets the locked text.
describe("removeStaff in a locked clinic (owner only)", () => {
  let owner: SeededTenant;
  let adminMember: SeededTenant;
  let nurse: SeededTenant;

  beforeAll(async () => {
    owner = await seedTenantWithOwner(`Removal Locked Clinic ${randomUUID().slice(0, 8)}`);
    adminMember = await addMemberToTenant(owner.tenantId, "admin");
    nurse = await addMemberToTenant(owner.tenantId, "nurse");
    await seedTenantSubscription(owner.tenantId, { status: "expired" });
  });

  const statusOf = async (userId: string) =>
    (await admin.from("memberships").select("status").eq("tenant_id", owner.tenantId).eq("user_id", userId).single()).data?.status;

  it("an admin of the locked clinic gets the locked text and nothing is removed", async () => {
    state.client = adminMember.client;
    const out = await removeStaff({ membershipId: await membershipIdOf(owner.tenantId, nurse.userId), reason: "Synthetic dismissal" });
    expect(out).toEqual({ success: false, error: DEFAULT_APP_ERROR_MESSAGES.SUBSCRIPTION_LOCKED });
    expect(await statusOf(nurse.userId)).toBe("active");
  });

  it("the owner removes the nurse; the removal is audited by the owner", async () => {
    state.client = owner.client;
    const out = await removeStaff({ membershipId: await membershipIdOf(owner.tenantId, nurse.userId), reason: "Synthetic dismissal" });
    expect(out).toMatchObject({ success: true, result: { userId: nurse.userId } });
    expect(await statusOf(nurse.userId)).toBe("removed");
    const { data } = await admin
      .from("audit_logs")
      .select("actor_id, actor_role")
      .eq("tenant_id", owner.tenantId)
      .eq("action", "staff.removed");
    expect(data).toEqual([{ actor_id: owner.userId, actor_role: "owner" }]);
  });
});
