/**
 * V2-06 06-09d: the re-verifier's probes of 06-09c (reviews/v206c-review-reverify.md, 31 probes), rebuilt as a
 * regression spec. Everything is real except the injected Auth failures: real local GoTrue sessions in `@supabase/ssr`
 * cookies, the real `lib/supabase/server.ts` client (cookie jar behind a mocked `next/headers`), the real
 * `/api/session-status` route, `proxy()`, `resolveServiceContext()`, the `(dashboard)` layout and a `withPageAuth` page.
 * Failures are injected with a `globalThis.fetch` wrapper, only for the session under test (its refresh token on
 * `POST /auth/v1/token?grant_type=refresh_token`, its access token on `GET /auth/v1/user`).
 *
 * - H-AUTHOUT-R1 (High): an expired access token whose refresh answers 429 (or 408, 5xx, a network error, an abort, an
 *   uncoded 400, Kong's 404 or 401, an HTML 403, GoTrue's `no_authorization`) keeps the auth cookies in the route, the
 *   proxy and server actions; the route answers 503 on every poll; the proxy never sends a page to /login, forwards the
 *   request marked "auth unavailable" and answers no-store. Only a definitive GoTrue answer signs out (a real revoked
 *   session, a real malformed refresh token, a synthetic `refresh_token_not_found`).
 * - L-R1: `/user` answers classified by GoTrue's code (Kong's 401 "Invalid API key", its 404 and an uncoded 400 are
 *   503, not 401).
 * - L-R2: under the proxy's mark no handler refreshes again (no `/token` or `/user` request); the layout and a wrapped
 *   page (Today) throw `AuthUnavailableError` instead of redirecting to /login.
 * - L-R3: a refresh that hangs or keeps failing ends within the server budget; proxy + route stay inside the client's
 *   10 s status timeout (it used to take ~25 s per call).
 * - M-REMOVED-R1: with no active-clinic cookie the route pins the clinic it resolved (HttpOnly cookie), so "A only →
 *   added to B → removed from A" answers 403, not B's 200. The shell's clinic header is resolved like the cookie.
 * - L-R4: removed from the last clinic with the clinic pinned: the layout renders `MembershipEnded` (sign-out, purge),
 *   not `/clinic/new`; a new account without a clinic still goes to `/clinic/new`.
 *
 * Each case prints an `RV …` line (the re-verifier's format) so the before/after runs can be compared line by line.
 * Synthetic users and clinics only; tokens are compared, never printed.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { isValidElement, type ReactElement } from "react";
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
import { POST as signOutRoute } from "@/app/auth/signout/route";
import { proxy } from "@/proxy";
import DashboardLayout from "@/app/(dashboard)/layout";
import TodayPage from "@/app/(dashboard)/(today)/page";
import { resolveServiceContext } from "@/lib/auth/context";
import { AuthUnavailableError } from "@/lib/auth/tenant";
import { MembershipEnded } from "@/components/shell/membership-ended";
import { STATUS_TIMEOUT_MS } from "@/lib/pwa/session-status";
import { publicEnv } from "@/lib/env";
import { getAdminClient } from "../helpers/supabase-admin";
import { createUnlinkedUser, seedTenantWithOwner, seededUserPassword, type SeededTenant } from "../helpers/tenants";

const COOKIE = `sb-${new URL(publicEnv.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0]}-auth-token`;
const ACTIVE = "clinic_active_tenant";
const MARK = "x-clinicos-auth-state";
const SHELL = "x-clinicos-shell-clinic";
/** The server's Auth budget (3.5 s, `AUTH_REQUEST_BUDGET_MS`) plus scheduling slack. Literal: the spec also runs at the base commit. */
const SERVER_BOUND_MS = 5000;
/**
 * The proxy's bound: 06-09d close (re-check L-N2) raised its budget to 5.5 s (hard stop 5.75 s,
 * `PROXY_AUTH_DEADLINE_MS`) plus scheduling slack; proxy + route must still stay under the client's 10 s.
 */
const PROXY_BOUND_MS = 6500;
const NO_STORE = "private, no-cache, no-store, must-revalidate, max-age=0";

