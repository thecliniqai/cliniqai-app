/**
 * V2-06 06-09d close: the four Lows of the adversarial re-check (reviews/v206d-review-recheck.md), against the local
 * GoTrue with real sessions in `@supabase/ssr` cookies, the real `lib/supabase/server.ts` client (cookie jar behind a
 * mocked `next/headers`), `proxy()`, `/api/session-status`, `/auth/signout` and the password service. Slowness is
 * injected with a `globalThis.fetch` wrapper that lets GoTrue PROCESS the call at once and only delays its answer (the
 * re-checker's "slow but processed" mode), for the session under test only.
 *
 * - L-N1: the Auth budget covers only the session calls. A password change whose `PUT /user` answers after 4.5 s (the
 *   change already applied) reports success, the new password signs in and the old one does not; before, the 3.5 s
 *   budget started at the first Auth call aborted the answer and the user was told the change failed.
 * - L-N2: the proxy's budget is 5.5 s (hard stop 5.75 s): a refresh answered after 4.5 s is a signed-in request with the
 *   rotated session stored, not "unavailable"; a refresh that never answers still ends inside the bound and proxy +
 *   route stay under the client's 10 s.
 * - L-N4: a request the proxy finds definitively signed out expires the HttpOnly active-clinic pin: a revoked session
 *   (307 /login), a signed-out visit to a public page, a signed-out Server Action POST. An Auth outage keeps it. A user of
 *   clinic B only who signs in on a device last pinned to clinic A gets B (200), not A's "membership ended" (403).
 *
 * L-N3 (the `/forgot-password` browser client) runs in a browser: tests/e2e/pwa/12-forgot-password-refresh.spec.ts.
 * Synthetic users and clinics only; tokens and passwords are compared, never printed.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { createClient as createJsClient, type Session } from "@supabase/supabase-js";

const state = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  writes: [] as Array<{ name: string; value: string; options?: { maxAge?: number } }>,
  requestHeaders: {} as Record<string, string>,
}));

vi.mock("next/headers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/headers")>();
  const store = () => ({
    get: (name: string) => (state.jar.has(name) ? { name, value: state.jar.get(name)! } : undefined),
    getAll: () => [...state.jar].map(([name, value]) => ({ name, value })),
    has: (name: string) => state.jar.has(name),
    set: (name: string, value: string, options?: { maxAge?: number }) => {
      state.writes.push({ name, value, options });
      if (value === "" || options?.maxAge === 0) state.jar.delete(name);
      else state.jar.set(name, value);
    },
    delete: (name: string) => {
      state.writes.push({ name, value: "", options: { maxAge: 0 } });
      state.jar.delete(name);
    },
  });
  return { ...actual, cookies: async () => store(), headers: async () => new Headers(state.requestHeaders) };
});

import { GET } from "@/app/api/session-status/route";
import { PROXY_ACTIVE_TENANT_COOKIE, PROXY_CONTEXT_COOKIE, PROXY_CONTEXT_COOKIE_SECURE, proxy } from "@/proxy";
import { CONTEXT_COOKIE, CONTEXT_COOKIE_SECURE } from "@/lib/auth/context-cookie";
import { changePassword } from "@/features/auth/service";
import { ACTIVE_TENANT_COOKIE } from "@/lib/supabase/server";
import { AUTH_REQUEST_BUDGET_MS, PROXY_AUTH_DEADLINE_MS, PROXY_AUTH_REQUEST_BUDGET_MS } from "@/lib/supabase/auth-transport";
import { STATUS_TIMEOUT_MS } from "@/lib/pwa/session-status";
import { publicEnv } from "@/lib/env";
import { getAdminClient } from "../helpers/supabase-admin";
import { createUnlinkedUser, seedTenantWithOwner, seededUserPassword } from "../helpers/tenants";

const COOKIE = `sb-${new URL(publicEnv.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0]}-auth-token`;
const ACTIVE = "clinic_active_tenant";
const MARK = "x-clinicos-auth-state";

// ---------------------------------------------------------------------------------------------------------------------
// "Slow but processed": the call reaches GoTrue at once; its answer is held back `delayMs` (an abort during the wait
// loses the answer, as a timed-out network read would). Only the session under test.
// ---------------------------------------------------------------------------------------------------------------------

const slow = { target: null as null | "refresh" | "put-user" | "hang-refresh", token: "", delayMs: 0, hits: 0 };
const realFetch = globalThis.fetch;

const abortError = () => new DOMException("This operation was aborted", "AbortError");

function hold(ms: number, signal: AbortSignal | null | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(abortError());
      },
      { once: true },
    );
  });
}

beforeAll(() => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const body = typeof init?.body === "string" ? init.body : "";
    const auth = new Headers(init?.headers).get("authorization") ?? "";
    const isRefresh = url.pathname.endsWith("/auth/v1/token") && url.searchParams.get("grant_type") === "refresh_token";
    const isPutUser = url.pathname.endsWith("/auth/v1/user") && (init?.method ?? "GET").toUpperCase() === "PUT";
    if ((slow.target === "refresh" || slow.target === "hang-refresh") && isRefresh && slow.token && body.includes(slow.token)) {
      slow.hits += 1;
      if (slow.target === "hang-refresh") {
        await hold(10 * STATUS_TIMEOUT_MS, init?.signal);
        throw abortError();
      }
      const answer = await realFetch(input, { ...init, signal: undefined });
      await hold(slow.delayMs, init?.signal);
      return answer;
    }
    if (slow.target === "put-user" && isPutUser && slow.token && auth === `Bearer ${slow.token}`) {
      slow.hits += 1;
      const answer = await realFetch(input, { ...init, signal: undefined });
      await hold(slow.delayMs, init?.signal);
      return answer;
    }
    return realFetch(input, init);
  }) as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

function withSlow<T>(target: "refresh" | "put-user" | "hang-refresh", token: string, delayMs: number, fn: () => Promise<T>): Promise<T> {
  slow.target = target;
  slow.token = token;
  slow.delayMs = delayMs;
  return fn().finally(() => {
    slow.target = null;
  });
}

// ---------------------------------------------------------------------------------------------------------------------

async function signIn(email: string, password = seededUserPassword()): Promise<{ session: Session | null; status: number | null }> {
  const client = createJsClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  return { session: data.session, status: error ? (error.status ?? 0) : null };
}

async function session(email: string): Promise<Session> {
  const { session: s, status } = await signIn(email);
  if (!s) throw new Error(`sign-in failed: ${status}`);
  return s;
}

const encode = (s: Session) => `base64-${Buffer.from(JSON.stringify(s), "utf8").toString("base64url")}`;
const expired = (s: Session): Session => ({ ...s, expires_at: Math.floor(Date.now() / 1000) - 120, expires_in: -120 });

function device(s: Session, activeClinic?: string) {
  state.jar = new Map([[COOKIE, encode(s)]]);
  if (activeClinic) state.jar.set(ACTIVE, activeClinic);
  state.writes = [];
  state.requestHeaders = {};
}

async function poll() {
  const res = await GET(new NextRequest("http://localhost/api/session-status"));
  return { status: res.status, body: (await res.json()) as unknown, setCookies: res.headers.getSetCookie() };
}

/** Applies Set-Cookie headers to the jar, as the browser would. */
function applySetCookies(setCookies: string[]) {
  for (const header of setCookies) {
    const [pair] = header.split(";");
    const eq = pair.indexOf("=");
    const name = pair.slice(0, eq).trim();
    const value = decodeURIComponent(pair.slice(eq + 1));
    if (value === "" || /max-age=0/i.test(header) || /expires=thu, 01 jan 1970/i.test(header)) state.jar.delete(name);
    else state.jar.set(name, value);
  }
}

