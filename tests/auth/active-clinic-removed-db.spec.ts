/**
 * V2-06 06-09c M-REMOVED (adversarial B M-1): a member of two clinics removed from the ACTIVE one is told "removed"
 * (403 → `hardSignOut("removed")`), never silently switched to the clinic that is left.
 *
 * Before 06-09c, `getActiveMembership()` returned the only remaining membership without comparing it with the
 * `clinic_active_tenant` cookie, so the reviewer's probe P1 answered 200 `{ accessLevel: "full" }` (clinic B's) after
 * the removal from A, while a member left with two other clinics got 403: the outcome depended on how many clinics
 * remained. Real sessions and real 05-05 removals on the local stack:
 * - dual member, cookie = A, removed from A, one clinic left → 403 `no_membership`; the dashboard layout renders the
 *   sign-out screen (`MembershipEnded`), not B's shell; `getActiveMembership` throws the typed error;
 * - suspended in A (05-05 status `suspended`) → the same;
 * - no cookie → the remaining clinic (nothing was picked, nothing was removed from under the user);
 * - a cookie that is not a UUID is ignored (as the database header ignores it);
 * - `POST /auth/signout` expires the active-clinic cookie, so the next sign-in never resolves the ended clinic.
 * Synthetic data only.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { isValidElement } from "react";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  client: null as unknown,
  cookies: new Map<string, string>(),
  deleted: [] as string[],
}));

vi.mock("@/lib/supabase/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/server")>();
  return { ...actual, createClient: async () => state.client };
});

vi.mock("next/headers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/headers")>();
  return {
    ...actual,
    cookies: async () => ({
      get: (name: string) => (state.cookies.has(name) ? { name, value: state.cookies.get(name)! } : undefined),
      getAll: () => [...state.cookies].map(([name, value]) => ({ name, value })),
      set: () => undefined,
      delete: (name: string) => {
        state.deleted.push(name);
        state.cookies.delete(name);
      },
    }),
  };
});

import { GET } from "@/app/api/session-status/route";
import { POST as signOut } from "@/app/auth/signout/route";
import DashboardLayout from "@/app/(dashboard)/layout";
import PatientsPage from "@/app/(dashboard)/patients/(list)/page";
import { resolveServiceContext } from "@/lib/auth/context";
import { MembershipEnded } from "@/components/shell/membership-ended";
import { ActiveClinicMembershipEndedError, getActiveMembership } from "@/lib/auth/tenant";
import { ACTIVE_TENANT_COOKIE } from "@/lib/supabase/server";
import { getAdminClient } from "../helpers/supabase-admin";
import { createDualMembershipUser, seedTenantWithOwner, type DualMemberUser } from "../helpers/tenants";

async function status(): Promise<{ status: number; body: unknown }> {
  const res = await GET();
  return { status: res.status, body: await res.json() };
}

async function setMembershipStatus(userId: string, tenantId: string, next: "removed" | "suspended" | "active") {
  const { error } = await getAdminClient()
    .from("memberships")
    .update({ status: next, removed_at: next === "removed" ? new Date().toISOString() : null })
    .eq("tenant_id", tenantId)
    .eq("user_id", userId);
  expect(error).toBeNull();
}

describe("removed from the active clinic, one clinic left (local stack)", () => {
  let a: string;
  let b: string;
  let dual: DualMemberUser;

  beforeEach(async () => {
    const tag = randomUUID().slice(0, 6);
    a = (await seedTenantWithOwner(`Synthetic Removed A ${tag}`)).tenantId;
    b = (await seedTenantWithOwner(`Synthetic Removed B ${tag}`)).tenantId;
    dual = await createDualMembershipUser(a, "receptionist", b, "receptionist");
    state.client = dual.client;
    state.cookies = new Map([[ACTIVE_TENANT_COOKIE, a]]);
    state.deleted = [];
  });

  it("tracer: before the removal the active clinic (A) answers 200", async () => {
    expect((await status()).status).toBe(200);
    await expect(getActiveMembership()).resolves.toMatchObject({ tenantId: a });
  });

  it("removed from A with B left: 403 no_membership (before 06-09c: 200 with B's level)", async () => {
    await setMembershipStatus(dual.userId, a, "removed");
    const s = await status();
    expect(s.status).toBe(403);
    expect(s.body).toEqual({ error: "no_membership" });
    await expect(getActiveMembership()).rejects.toBeInstanceOf(ActiveClinicMembershipEndedError);
  });

  it("suspended in A with B left: the same refusal", async () => {
    await setMembershipStatus(dual.userId, a, "suspended");
    expect((await status()).status).toBe(403);
  });

  it("the dashboard layout renders the sign-out screen, never B's shell", async () => {
    await setMembershipStatus(dual.userId, a, "removed");
    const out = await DashboardLayout({ children: null });
    expect(isValidElement(out)).toBe(true);
    expect((out as { type: unknown }).type).toBe(MembershipEnded);
  });

  it("a wrapped page (a client navigation) and a server action refuse too: the sign-out screen, a fixed refusal", async () => {
    await setMembershipStatus(dual.userId, a, "removed");
    const out = await (PatientsPage as (p: unknown) => Promise<unknown>)({ searchParams: Promise.resolve({}) });
    expect(isValidElement(out)).toBe(true);
    expect((out as { type: unknown }).type).toBe(MembershipEnded);
    const ctx = await resolveServiceContext("patients:view");
    expect(ctx).toMatchObject({ ok: false, reason: "no_membership" });
  });

  it("the session ends between the layout's two auth checks (a sign-out in flight): a redirect to /login, not the error page", async () => {
    // CI 44874140074 (desktop flake): the shell's session-status watch signed the device out while a navigation to /today
    // rendered; the layout's own session read still saw the user, getActiveMembership()'s did not, and the layout rethrew
    // UnauthenticatedError to the route error page. Real client; only the second session read answers "no session".
    // V2-09d: the session is read from the verified claims (`getClaims`), once per request inside a Next request (this
    // spec has no request scope, so each caller reads it: the race stays reproducible).
    const real = dual.client as { auth: object };
    let calls = 0;
    const auth = new Proxy(real.auth, {
      get(target, prop) {
        if (prop === "getClaims") {
          return async () => {
            calls += 1;
            if (calls === 1) return (target as { getClaims: () => Promise<unknown> }).getClaims();
            return { data: null, error: null };
          };
        }
        const v = Reflect.get(target, prop);
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
    state.client = new Proxy(real, {
      get(target, prop) {
        if (prop === "auth") return auth;
        const v = Reflect.get(target, prop);
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
    const err = await DashboardLayout({ children: null }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(calls).toBeGreaterThanOrEqual(2);
    expect((err as { digest?: unknown } | null)?.digest).toMatch(/^NEXT_REDIRECT;.*;\/login;/);
  });

  it("no cookie (nothing picked): the remaining clinic answers", async () => {
    await setMembershipStatus(dual.userId, a, "removed");
    state.cookies.delete(ACTIVE_TENANT_COOKIE);
    expect((await status()).status).toBe(200);
    await expect(getActiveMembership()).resolves.toMatchObject({ tenantId: b });
  });

  it("a cookie that is not a UUID is ignored", async () => {
    await setMembershipStatus(dual.userId, a, "removed");
    state.cookies.set(ACTIVE_TENANT_COOKIE, "not-a-clinic");
    await expect(getActiveMembership()).resolves.toMatchObject({ tenantId: b });
  });

  it("POST /auth/signout of the removed member expires the active-clinic cookie", async () => {
    await setMembershipStatus(dual.userId, a, "removed");
    const res = await signOut(
      new NextRequest("http://127.0.0.1:3100/auth/signout", {
        method: "POST",
        headers: { "sec-fetch-site": "same-origin", "x-clinicos-signout": "fetch", cookie: `${ACTIVE_TENANT_COOKIE}=${a}` },
      }),
    );
    expect(res.status).toBe(200);
    const expired = res.headers.getSetCookie().find((c) => c.startsWith(`${ACTIVE_TENANT_COOKIE}=`));
    expect(expired).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/i);
  });
});