// ---------------------------------------------------------------------------------------------------------------------
// Fault injection (only the session under test; every other request goes to the local stack unchanged)
// ---------------------------------------------------------------------------------------------------------------------

type Mode =
  | "network"
  | "abort"
  | "503"
  | "500"
  | "520"
  | "429"
  | "408"
  | "400gw"
  | "404kong"
  | "401kong"
  | "403html"
  | "401noauth"
  | "hang"
  | "400rtnf";

const json = (status: number, body: unknown, goTrue = false) =>
  new Response(JSON.stringify(body), {
    status,
    headers: goTrue ? { "content-type": "application/json", "x-supabase-api-version": "2024-01-01" } : { "content-type": "application/json" },
  });
const html = (status: number) => new Response(`<html><body>${status}</body></html>`, { status, headers: { "content-type": "text/html" } });

function faultAnswer(mode: Mode, signal: AbortSignal | null | undefined): Promise<Response> | Response {
  switch (mode) {
    case "network":
      throw new TypeError("fetch failed");
    case "abort":
      throw new DOMException("This operation was aborted", "AbortError");
    case "503":
      return json(503, { message: "Service Unavailable" });
    case "500":
      return json(500, { code: "unexpected_failure", message: "Unexpected failure" }, true);
    case "520":
      return html(520);
    case "429":
      return json(429, { code: "over_request_rate_limit", message: "Request rate limit reached" }, true);
    case "408":
      return json(408, { message: "Request Timeout" });
    case "400gw":
      return json(400, { message: "Bad Request" });
    case "404kong":
      return json(404, { message: "no Route matched with those values" });
    case "401kong":
      return json(401, { message: "Invalid API key" });
    case "403html":
      return html(403);
    case "401noauth":
      return json(401, { code: "no_authorization", message: "This endpoint requires a valid Bearer token" }, true);
    case "400rtnf":
      return json(400, { code: "refresh_token_not_found", message: "Invalid Refresh Token: Refresh Token Not Found" }, true);
    case "hang":
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new DOMException("This operation was aborted", "AbortError")), { once: true });
      });
  }
}

const fault = { target: null as null | "refresh" | "user" | "logout", mode: "503" as Mode, token: "", hits: 0, refreshCalls: 0, userCalls: 0 };
const realFetch = globalThis.fetch;

function bodyText(init: RequestInit | undefined): string {
  return typeof init?.body === "string" ? init.body : "";
}

beforeAll(() => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const isRefresh = url.pathname.endsWith("/auth/v1/token") && url.searchParams.get("grant_type") === "refresh_token";
    const isUser = url.pathname.endsWith("/auth/v1/user") && (init?.method ?? "GET") === "GET";
    const auth = new Headers(init?.headers).get("authorization") ?? "";
    if (isRefresh && fault.token && bodyText(init).includes(fault.token)) fault.refreshCalls += 1;
    if (isUser && fault.token && auth === `Bearer ${fault.token}`) fault.userCalls += 1;
    const isLogout = url.pathname.endsWith("/auth/v1/logout");
    const hit =
      (fault.target === "refresh" && isRefresh && bodyText(init).includes(fault.token)) ||
      (fault.target === "user" && isUser && auth === `Bearer ${fault.token}`) ||
      (fault.target === "logout" && isLogout && auth === `Bearer ${fault.token}`);
    if (hit) {
      fault.hits += 1;
      return faultAnswer(fault.mode, init?.signal);
    }
    return realFetch(input, init);
  }) as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

// ---------------------------------------------------------------------------------------------------------------------
// Sessions, the jar, the route, the proxy
// ---------------------------------------------------------------------------------------------------------------------

async function signIn(email: string): Promise<Session> {
  const client = createJsClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password: seededUserPassword() });
  if (error || !data.session) throw new Error(`sign-in failed: ${error?.status ?? "no session"}`);
  return data.session;
}

const encode = (session: Session) => `base64-${Buffer.from(JSON.stringify(session), "utf8").toString("base64url")}`;
const expired = (session: Session): Session => ({ ...session, expires_at: Math.floor(Date.now() / 1000) - 120, expires_in: -120 });

