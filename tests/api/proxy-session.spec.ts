/**
 * V2-03 03-06 (P2-01, AUTH_REDESIGN §4.2): the Next 16 `proxy` refreshes the Supabase session with `@supabase/ssr`
 * 0.12 against the local stack.
 *
 * - An expired session is refreshed through `getClaims()`: the response the proxy returns is the one `setAll` built,
 *   so it carries the new auth cookie, forwards the refreshed cookie to the request (Server Components see the new
 *   token), and carries the no-store cache headers 0.12 hands to `setAll` (a response with auth cookies must never be
 *   cached and served to another user).
 * - A valid session and a signed-out request for a public page are passed through untouched: no cookie, no cache
 *   headers.
 * - 03-12b (OA-5, R-28): a signed-out GET for a protected page is a 307 to `/login?next=<path + query>` with the
 *   request id; a session the proxy cannot refresh (revoked refresh token) is signed out the same way, and the
 *   redirect deletes its stale auth cookie. `/api` and non-GET requests are not redirected.
 *
 * - 03-13a (H-AUTH, A00-5): a session established with an emailed code (here a real recovery session from the local
 *   GoTrue + Mailpit) older than 600 s is ended by the proxy BEFORE any page, Server Action or route handler runs: it
 *   is revoked at GoTrue (the direct `PUT /auth/v1/user` with its access token is then refused and its refresh token
 *   is dead), its cookies are deleted in the browser and removed from the forwarded request, and a page GET goes to
 *   `/login`. The age is reached with a fake `Date` in this spec only (the JWT's `exp` is 900 s, so at +601 s it still
 *   verifies); nothing in `proxy.ts` takes a clock or a test switch. Fresh recovery sessions and old password
 *   sessions pass.
 *
 * Synthetic users only; tokens are compared, never printed.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { Session } from "@supabase/supabase-js";
import { proxy } from "@/proxy";
import { publicEnv } from "@/lib/env";
import { createUnlinkedUser, seededUserPassword } from "../helpers/tenants";
import { browserLikeClient, canSignIn, recoverySession, syntheticPassword, type BrowserLikeClient } from "../helpers/auth-flows";

/** `@supabase/ssr`'s default storage key: `sb-<first host label>-auth-token`. */
const COOKIE = `sb-${new URL(publicEnv.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0]}-auth-token`;

function encodeSession(session: Session): string {
  return `base64-${Buffer.from(JSON.stringify(session), "utf8").toString("base64url")}`;
}

function decodeSession(value: string): Session {
  expect(value.startsWith("base64-")).toBe(true);
  return JSON.parse(Buffer.from(value.slice("base64-".length), "base64url").toString("utf8")) as Session;
}

/** Joins the auth cookie (single or chunked `.0`, `.1`, …) from `Set-Cookie` headers, ignoring deletions. */
function authCookieFromSetCookie(response: Response): string | null {
  const parts = new Map<string, string>();
  for (const header of response.headers.getSetCookie()) {
    const [pair] = header.split(";");
    const eq = pair.indexOf("=");
    const name = pair.slice(0, eq).trim();
    const value = decodeURIComponent(pair.slice(eq + 1));
    if ((name === COOKIE || name.startsWith(`${COOKIE}.`)) && value) parts.set(name, value);
  }
  if (parts.has(COOKIE)) return parts.get(COOKIE)!;
  const chunks: string[] = [];
  for (let i = 0; parts.has(`${COOKIE}.${i}`); i++) chunks.push(parts.get(`${COOKIE}.${i}`)!);
  return chunks.length ? chunks.join("") : null;
}

function requestWith(session: Session | null, path = "/today"): NextRequest {
  const headers = new Headers();
  if (session) headers.set("cookie", `${COOKIE}=${encodeSession(session)}`);
  return new NextRequest(`http://localhost${path}`, { headers });
}

let session: Session;

beforeAll(async () => {
  const user = await createUnlinkedUser();
  const { data, error } = await user.client.auth.getSession();
  if (error || !data.session) throw new Error(`no session for the synthetic user: ${error?.message ?? "none"}`);
  session = data.session;
});