/** One request through the proxy with these cookies (`name=value` pairs), as a browser would send it. */
async function throughProxy(cookies: Record<string, string>, path = "/patients", method = "GET") {
  const headers = new Headers({ cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ") });
  if (method !== "GET") headers.set("next-action", "0123456789abcdef");
  const started = Date.now();
  const res = await proxy(new NextRequest(`http://localhost${path}`, { method, headers }));
  const setCookies = res.headers.getSetCookie();
  return {
    res,
    ms: Date.now() - started,
    setCookies,
    mark: res.headers.get(`x-middleware-request-${MARK}`),
    pinExpired: setCookies.some((h) => h.startsWith(`${ACTIVE}=;`) && /max-age=0/i.test(h)),
    pinWrites: setCookies.filter((h) => h.startsWith(`${ACTIVE}=`)),
    authDeletions: setCookies.filter((h) => h.startsWith(COOKIE) && /^[^=]+=;/.test(h)),
    authRefreshed: setCookies.some((h) => h.startsWith(COOKIE) && !/^[^=]+=;/.test(h)),
  };
}

async function addMembership(userId: string, tenantId: string) {
  const { error } = await getAdminClient().from("memberships").insert({ user_id: userId, tenant_id: tenantId, role: "receptionist" });
  expect(error).toBeNull();
}

// ---------------------------------------------------------------------------------------------------------------------

describe("L-N1: a slow but successful password change reports success", () => {
  it("PUT /user answered after 4.5 s (applied at once), after a 1.5 s breached-password check: ok, new password signs in", async () => {
    const owner = await seedTenantWithOwner(`Synthetic Close Pw ${randomUUID().slice(0, 6)}`);
    const s = await session(owner.userEmail);
    device(s, owner.tenantId);
    const newPassword = `N-${randomBytes(18).toString("base64url")}!7b`;
    const hits = slow.hits;
    const started = Date.now();
    const result = await withSlow("put-user", s.access_token, 4500, () =>
      changePassword(
        { currentPassword: seededUserPassword(), newPassword },
        { checkPwned: () => new Promise((resolve) => setTimeout(() => resolve("clear"), 1500)) },
      ),
    );
    const ms = Date.now() - started;
    expect(slow.hits - hits, "the PUT went through the slow answer").toBe(1);
    expect(result).toEqual({ ok: true, otherSessionsSignedOut: true });
    expect(ms, "the answer really came after the old 3.5 s budget").toBeGreaterThan(AUTH_REQUEST_BUDGET_MS + 1500);
    expect((await signIn(owner.userEmail, newPassword)).session, "the new password signs in").not.toBeNull();
    expect((await signIn(owner.userEmail)).status, "the old password no longer does").toBe(400);
  }, 30_000);
});

describe("L-N2: the proxy refreshes through a slow but working GoTrue", () => {
  it("the bounds: proxy hard stop + the route's budget stay under the client's status timeout", () => {
    expect(PROXY_AUTH_REQUEST_BUDGET_MS).toBeGreaterThan(AUTH_REQUEST_BUDGET_MS);
    expect(PROXY_AUTH_DEADLINE_MS + AUTH_REQUEST_BUDGET_MS).toBeLessThanOrEqual(STATUS_TIMEOUT_MS - 500);
  });

  it("a refresh answered after 4.5 s: signed in, the rotated session stored, no 'unavailable' mark, no /login", async () => {
    const owner = await seedTenantWithOwner(`Synthetic Close Slow ${randomUUID().slice(0, 6)}`);
    const s = await session(owner.userEmail);
    const hits = slow.hits;
    const p = await withSlow("refresh", s.refresh_token, 4500, () => throughProxy({ [COOKIE]: encode(expired(s)) }));
    expect(slow.hits - hits).toBe(1);
    expect(p.res.status).toBe(200);
    expect(p.res.headers.get("location")).toBeNull();
    expect(p.mark, "not marked unavailable").toBeNull();
    expect(p.ms).toBeGreaterThanOrEqual(4500);
    expect(p.authDeletions).toEqual([]);
    expect(p.authRefreshed, "the rotated session is sent to the browser").toBe(true);
  }, 30_000);

  it("a refresh that never answers ends at the proxy's bound; the route ends at its own; together < 10 s", async () => {
    const owner = await seedTenantWithOwner(`Synthetic Close Hang ${randomUUID().slice(0, 6)}`);
    const s = await session(owner.userEmail);
    const p = await withSlow("hang-refresh", s.refresh_token, 0, () => throughProxy({ [COOKIE]: encode(expired(s)) }));
    device(expired(s), owner.tenantId);
    const started = Date.now();
    const r = await withSlow("hang-refresh", s.refresh_token, 0, () => poll());
    const routeMs = Date.now() - started;
    expect(p.res.status).toBe(200);
    expect(p.mark).toBe("unavailable");
    expect(p.authDeletions).toEqual([]);
    expect(p.ms).toBeGreaterThanOrEqual(PROXY_AUTH_REQUEST_BUDGET_MS - 50);
    expect(p.ms).toBeLessThan(PROXY_AUTH_DEADLINE_MS + 500);
    expect(r.status).toBe(503);
    expect(routeMs).toBeLessThan(AUTH_REQUEST_BUDGET_MS + 750);
    expect(p.ms + routeMs).toBeLessThan(STATUS_TIMEOUT_MS);
  }, 30_000);
});

describe("L-N4: a definitive sign-out in the proxy expires the active-clinic pin", () => {
  it("the proxy's pin name is the request client's", () => {
    expect(PROXY_ACTIVE_TENANT_COOKIE).toBe(ACTIVE_TENANT_COOKIE);
  });

  it("revoked session (expired token, real GoTrue refusal): 307 /login, auth cookie and pin both expired", async () => {
    const owner = await seedTenantWithOwner(`Synthetic Close Revoked ${randomUUID().slice(0, 6)}`);
    const s = await session(owner.userEmail);
    expect((await getAdminClient().auth.admin.signOut(s.access_token, "global")).error).toBeNull();
    const p = await throughProxy({ [COOKIE]: encode(expired(s)), [ACTIVE]: owner.tenantId });
    expect(p.res.status).toBe(307);
    expect(new URL(p.res.headers.get("location") ?? "http://x/").pathname).toBe("/login");
    expect(p.authDeletions.length).toBeGreaterThan(0);
    expect(p.pinExpired).toBe(true);
    expect(p.pinWrites.find((h) => h.startsWith(`${ACTIVE}=;`))).toMatch(/Path=\//);
  });

  it("no session at all: a public page (/login) and a Server Action POST expire a leftover pin", async () => {
    const pin = randomUUID();
    const login = await throughProxy({ [ACTIVE]: pin }, "/login");
    expect(login.res.status).toBe(200);
    expect(login.pinExpired).toBe(true);
    const action = await throughProxy({ [ACTIVE]: pin }, "/patients", "POST");
    expect(action.res.status).toBe(200);
    expect(action.pinExpired).toBe(true);
    const none = await throughProxy({}, "/login");
    expect(none.pinWrites, "no pin, nothing written").toEqual([]);
  });

  it("V2-09d: a definitive sign-out also expires the session-context cookie; a signed-in request keeps it", async () => {
    expect(PROXY_CONTEXT_COOKIE).toBe(CONTEXT_COOKIE);
    const ctx = "e30.c2lnbmF0dXJl";
    const ctxExpired = (setCookies: string[]) => setCookies.some((h) => h.startsWith(`${CONTEXT_COOKIE}=;`) && /max-age=0/i.test(h));
    const login = await throughProxy({ [CONTEXT_COOKIE]: ctx }, "/login");
    expect(ctxExpired(login.setCookies)).toBe(true);
    const action = await throughProxy({ [CONTEXT_COOKIE]: ctx }, "/patients", "POST");
    expect(ctxExpired(action.setCookies)).toBe(true);
    const page = await throughProxy({ [CONTEXT_COOKIE]: ctx }, "/patients");
    expect(page.res.status).toBe(307);
    expect(ctxExpired(page.setCookies)).toBe(true);
    const owner = await seedTenantWithOwner(`Synthetic Close Ctx ${randomUUID().slice(0, 6)}`);
    const live = await throughProxy({ [COOKIE]: encode(await session(owner.userEmail)), [CONTEXT_COOKIE]: ctx });
    expect(live.res.status).toBe(200);
    expect(live.setCookies.filter((h) => h.startsWith(`${CONTEXT_COOKIE}=`))).toEqual([]);
  });

  it("09D-01a (S-5): the __Host- name is expired with Secure and Path=/", async () => {
    expect(PROXY_CONTEXT_COOKIE_SECURE).toBe(CONTEXT_COOKIE_SECURE);
    const login = await throughProxy({ [CONTEXT_COOKIE_SECURE]: "e30.c2lnbmF0dXJl" }, "/login");
    const set = login.setCookies.filter((h) => h.startsWith(`${CONTEXT_COOKIE_SECURE}=`));
    expect(set).toHaveLength(1);
    expect(set[0]).toMatch(/max-age=0/i);
    expect(set[0]).toMatch(/;\s*secure/i);
    expect(set[0]).toMatch(/path=\//i);
  });

  it("controls: a signed-in request and an Auth outage (a refresh that never answers) keep the pin", async () => {
    const owner = await seedTenantWithOwner(`Synthetic Close Keep ${randomUUID().slice(0, 6)}`);
    const s = await session(owner.userEmail);
    const live = await throughProxy({ [COOKIE]: encode(s), [ACTIVE]: owner.tenantId });
    expect(live.res.status).toBe(200);
    expect(live.pinWrites).toEqual([]);
    const outage = await withSlow("hang-refresh", s.refresh_token, 0, () => throughProxy({ [COOKIE]: encode(expired(s)), [ACTIVE]: owner.tenantId }));
    expect(outage.mark).toBe("unavailable");
    expect(outage.pinWrites).toEqual([]);
  }, 30_000);

  it("D5: device pinned to A, session revoked while closed; a user of B only then signs in on it → 200 (B), not 403", async () => {
    const tag = randomUUID().slice(0, 6);
    const a = await seedTenantWithOwner(`Synthetic Close Pin A ${tag}`);
    const b = await seedTenantWithOwner(`Synthetic Close Pin B ${tag}`);
    const first = await createUnlinkedUser();
    await addMembership(first.userId, a.tenantId);
    const firstSession = await session(first.userEmail);
    device(firstSession);
    const pinned = await poll();
    expect(pinned.status).toBe(200);
    applySetCookies(pinned.setCookies);
    expect(state.jar.get(ACTIVE)).toBe(a.tenantId);

    // "Sign out all devices" elsewhere (or a removal) while this device is closed; it opens with an expired token.
    expect((await getAdminClient().auth.admin.signOut(firstSession.access_token, "global")).error).toBeNull();
    const reopened = await throughProxy({ [COOKIE]: encode(expired(firstSession)), [ACTIVE]: state.jar.get(ACTIVE)! });
    expect(reopened.res.status).toBe(307);
    applySetCookies(reopened.setCookies);
    expect(state.jar.has(COOKIE), "signed out").toBe(false);
    expect(state.jar.has(ACTIVE), "the pin went with the session").toBe(false);

    // Another user (clinic B only) signs in on the same device.
    const second = await createUnlinkedUser();
    await addMembership(second.userId, b.tenantId);
    state.jar.set(COOKIE, encode(await session(second.userEmail)));
    const r = await poll();
    expect(r.status).toBe(200);
    expect(r.setCookies.find((h) => h.startsWith(`${ACTIVE}=`))).toContain(b.tenantId);
  });
});