/** A device: the jar holds this session (and optionally a pinned clinic); no request headers. */
function device(session: Session, activeClinic?: string) {
  state.jar = new Map([[COOKIE, encode(session)]]);
  if (activeClinic) state.jar.set(ACTIVE, activeClinic);
  state.writes = [];
  state.requestHeaders = {};
}

const authDeletionsInJar = () => state.writes.filter((w) => w.name.startsWith(COOKIE) && (w.value === "" || w.options?.maxAge === 0));

async function poll(headers: Record<string, string> = {}) {
  const res = await GET(new NextRequest("http://localhost/api/session-status", { headers }));
  return { status: res.status, body: (await res.json()) as unknown, setCookies: res.headers.getSetCookie() };
}

/** Applies the route's Set-Cookie (the pin) to the jar, as the browser would. */
function applySetCookies(setCookies: string[]) {
  for (const header of setCookies) {
    const [pair] = header.split(";");
    const eq = pair.indexOf("=");
    const name = pair.slice(0, eq).trim();
    const value = decodeURIComponent(pair.slice(eq + 1));
    if (value === "" || /max-age=0/i.test(header)) state.jar.delete(name);
    else state.jar.set(name, value);
  }
}

async function throughProxy(cookieValue: string, path = "/patients", extra: Record<string, string> = {}) {
  const headers = new Headers(extra);
  headers.set("cookie", `${COOKIE}=${cookieValue}`);
  const started = Date.now();
  const res = await proxy(new NextRequest(`http://localhost${path}`, { headers }));
  const deletions = res.headers.getSetCookie().filter((h) => h.startsWith(`${COOKIE}`) && /^[^=]+=;/.test(h));
  return { res, ms: Date.now() - started, deletions, mark: res.headers.get(`x-middleware-request-${MARK}`) };
}

function rv(line: string) {
  process.stdout.write(`RV ${line}\n`);
}

function digestOf(err: unknown): string {
  const digest = (err as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" ? digest : "";
}

async function settle<T>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; err: unknown }> {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    return { ok: false, err };
  }
}

function withFault<T>(target: "refresh" | "user" | "logout", mode: Mode, token: string, fn: () => Promise<T>): Promise<T> {
  fault.target = target;
  fault.mode = mode;
  fault.token = token;
  return fn().finally(() => {
    fault.target = null;
  });
}

// ---------------------------------------------------------------------------------------------------------------------

const NOT_DEFINITIVE: Mode[] = ["network", "abort", "503", "500", "520", "429", "408", "400gw", "404kong", "401kong", "403html", "401noauth"];

