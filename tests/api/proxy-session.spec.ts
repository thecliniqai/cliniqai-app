/**
 * V2-03 03-06 (P2-01, AUTH_REDESIGN §4.2): the Next 16 `proxy` refreshes the Supabase session with `@supabase/ssr`
 * 0.12 against the local stack.
 *
 * - An expired session is refreshed through `getClaims()`: the response the proxy returns is the one `setAll` built,
 *   so it carries the new auth cookie, forwards the refreshed cookie to the request (Server Components see the new
 *   token), and carries the no-store cache headers 0.12 hands to `setAll` (a response with auth cookies must never be
 *   cached and served to another user).
 * - A valid session and a signed-out request are passed through untouched: no cookie, no cache headers.
 *
 * Synthetic user only; tokens are compared, never printed.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import type { Session } from "@supabase/supabase-js";
import { proxy } from "@/proxy";
import { env } from "@/lib/env";
import { createUnlinkedUser } from "../helpers/tenants";

/** `@supabase/ssr`'s default storage key: `sb-<first host label>-auth-token`. */
const COOKIE = `sb-${new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0]}-auth-token`;

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
  it("passes a signed-out request through with no cookie and no cache headers", async () => {
    const res = await proxy(requestWith(null));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-middleware-next")).toBe("1");
    expect(res.headers.getSetCookie()).toEqual([]);
    expect(res.headers.get("cache-control")).toBeNull();
  });

  it("does not rewrite cookies for a session that is still valid", async () => {
    const res = await proxy(requestWith(session));
    expect(res.status).toBe(200);
    expect(authCookieFromSetCookie(res)).toBeNull();
    expect(res.headers.get("cache-control")).toBeNull();
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