describe("03-06 proxy session refresh (@supabase/ssr 0.12, getClaims)", () => {
  it("passes a signed-out request for a public page through with no cookie and no cache headers", async () => {
    const res = await proxy(requestWith(null, "/login"));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-middleware-next")).toBe("1");
    expect(res.headers.getSetCookie()).toEqual([]);
    expect(res.headers.get("cache-control")).toBeNull();
  });

  it("03-12b: redirects a signed-out GET for a protected page to /login with next (path + query)", async () => {
    for (const method of ["GET", "HEAD"]) {
      const res = await proxy(new NextRequest("http://localhost/patients/abc?tab=visits", { method }));
      expect(res.status, method).toBe(307);
      const location = new URL(res.headers.get("location") ?? "");
      expect(location.origin).toBe("http://localhost");
      expect(location.pathname).toBe("/login");
      expect(location.searchParams.get("next")).toBe("/patients/abc?tab=visits");
      expect(res.headers.get("x-middleware-next")).toBeNull();
      expect(res.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
      expect(res.headers.getSetCookie()).toEqual([]);
    }
  });

  it("03-12b: /api and non-GET page requests (Server Actions) are not redirected", async () => {
    expect((await proxy(requestWith(null, "/api/patients/abc/export"))).status).toBe(200);
    const action = await proxy(new NextRequest("http://localhost/patients", { method: "POST", headers: { "next-action": "x" } }));
    expect(action.status).toBe(200);
    expect(action.headers.get("x-middleware-next")).toBe("1");
  });

  it("03-12b: a session that cannot be refreshed is redirected and its stale auth cookie deleted", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const revoked: Session = { ...session, expires_at: nowSec - 60, expires_in: -60, refresh_token: "notarealrefreshtoken" };
    const res = await proxy(requestWith(revoked, "/queue"));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location") ?? "").searchParams.get("next")).toBe("/queue");
    const deletions = res.headers.getSetCookie().filter((h) => h.startsWith(`${COOKIE}=`) || h.startsWith(`${COOKIE}.`));
    expect(deletions.length, "the redirect deletes the stale auth cookie").toBeGreaterThan(0);
    for (const h of deletions) expect(h.split(";")[0].split("=")[1]).toBe("");
  });

  it("does not rewrite cookies for a session that is still valid", async () => {
    const res = await proxy(requestWith(session));
    expect(res.status).toBe(200);
    expect(authCookieFromSetCookie(res)).toBeNull();
    // V2-06 06-05 (PWA D-4): a signed-in page response is always private/no-store (tests/pwa/proxy-no-store-db.spec.ts).
    expect(res.headers.get("cache-control")).toBe("private, no-cache, no-store, must-revalidate, max-age=0");
  });

  it("refreshes an expired session and returns the response setAll built (cookie + no-store headers)", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const expired: Session = { ...session, expires_at: nowSec - 60, expires_in: -60 };

    const res = await proxy(requestWith(expired));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-middleware-next")).toBe("1");

    // The browser gets the refreshed session.
    const cookie = authCookieFromSetCookie(res);
    expect(cookie, "the proxy response sets the refreshed auth cookie").not.toBeNull();
    const refreshed = decodeSession(cookie!);
    expect(refreshed.access_token === session.access_token).toBe(false);
    expect(refreshed.refresh_token === session.refresh_token).toBe(false);
    expect(refreshed.expires_at ?? 0).toBeGreaterThan(nowSec);
    expect(refreshed.user?.id).toBe(session.user.id);

    // Server Components on this request read the refreshed cookie (request headers forwarded by NextResponse.next).
    const forwardedCookie = res.headers.get("x-middleware-request-cookie") ?? "";
    expect(forwardedCookie.includes(encodeSession(session))).toBe(false);
    expect(forwardedCookie.includes(`${COOKIE}`)).toBe(true);

    // 0.12's cache headers reach the response (never cached by a CDN or proxy).
    const cacheControl = res.headers.get("cache-control") ?? "";
    expect(cacheControl).toContain("private");
    expect(cacheControl).toContain("no-store");
    expect(res.headers.get("expires")).toBe("0");
    expect(res.headers.get("pragma")).toBe("no-cache");
  });
});

/** `PUT /auth/v1/user {password}` straight at GoTrue with `accessToken`: the H-AUTH bypass of the app's checks. */
async function directPasswordChange(accessToken: string): Promise<{ status: number; code: string | null }> {
  const res = await fetch(`${publicEnv.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/user`, {
    method: "PUT",
    headers: {
      apikey: publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ password: syntheticPassword() }),
  });
  const body = (await res.json().catch(() => null)) as { error_code?: unknown; code?: unknown } | null;
  const code = typeof body?.error_code === "string" ? body.error_code : typeof body?.code === "string" ? body.code : null;
  return { status: res.status, code: res.ok ? null : code };
}