describe("H-AUTHOUT-R1: expired access token, the refresh fails without a definitive answer", () => {
  let owner: SeededTenant;
  let session: Session;

  beforeAll(async () => {
    owner = await seedTenantWithOwner(`Synthetic RV Refresh ${randomUUID().slice(0, 6)}`);
    session = await signIn(owner.userEmail);
  });

  it("tracer: an expired session with Auth answering is refreshed (route 200, proxy refreshes the cookie)", async () => {
    device(expired(session), owner.tenantId);
    const r = await poll();
    expect(r.status).toBe(200);
    expect(state.jar.get(COOKIE), "the route stored the rotated session").not.toBe(encode(expired(session)));
    session = await signIn(owner.userEmail);
  });

  it.each(NOT_DEFINITIVE)("refresh answers %s: the route answers 503 twice and keeps the cookies", async (mode) => {
    device(expired(session), owner.tenantId);
    const before = state.jar.get(COOKIE);
    const hits = fault.hits;
    const started = Date.now();
    const [first, second] = await withFault("refresh", mode, session.refresh_token, async () => [await poll(), await poll()]);
    const ms = Date.now() - started;
    const kept = state.jar.get(COOKIE) === before;
    rv(`route token=${mode} -> first ${first.status} cookieKept=${kept}; next poll ${second.status} ${JSON.stringify(second.body)} (${ms} ms for two polls)`);
    expect(fault.hits, "the refresh reached the failing transport").toBeGreaterThan(hits);
    expect(first.status).toBe(503);
    expect(second.status).toBe(503);
    expect(second.body).toEqual({ error: "unavailable" });
    expect(authDeletionsInJar(), "no auth cookie deletion").toEqual([]);
    expect(kept).toBe(true);
  });

  it.each(NOT_DEFINITIVE)("refresh answers %s: the proxy keeps the cookies, never redirects to /login, marks the request", async (mode) => {
    const { res, deletions, mark, ms } = await withFault("refresh", mode, session.refresh_token, () => throughProxy(encode(expired(session))));
    rv(`proxy token=${mode} -> ${res.status} ${res.headers.get("location") ?? "next"} authCookieDeletions=${deletions.length} mark=${mark} (${ms} ms)`);
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
    expect(deletions).toEqual([]);
    expect(res.headers.getSetCookie().filter((h) => h.startsWith(COOKIE))).toEqual([]);
    expect(mark).toBe("unavailable");
    expect(res.headers.get("cache-control")).toBe(NO_STORE);
  });

  it("server actions: a 429 on the refresh is 'unavailable' (never 'unauthenticated') and keeps the cookies", async () => {
    device(expired(session), owner.tenantId);
    const r = await withFault("refresh", "429", session.refresh_token, () => resolveServiceContext("patients:view"));
    rv(`action token=429 -> ${JSON.stringify(r.ok ? { ok: true } : { reason: r.reason })} authCookieDeletions=${authDeletionsInJar().length}`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).not.toBe("unauthenticated");
    expect(authDeletionsInJar()).toEqual([]);
  });

  it("L-R3: a refresh that never answers, or keeps failing, ends inside the budget; proxy + route < the client's 10 s", async () => {
    for (const mode of ["hang", "network", "503"] as const) {
      const p = await withFault("refresh", mode, session.refresh_token, () => throughProxy(encode(expired(session))));
      device(expired(session), owner.tenantId);
      const started = Date.now();
      const r = await withFault("refresh", mode, session.refresh_token, () => poll());
      const routeMs = Date.now() - started;
      rv(`timing token=${mode} -> proxy ${p.ms} ms (${p.res.status}), route ${routeMs} ms (${r.status})`);
      expect(p.res.status).toBe(200);
      expect(r.status).toBe(503);
      expect(p.ms).toBeLessThan(PROXY_BOUND_MS);
      expect(routeMs).toBeLessThan(SERVER_BOUND_MS);
      expect(p.ms + routeMs).toBeLessThan(STATUS_TIMEOUT_MS);
    }
  }, 120_000);

  it("L-R2: under the proxy's mark nothing refreshes again; the layout and Today throw AuthUnavailableError (no /login)", async () => {
    device(expired(session), owner.tenantId);
    state.requestHeaders = { [MARK]: "unavailable" };
    fault.token = session.refresh_token;
    const refreshes = fault.refreshCalls;
    const r = await poll();
    const layout = await settle(() => DashboardLayout({ children: null }));
    const today = await settle(() => (TodayPage as () => Promise<unknown>)());
    const sent = fault.refreshCalls - refreshes;
    rv(`marked request -> route ${r.status}; layout ${layout.ok ? "rendered" : (layout.err as Error).name} ${digestOf(layout.ok ? null : layout.err)}; today ${today.ok ? "rendered" : (today.err as Error).name} ${digestOf(today.ok ? null : today.err)}; refreshes sent=${sent}`);
    expect(r.status).toBe(503);
    expect(sent, "no second refresh under the mark").toBe(0);
    expect(layout.ok).toBe(false);
    if (!layout.ok) expect(layout.err).toBeInstanceOf(AuthUnavailableError);
    expect(today.ok).toBe(false);
    if (!today.ok) {
      expect(today.err).toBeInstanceOf(AuthUnavailableError);
      expect(digestOf(today.err)).not.toMatch(/\/login/);
    }
    expect(authDeletionsInJar()).toEqual([]);
  });

  it("the proxy removes an inbound mark (only the proxy sets it)", async () => {
    const { res, mark } = await throughProxy(encode(session), "/patients", { [MARK]: "unavailable" });
    expect(res.status).toBe(200);
    expect(mark).toBeNull();
    expect(res.headers.get("x-middleware-override-headers") ?? "").not.toContain(MARK);
  });
});

