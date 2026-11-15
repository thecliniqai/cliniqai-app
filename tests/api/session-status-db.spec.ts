/**
 * V2-06 06-06 (PWA_STRATEGY §3.7 step 2, §6.6; R-16, R-21): `GET /api/session-status` against the local stack, with
 * real sessions and real access levels (05-10a `my_tenant_access`, 05-10b fixtures, 05-05 membership status).
 *
 * - signed out → 401 `{ error: "unauthenticated" }`; a session revoked at GoTrue (its access token still unexpired)
 *   → 401 as well (the route reads the session with `auth.getUser()`, not the token alone);
 * - signed in, no membership → 403 `{ error: "no_membership" }`; a removed member (status `removed`, 05-05) → 403;
 * - owner of a `full` clinic → 200 with keys exactly `deploymentId`, `accessLevel`, `redirect`, `redirect: null`;
 * - locked owner → `/billing/locked`; locked receptionist → `/billing/locked/staff`; onboarding owner and receptionist →
 *   `/onboarding/billing` (the 05-10b rule, `accessRedirect`);
 * - a dual-clinic user gets the ACTIVE clinic's level (the `clinic_active_tenant` cookie the switcher sets; the route
 *   takes no input), and 409 when no clinic is chosen;
 * - `deploymentId` is `NEXT_DEPLOYMENT_ID` (else `VERCEL_DEPLOYMENT_ID`), null when unset or ill-shaped;
 * - every answer is `private, no-store`, carries no id, no clinic name and no email.
 *
 * Before 06-06 there was no route (the import fails). Synthetic data only.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { UserRole } from "@/lib/db/types";
import type { TestDb } from "../helpers/db";

const state = vi.hoisted(() => ({ client: null as unknown, activeTenant: null as string | null }));

vi.mock("@/lib/supabase/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/server")>();
  return { ...actual, createClient: async () => state.client };
});

vi.mock("next/headers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/headers")>();
  return {
    ...actual,
    cookies: async () => ({
      get: (name: string) => (name === "clinic_active_tenant" && state.activeTenant ? { name, value: state.activeTenant } : undefined),
    }),
  };
});

import { GET } from "@/app/api/session-status/route";
import { anonClient } from "../security/guard/engine";
import { getAdminClient } from "../helpers/supabase-admin";
import {
  addMemberToTenant,
  createUnlinkedUser,
  seedAccessFixtureClinic,
  seedTenantWithOwner,
  signInSeededUser,
  type AccessFixtureClinic,
} from "../helpers/tenants";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

interface Answer {
  status: number;
  body: Record<string, unknown>;
  cacheControl: string;
  text: string;
}

async function ask(client: unknown, activeTenant: string | null = null): Promise<Answer> {
  state.client = client;
  state.activeTenant = activeTenant;
  try {
    const res = await GET();
    const text = await res.text();
    return { status: res.status, body: JSON.parse(text) as Record<string, unknown>, cacheControl: res.headers.get("cache-control") ?? "", text };
  } finally {
    state.client = null;
    state.activeTenant = null;
  }
}

function expectNoStore(a: Answer) {
  expect(a.cacheControl).toMatch(/\bprivate\b/);
  expect(a.cacheControl).toMatch(/\bno-store\b/);
}

function expectStatusBody(a: Answer, accessLevel: string, redirect: string | null) {
  expect(a.status).toBe(200);
  expect(Object.keys(a.body).sort()).toEqual(["accessLevel", "deploymentId", "redirect"]);
  expect(a.body.accessLevel).toBe(accessLevel);
  expect(a.body.redirect).toBe(redirect);
  expectNoStore(a);
  expect(a.text).not.toMatch(UUID);
}

describe("GET /api/session-status (local stack)", () => {
  let fullOwner: TestDb;
  let fullTenant: string;
  let locked: AccessFixtureClinic;
  let onboarding: AccessFixtureClinic;
  const lockedClients: Partial<Record<UserRole, TestDb>> = {};
  const onboardingClients: Partial<Record<UserRole, TestDb>> = {};

  beforeAll(async () => {
    const owner = await seedTenantWithOwner(`Session Status Full ${Date.now()}`);
    fullOwner = owner.client;
    fullTenant = owner.tenantId;
    locked = await seedAccessFixtureClinic("locked", `Session Status Locked ${Date.now()}`, ["owner", "receptionist"]);
    onboarding = await seedAccessFixtureClinic("onboarding", `Session Status Onboarding ${Date.now()}`, ["owner", "receptionist"]);
    for (const u of locked.users) lockedClients[u.role] = await signInSeededUser(u.email);
    for (const u of onboarding.users) onboardingClients[u.role] = await signInSeededUser(u.email);
  }, 120_000);

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("tracer: the owner of a full clinic gets { accessLevel: 'full', redirect: null } and nothing else", async () => {
    const a = await ask(fullOwner);
    expectStatusBody(a, "full", null);
  });

  it("signed out → 401 unauthenticated, no-store", async () => {
    const a = await ask(anonClient());
    expect(a.status).toBe(401);
    expect(a.body).toEqual({ error: "unauthenticated" });
    expectNoStore(a);
  });

  it("a session revoked at GoTrue (access token still unexpired) → 401", async () => {
    const member = await addMemberToTenant(fullTenant, "nurse");
    expect((await ask(member.client)).status).toBe(200);
    const { data } = await member.client.auth.getSession();
    const token = data.session?.access_token;
    expect(token, "the member has a session").toBeTruthy();
    const { error } = await getAdminClient().auth.admin.signOut(token!, "global");
    expect(error).toBeNull();
    const a = await ask(member.client);
    expect(a.status).toBe(401);
    expect(a.body).toEqual({ error: "unauthenticated" });
  });

  it("signed in without a membership → 403 no_membership", async () => {
    const user = await createUnlinkedUser();
    const a = await ask(user.client);
    expect(a.status).toBe(403);
    expect(a.body).toEqual({ error: "no_membership" });
    expectNoStore(a);
  });

  it("a removed member (05-05 status 'removed', session still live) → 403 no_membership", async () => {
    const member = await addMemberToTenant(fullTenant, "receptionist");
    expect((await ask(member.client)).status).toBe(200);
    const { error } = await getAdminClient()
      .from("memberships")
      .update({ status: "removed", removed_at: new Date().toISOString() })
      .eq("tenant_id", fullTenant)
      .eq("user_id", member.userId);
    expect(error).toBeNull();
    const a = await ask(member.client);
    expect(a.status).toBe(403);
    expect(a.body).toEqual({ error: "no_membership" });
  });

  it("locked owner → /billing/locked; locked receptionist → /billing/locked/staff", async () => {
    expectStatusBody(await ask(lockedClients.owner), "locked", "/billing/locked");
    expectStatusBody(await ask(lockedClients.receptionist), "locked", "/billing/locked/staff");
  });

  it("onboarding owner and receptionist → /onboarding/billing", async () => {
    expectStatusBody(await ask(onboardingClients.owner), "onboarding", "/onboarding/billing");
    expectStatusBody(await ask(onboardingClients.receptionist), "onboarding", "/onboarding/billing");
  });

  it("a dual-clinic user gets the active clinic's level (cookie), and 409 when none is chosen", async () => {
    // Receptionist of the locked clinic, then also a member of a full clinic.
    const dualEmail = locked.users.find((u) => u.role === "receptionist")!;
    const second = await seedTenantWithOwner(`Session Status Second ${Date.now()}`);
    const { error } = await getAdminClient()
      .from("memberships")
      .insert({ user_id: dualEmail.userId, tenant_id: second.tenantId, role: "doctor" });
    expect(error).toBeNull();
    const client = await signInSeededUser(dualEmail.email);

    expectStatusBody(await ask(client, locked.tenantId), "locked", "/billing/locked/staff");
    expectStatusBody(await ask(client, second.tenantId), "full", null);
    const none = await ask(client, null);
    expect(none.status).toBe(409);
    expect(none.body).toEqual({ error: "clinic_selection_required" });
    // A cookie naming a clinic the user is not a member of is refused, never answered for that clinic.
    const foreign = await ask(client, fullTenant);
    expect(foreign.status).toBe(403);
    expect(foreign.body).toEqual({ error: "no_membership" });

    await getAdminClient().from("memberships").delete().eq("user_id", dualEmail.userId).eq("tenant_id", second.tenantId);
  });

  it("deploymentId: NEXT_DEPLOYMENT_ID, else VERCEL_DEPLOYMENT_ID; null when unset or ill-shaped", async () => {
    vi.stubEnv("NEXT_DEPLOYMENT_ID", undefined);
    vi.stubEnv("VERCEL_DEPLOYMENT_ID", undefined);
    expect((await ask(fullOwner)).body.deploymentId).toBeNull();
    vi.stubEnv("VERCEL_DEPLOYMENT_ID", "dpl_SyntheticVercel01");
    expect((await ask(fullOwner)).body.deploymentId).toBe("dpl_SyntheticVercel01");
    vi.stubEnv("NEXT_DEPLOYMENT_ID", "e2e-local-deployment");
    expect((await ask(fullOwner)).body.deploymentId).toBe("e2e-local-deployment");
    vi.stubEnv("NEXT_DEPLOYMENT_ID", "not a valid id");
    expect((await ask(fullOwner)).body.deploymentId).toBeNull();
  });

  it("no answer carries the clinic's name or the user's email", async () => {
    const answers = [await ask(lockedClients.owner), await ask(onboardingClients.owner), await ask(fullOwner)];
    for (const a of answers) {
      expect(a.text).not.toContain(locked.tenantName);
      expect(a.text).not.toContain(onboarding.tenantName);
      expect(a.text).not.toContain("@");
    }
  });
});