/** The error code GoTrue answers to a refresh with `refreshToken` (null when the refresh worked). */
async function refreshCode(refreshToken: string): Promise<string | null> {
  const { data, error } = await browserLikeClient().client.auth.refreshSession({ refresh_token: refreshToken });
  return data.session ? null : (error?.code ?? "no_session");
}

async function sessionOf(client: BrowserLikeClient): Promise<Session> {
  const { data } = await client.auth.getSession();
  if (!data.session) throw new Error("no session");
  return data.session;
}

/** Auth cookies the response deletes (`Set-Cookie` with an empty value). */
function deletedAuthCookies(res: Response): string[] {
  return res.headers
    .getSetCookie()
    .filter((h) => h.startsWith(`${COOKIE}=`) || h.startsWith(`${COOKIE}.`))
    .filter((h) => h.split(";")[0].split("=")[1] === "")
    .map((h) => h.split("=")[0]);
}

function cookieHeader(sessionValue: Session): Record<string, string> {
  return { cookie: `${COOKIE}=${encodeSession(sessionValue)}` };
}

const STALE_MS = 601_000;

describe("03-13a H-AUTH: the proxy ends an emailed-code session older than 600 s", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("a recovery session aged 601 s: page GET → revoked at GoTrue, cookies deleted, /login; direct PUT /auth/v1/user then refused", async () => {
    const user = await createUnlinkedUser();
    const recovery = await sessionOf(await recoverySession(user.userEmail));
    expect(recovery.user.id).toBe(user.userId);

    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + STALE_MS });
    const res = await proxy(requestWith(recovery, "/patients?tab=visits"));
    vi.useRealTimers();

    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/patients?tab=visits");
    expect(res.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(deletedAuthCookies(res).length, "the browser's session cookie is deleted").toBeGreaterThan(0);
    expect(res.headers.get("cache-control") ?? "").toContain("no-store");

    // The session is dead at GoTrue, so the stolen-token bypass (PUT /user straight at GoTrue) no longer works.
    const direct = await directPasswordChange(recovery.access_token);
    expect(direct.status, "GoTrue refuses the ended session's access token").not.toBe(200);
    expect([401, 403]).toContain(direct.status);
    expect(await refreshCode(recovery.refresh_token), "its refresh token is revoked").toBe("refresh_token_not_found");
    // The password is unchanged.
    expect(await canSignIn(user.userEmail, seededUserPassword())).toBe(true);
  });

  it("a Server Action POST and an /api call on a stale recovery session run signed out (no auth cookie forwarded)", async () => {
    for (const path of ["/patients", "/api/patients/abc/export"]) {
      const user = await createUnlinkedUser();
      const recovery = await sessionOf(await recoverySession(user.userEmail));
      vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + STALE_MS });
      const res = await proxy(
        new NextRequest(`http://localhost${path}`, {
          method: path === "/patients" ? "POST" : "GET",
          headers: { ...cookieHeader(recovery), ...(path === "/patients" ? { "next-action": "x" } : {}) },
        }),
      );
      vi.useRealTimers();
      expect(res.status, path).toBe(200);
      expect(res.headers.get("x-middleware-next")).toBe("1");
      const forwarded = res.headers.get("x-middleware-request-cookie") ?? "";
      expect(forwarded.includes(COOKIE), `${path}: no auth cookie reaches the handler`).toBe(false);
      expect(deletedAuthCookies(res).length).toBeGreaterThan(0);
      expect((await directPasswordChange(recovery.access_token)).status).not.toBe(200);
      expect(await refreshCode(recovery.refresh_token)).toBe("refresh_token_not_found");
    }
  });

  it("a fresh recovery session (inside 600 s) and a password session of any age pass untouched", async () => {
    const user = await createUnlinkedUser();
    const recovery = await sessionOf(await recoverySession(user.userEmail));
    const fresh = await proxy(requestWith(recovery, "/patients"));
    expect(fresh.status).toBe(200);
    expect(deletedAuthCookies(fresh)).toEqual([]);

    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + STALE_MS });
    const old = await proxy(requestWith(session, "/patients"));
    vi.useRealTimers();
    expect(old.status).toBe(200);
    expect(old.headers.get("x-middleware-next")).toBe("1");
    expect(deletedAuthCookies(old)).toEqual([]);
  });
});