describe("H-AUTHOUT-R1 controls: a definitive answer still signs out (no fail-open)", () => {
  it("synthetic GoTrue refresh_token_not_found: route 401 and the cookie deleted; proxy /login and the cookie deleted", async () => {
    const owner = await seedTenantWithOwner(`Synthetic RV Rtnf ${randomUUID().slice(0, 6)}`);
    const session = await signIn(owner.userEmail);
    device(expired(session), owner.tenantId);
    const r = await withFault("refresh", "400rtnf", session.refresh_token, () => poll());
    const p = await withFault("refresh", "400rtnf", session.refresh_token, () => throughProxy(encode(expired(session))));
    rv(`definitive token=400rtnf -> route ${r.status} jarCookie=${state.jar.has(COOKIE)}; proxy ${p.res.status} ${p.res.headers.get("location")} deletions=${p.deletions.length}`);
    expect(r.status).toBe(401);
    expect(state.jar.has(COOKIE)).toBe(false);
    expect(p.res.status).toBe(307);
    expect(new URL(p.res.headers.get("location") ?? "http://x/").pathname).toBe("/login");
    expect(p.deletions.length).toBeGreaterThan(0);
  });

  it("a session revoked for real (admin global sign-out): expired → route 401 + deleted, proxy /login + deleted; unexpired → route 401", async () => {
    const owner = await seedTenantWithOwner(`Synthetic RV Revoked ${randomUUID().slice(0, 6)}`);
    const session = await signIn(owner.userEmail);
    const { error } = await getAdminClient().auth.admin.signOut(session.access_token, "global");
    expect(error).toBeNull();
    device(session, owner.tenantId);
    const live = await poll();
    device(expired(session), owner.tenantId);
    const r = await poll();
    const p = await throughProxy(encode(expired(session)));
    rv(`revoked -> unexpired route ${live.status}; expired route ${r.status} jarCookie=${state.jar.has(COOKIE)}; proxy ${p.res.status} deletions=${p.deletions.length}`);
    expect(live.status).toBe(401);
    expect(r.status).toBe(401);
    expect(state.jar.has(COOKIE)).toBe(false);
    expect(p.res.status).toBe(307);
    expect(p.deletions.length).toBeGreaterThan(0);
  });

  it("a malformed refresh token (real GoTrue validation_failed) signs out", async () => {
    const owner = await seedTenantWithOwner(`Synthetic RV Malformed ${randomUUID().slice(0, 6)}`);
    const session = await signIn(owner.userEmail);
    const p = await throughProxy(encode({ ...expired(session), refresh_token: "notarealrefreshtoken" }));
    expect(p.res.status).toBe(307);
    expect(p.deletions.length).toBeGreaterThan(0);
  });
});

describe("L-R1: /user answers are classified by GoTrue's code (unexpired token)", () => {
  let owner: SeededTenant;
  let session: Session;

  beforeAll(async () => {
    owner = await seedTenantWithOwner(`Synthetic RV User ${randomUUID().slice(0, 6)}`);
    session = await signIn(owner.userEmail);
  });

  it("tracer: /user ok → 200", async () => {
    device(session, owner.tenantId);
    const r = await poll();
    rv(`user=ok -> ${r.status} ${JSON.stringify(r.body)} sessionCookieKept=${state.jar.has(COOKIE)}`);
    expect(r.status).toBe(200);
  });

  it.each(NOT_DEFINITIVE)("/user answers %s → 503, cookies kept", async (mode) => {
    device(session, owner.tenantId);
    const r = await withFault("user", mode, session.access_token, () => poll());
    rv(`user=${mode} -> ${r.status} ${JSON.stringify(r.body)} sessionCookieKept=${state.jar.has(COOKIE)}`);
    expect(r.status).toBe(503);
    expect(r.body).toEqual({ error: "unavailable" });
    expect(authDeletionsInJar()).toEqual([]);
  });

  it("under the proxy's mark the route does not call /user at all", async () => {
    device(session, owner.tenantId);
    state.requestHeaders = { [MARK]: "unavailable" };
    fault.token = session.access_token;
    const calls = fault.userCalls;
    const r = await poll();
    expect(r.status).toBe(503);
    expect(fault.userCalls - calls).toBe(0);
  });
});

