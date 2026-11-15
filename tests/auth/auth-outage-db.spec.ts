/**
 * V2-06 06-09c H-AUTHOUT (IND H-1, adversarial B H-1): a Supabase Auth incident is not a sign-out.
 *
 * Before 06-09c, `getActiveMembership()` threw `UnauthenticatedError` for ANY error of `auth.getUser()`. auth-js turns
 * a network failure, a timeout, a 5xx and a 429 into `{ user: null, error }`, so `/api/session-status` answered 401 and
 * every open device signed itself out, purged and lost unsaved input (the reviewers' probe: 503 → 401, network → 401).
 *
 * Here a real owner session on the local stack talks to GoTrue through a transport that fails `/auth/v1/user` on
 * demand (`tests/helpers/blip-client.ts`): 503, 502 (HTML), 500, 429, 408, a network error, a timeout and an
 * unreadable answer each give 503 `{ error: "unavailable" }` (no-store); GoTrue refusing the session (401/403) and a
 * session revoked for real still give 401. The same classification reaches the other callers: `resolveServiceContext`
 * never answers `unauthenticated` (whose `UNAUTHENTICATED` code signs the client out), the dashboard layout and a
 * wrapped page show the error boundary instead of redirecting to sign-in. Synthetic data only.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

const state = vi.hoisted(() => ({ client: null as unknown }));

vi.mock("@/lib/supabase/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/server")>();
  return { ...actual, createClient: async () => state.client };
});

import { GET } from "@/app/api/session-status/route";
import DashboardLayout from "@/app/(dashboard)/layout";
import PatientsPage from "@/app/(dashboard)/patients/(list)/page";
import { resolveServiceContext } from "@/lib/auth/context";
import { AuthUnavailableError, getActiveMembership, isDefinitiveAuthRejection, UnauthenticatedError } from "@/lib/auth/tenant";
import { AuthApiError, AuthRetryableFetchError, AuthSessionMissingError, AuthUnknownError } from "@supabase/supabase-js";
import { blipClient, type BlipClient, type BlipMode } from "../helpers/blip-client";
import { getAdminClient } from "../helpers/supabase-admin";
import { seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";

const RETRYABLE: BlipMode[] = ["503", "502", "500", "429", "408", "network", "timeout", "unreadable"];

async function ask(): Promise<{ status: number; body: unknown; cacheControl: string }> {
  const res = await GET();
  return { status: res.status, body: await res.json(), cacheControl: res.headers.get("cache-control") ?? "" };
}

/** Next's redirect/notFound are thrown control-flow errors with a digest. */
function digestOf(err: unknown): string | null {
  const digest = (err as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" ? digest : null;
}

async function settle<T>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; err: unknown }> {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    return { ok: false, err };
  }
}

describe("isDefinitiveAuthRejection (which auth errors are a real 'no session')", () => {
  it("no session, and a GoTrue 4xx other than 408/429, are definitive; everything else is retryable", () => {
    expect(isDefinitiveAuthRejection(new AuthSessionMissingError())).toBe(true);
    expect(isDefinitiveAuthRejection(new AuthApiError("invalid JWT", 401, "bad_jwt"))).toBe(true);
    expect(isDefinitiveAuthRejection(new AuthApiError("session gone", 403, "session_not_found"))).toBe(true);
    expect(isDefinitiveAuthRejection(new AuthApiError("refresh token", 400, "refresh_token_not_found"))).toBe(true);
    expect(isDefinitiveAuthRejection(new AuthApiError("slow down", 429, "over_request_rate_limit"))).toBe(false);
    expect(isDefinitiveAuthRejection(new AuthApiError("timeout", 408, undefined))).toBe(false);
    expect(isDefinitiveAuthRejection(new AuthApiError("boom", 500, "unexpected_failure"))).toBe(false);
    expect(isDefinitiveAuthRejection(new AuthRetryableFetchError("fetch failed", 0))).toBe(false);
    expect(isDefinitiveAuthRejection(new AuthRetryableFetchError("Service Unavailable", 503))).toBe(false);
    expect(isDefinitiveAuthRejection(new AuthUnknownError("not json", new SyntaxError("x")))).toBe(false);
    expect(isDefinitiveAuthRejection(new TypeError("fetch failed"))).toBe(false);
    expect(isDefinitiveAuthRejection(null)).toBe(false);
  });
});