describe("06-09d: signing out during an Auth incident still signs this device out", () => {
  it.each(["404kong", "401kong", "503", "429"] as const)("/logout answers %s: the auth cookies are deleted all the same", async (mode) => {
    const owner = await seedTenantWithOwner(`Synthetic RV Signout ${randomUUID().slice(0, 6)}`);
    const session = await signIn(owner.userEmail);
    device(session, owner.tenantId);
    const res = await withFault("logout", mode, session.access_token, () =>
      signOutRoute(new NextRequest("http://localhost/auth/signout", { method: "POST", headers: { "sec-fetch-site": "same-origin", "x-clinicos-signout": "fetch" } })),
    );
    rv(`signout logout=${mode} -> ${res.status} authCookieLeft=${state.jar.has(COOKIE)}`);
    expect(fault.hits).toBeGreaterThan(0);
    expect(state.jar.has(COOKIE), "this device is signed out").toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// M-REMOVED-R1 and L-R4
// ---------------------------------------------------------------------------------------------------------------------

async function setMembership(userId: string, tenantId: string, status: "removed" | "suspended" | "active") {
  const { error } = await getAdminClient()
    .from("memberships")
    .update({ status, removed_at: status === "removed" ? new Date().toISOString() : null })
    .eq("tenant_id", tenantId)
    .eq("user_id", userId);
  expect(error).toBeNull();
}

async function addMembership(userId: string, tenantId: string) {
  const { error } = await getAdminClient().from("memberships").insert({ user_id: userId, tenant_id: tenantId, role: "receptionist" });
  expect(error).toBeNull();
}

/** A receptionist of a new clinic A only (a real user and session), plus a second clinic B. */
async function receptionistOfA() {
  const tag = randomUUID().slice(0, 6);
  const a = await seedTenantWithOwner(`Synthetic RV Pin A ${tag}`);
  const b = await seedTenantWithOwner(`Synthetic RV Pin B ${tag}`);
  const user = await createUnlinkedUser();
  await addMembership(user.userId, a.tenantId);
  const session = await signIn(user.userEmail);
  return { a, b, userId: user.userId, session };
}

function shellClinicOf(element: unknown): unknown {
  // <ClinicTimeZoneProvider><AppShell …/></ClinicTimeZoneProvider>
  if (!isValidElement(element)) return undefined;
  const child = (element as ReactElement<{ children?: unknown }>).props.children;
  return isValidElement(child) ? (child as ReactElement<{ shellClinic?: unknown }>).props.shellClinic : undefined;
}

describe("M-REMOVED-R1: the device is pinned to the clinic it resolved", () => {
  it("R3 cookie-less: A only (poll pins A) → added to B → removed from A → 403, never B's 200", async () => {
    const { a, b, userId, session } = await receptionistOfA();
    device(session);
    const first = await poll();
    const pin = first.setCookies.find((h) => h.startsWith(`${ACTIVE}=`)) ?? "";
    applySetCookies(first.setCookies);
    await addMembership(userId, b.tenantId);
    const afterAdd = await poll();
    await setMembership(userId, a.tenantId, "removed");
    const afterRemove = await poll();
    const action = await resolveServiceContext("patients:view");
    rv(`R3 A-only ${first.status} pin=${pin ? "set" : "none"}; +B ${afterAdd.status} ${JSON.stringify(afterAdd.body)}; -A ${afterRemove.status} ${JSON.stringify(afterRemove.body)}; action ${action.ok ? `tenant=${action.ctx.tenantId === b.tenantId ? "B" : "A"}` : action.reason}`);
    expect(first.status).toBe(200);
    expect(pin).toContain(`${ACTIVE}=${a.tenantId}`);
    expect(pin).toMatch(/HttpOnly/i);
    expect(pin).toMatch(/SameSite=lax/i);
    expect(pin).toMatch(/Path=\//);
    expect(afterAdd.status).toBe(200);
    expect(afterRemove.status).toBe(403);
    expect(afterRemove.body).toEqual({ error: "no_membership" });
    expect(action.ok).toBe(false);
    if (!action.ok) expect(action.reason).toBe("no_membership");
  });

  it("the pin is written only when none is set; a dual member without one is not pinned (409)", async () => {
    const { a, b, userId, session } = await receptionistOfA();
    device(session, a.tenantId);
    expect((await poll()).setCookies.filter((h) => h.startsWith(`${ACTIVE}=`))).toEqual([]);
    await addMembership(userId, b.tenantId);
    device(session);
    const dual = await poll();
    expect(dual.status).toBe(409);
    expect(dual.setCookies.filter((h) => h.startsWith(`${ACTIVE}=`))).toEqual([]);
  });

  it("the shell's clinic header is resolved like the cookie: its own clinic is pinned, another clinic answers 403, a set cookie wins", async () => {
    const { a, b, userId, session } = await receptionistOfA();
    await addMembership(userId, b.tenantId);
    device(session);
    const own = await poll({ [SHELL]: a.tenantId });
    expect(own.status).toBe(200);
    expect(own.setCookies.find((h) => h.startsWith(`${ACTIVE}=`))).toContain(a.tenantId);
    const foreign = (await seedTenantWithOwner(`Synthetic RV Foreign ${randomUUID().slice(0, 6)}`)).tenantId;
    device(session);
    expect((await poll({ [SHELL]: foreign })).status).toBe(403);
    device(session, b.tenantId);
    const pinned = await poll({ [SHELL]: foreign });
    expect(pinned.status, "a pinned device ignores the header").toBe(200);
    device(session);
    expect((await poll({ [SHELL]: "not-a-clinic" })).status, "junk is ignored (two clinics, none chosen)").toBe(409);
  });

  it("the layout hands the shell its clinic while none is pinned, and nothing once pinned", async () => {
    const { a, session } = await receptionistOfA();
    device(session);
    expect(shellClinicOf(await DashboardLayout({ children: null }))).toBe(a.tenantId);
    device(session, a.tenantId);
    expect(shellClinicOf(await DashboardLayout({ children: null }))).toBeNull();
  });

  it("R1/R2 (06-09c) still hold: cookie = A, removed from (or suspended in) A with B left → 403", async () => {
    for (const status of ["removed", "suspended"] as const) {
      const { a, b, userId, session } = await receptionistOfA();
      await addMembership(userId, b.tenantId);
      device(session, a.tenantId);
      expect((await poll()).status).toBe(200);
      await setMembership(userId, a.tenantId, status);
      const r = await poll();
      rv(`R1/R2 ${status} -> ${r.status}`);
      expect(r.status).toBe(403);
    }
  });
});

describe("L-R4: removed from the last clinic", () => {
  it("with the clinic pinned: the layout renders MembershipEnded (sign-out, purge), the route 403", async () => {
    const { a, userId, session } = await receptionistOfA();
    device(session);
    applySetCookies((await poll()).setCookies);
    expect(state.jar.get(ACTIVE)).toBe(a.tenantId);
    await setMembership(userId, a.tenantId, "removed");
    const layout = await settle(() => DashboardLayout({ children: null }));
    const r = await poll();
    const shown = layout.ok && isValidElement(layout.value) ? (layout.value as ReactElement).type : digestOf(layout.ok ? null : layout.err);
    rv(`R6 last clinic removed (pinned) -> layout ${shown === MembershipEnded ? "MembershipEnded" : String(shown)}; route ${r.status}`);
    expect(layout.ok).toBe(true);
    if (layout.ok) expect(isValidElement(layout.value) && (layout.value as ReactElement).type).toBe(MembershipEnded);
    expect(r.status).toBe(403);
  });

  it("a new account without a clinic (no pinned clinic) still goes to /clinic/new", async () => {
    const user = await createUnlinkedUser();
    device(await signIn(user.userEmail));
    const layout = await settle(() => DashboardLayout({ children: null }));
    expect(layout.ok).toBe(false);
    if (!layout.ok) expect(digestOf(layout.err)).toMatch(/\/clinic\/new/);
  });
});