describe("Supabase Auth unavailable (local stack, real session, failing /auth/v1/user)", () => {
  let owner: SeededTenant;
  let blip: BlipClient;

  beforeAll(async () => {
    owner = await seedTenantWithOwner(`Synthetic Auth Outage ${randomUUID().slice(0, 6)}`);
    blip = await blipClient(owner.userEmail, ["/auth/v1/user"]);
    state.client = blip.client;
  });

  it("tracer: with Auth answering, the owner's status is 200 full", async () => {
    blip.setMode("ok");
    const a = await ask();
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({ accessLevel: "full", redirect: null });
  });

  it.each(RETRYABLE)("Auth answers %s → 503 unavailable (never 401), no-store", async (mode) => {
    blip.setMode(mode);
    const before = blip.blipped.length;
    const a = await ask();
    blip.setMode("ok");
    expect(blip.blipped.length, "the request reached the failing transport").toBeGreaterThan(before);
    expect(a.status).toBe(503);
    expect(a.body).toEqual({ error: "unavailable" });
    expect(a.cacheControl).toMatch(/private/);
    expect(a.cacheControl).toMatch(/no-store/);
  });

  it.each(["401", "403"] as const)("GoTrue refuses the session (%s) → 401 unauthenticated", async (mode) => {
    blip.setMode(mode);
    const a = await ask();
    blip.setMode("ok");
    expect(a.status).toBe(401);
    expect(a.body).toEqual({ error: "unauthenticated" });
  });

  it("getActiveMembership: AuthUnavailableError on an outage, UnauthenticatedError on a refusal", async () => {
    blip.setMode("503");
    await expect(getActiveMembership()).rejects.toBeInstanceOf(AuthUnavailableError);
    blip.setMode("network");
    await expect(getActiveMembership()).rejects.toBeInstanceOf(AuthUnavailableError);
    blip.setMode("403");
    await expect(getActiveMembership()).rejects.toBeInstanceOf(UnauthenticatedError);
    blip.setMode("ok");
    await expect(getActiveMembership()).resolves.toMatchObject({ tenantId: owner.tenantId, role: "owner" });
  });

  it("server actions: an outage is the generic failure, never 'unauthenticated' (which signs the client out)", async () => {
    for (const mode of ["503", "timeout", "429"] as const) {
      blip.setMode(mode);
      const r = await resolveServiceContext("patients:view");
      expect(r.ok, mode).toBe(false);
      if (!r.ok) {
        expect(r.reason, mode).not.toBe("unauthenticated");
        expect(r.error, mode).not.toBe("Unauthenticated");
      }
    }
    blip.setMode("403");
    const refused = await resolveServiceContext("patients:view");
    expect(refused).toMatchObject({ ok: false, reason: "unauthenticated" });
    blip.setMode("ok");
  });

  it("the dashboard layout and a wrapped page show the error boundary on an outage, not a redirect to sign-in", async () => {
    blip.setMode("503");
    const layout = await settle(() => DashboardLayout({ children: null }));
    const page = await settle(() => (PatientsPage as (p: unknown) => Promise<unknown>)({ searchParams: Promise.resolve({}) }));
    blip.setMode("ok");
    expect(layout.ok).toBe(false);
    if (!layout.ok) {
      expect(layout.err).toBeInstanceOf(AuthUnavailableError);
      expect(digestOf(layout.err)).toBeNull();
    }
    expect(page.ok).toBe(false);
    if (!page.ok) expect(digestOf(page.err) ?? "").not.toMatch(/^NEXT_REDIRECT;.*\/login/);
  });

  it("a session revoked for real still answers 401 (the outage rule does not hide a revocation)", async () => {
    const other = await seedTenantWithOwner(`Synthetic Auth Revoked ${randomUUID().slice(0, 6)}`);
    const revoked = await blipClient(other.userEmail, ["/auth/v1/user"]);
    const { data } = await revoked.client.auth.getSession();
    const token = data.session?.access_token;
    expect(token, "the member has a session").toBeTruthy();
    const { error } = await getAdminClient().auth.admin.signOut(token!, "global");
    expect(error).toBeNull();
    state.client = revoked.client;
    try {
      const a = await ask();
      expect(a.status).toBe(401);
      expect(a.body).toEqual({ error: "unauthenticated" });
    } finally {
      state.client = blip.client;
    }
  });
});
