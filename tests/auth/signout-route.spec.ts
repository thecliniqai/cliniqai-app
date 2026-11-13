/**
 * V2-03 03-12b (AUTH-04b, PWA D-5, T-03-13): `POST /auth/signout` against the local GoTrue.
 *
 * The route's cookie client is replaced with a throwaway user's real supabase-js client (the request slot), so the
 * revocation is real: after a same-origin POST the user's refresh token fails at GoTrue (`refresh_token_not_found`)
 * and its access token no longer passes `getUser`. `local` ends only that session; `global` ends every session of the
 * user. Cross-origin and malformed calls are refused before any client exists. No session still answers 303. When
 * GoTrue cannot revoke, the auth cookies are deleted anyway. GET is not exported (Next answers 405).
 *
 * Synthetic users only; tokens are compared, never printed.
 */
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { publicEnv } from "@/lib/env";
import { serverEnv } from "@/lib/env-server";
import { isSameOriginRequest } from "@/lib/auth/same-origin";
import { createUnlinkedUser, seededUserPassword } from "../helpers/tenants";
import { browserLikeClient } from "../helpers/auth-flows";
import type { TestDb } from "../helpers/db";

const slot = vi.hoisted(() => ({ client: null as unknown, created: 0 }));
const jar = vi.hoisted(() => ({ cookies: [] as Array<{ name: string; value: string }>, deleted: [] as string[] }));

vi.mock("@/lib/supabase/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/server")>();
  return {
    ...actual,
    createClient: async () => {
      slot.created += 1;
      return slot.client;
    },
  };
});

vi.mock("next/headers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/headers")>();
  return {
    ...actual,
    cookies: async () => ({
      getAll: () => jar.cookies,
      delete: (name: string) => jar.deleted.push(name),
    }),
    headers: async () => {
      throw new Error("outside a request scope");
    },
  };
});

const route = await import("@/app/auth/signout/route");

const APP_ORIGIN = new URL(serverEnv().NEXT_PUBLIC_APP_URL).origin;

function post(headers: Record<string, string>, form?: Record<string, string>): NextRequest {
  return new NextRequest("http://localhost:3000/auth/signout", {
    method: "POST",
    headers: { ...(form ? { "content-type": "application/x-www-form-urlencoded" } : {}), ...headers },
    body: form ? new URLSearchParams(form).toString() : undefined,
  });
}

function freshClient(): TestDb {
  return createSupabaseClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  }) as TestDb;
}

async function tokensOf(client: TestDb): Promise<{ access: string; refresh: string }> {
  const { data } = await client.auth.getSession();
  if (!data.session) throw new Error("no session");
  return { access: data.session.access_token, refresh: data.session.refresh_token };
}

/** A second, independent session of the same user (another device). */
async function secondSession(email: string): Promise<TestDb> {
  const client = freshClient();
  const { error } = await client.auth.signInWithPassword({ email, password: seededUserPassword() });
  if (error) throw new Error(`second sign-in failed: ${error.code ?? error.message}`);
  return client;
}

async function refreshFails(refreshToken: string): Promise<string | undefined> {
  const { data, error } = await freshClient().auth.refreshSession({ refresh_token: refreshToken });
  expect(data.session).toBeNull();
  return error?.code;
}

async function accessTokenWorks(accessToken: string): Promise<boolean> {
  const { data, error } = await freshClient().auth.getUser(accessToken);
  return !error && Boolean(data.user);
}

beforeEach(() => {
  slot.client = null;
  slot.created = 0;
  jar.cookies = [];
  jar.deleted = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("03-12b POST /auth/signout", () => {
  it("exports POST only, so Next answers GET (and every other method) 405", () => {
    const methods = Object.keys(route).filter((k) => /^[A-Z]+$/.test(k));
    expect(methods).toEqual(["POST"]);
    expect((route as Record<string, unknown>).GET).toBeUndefined();
  });

  it("refuses a cross-origin POST with 403 before creating a client; the session survives", async () => {
    const user = await createUnlinkedUser();
    const before = await tokensOf(user.client);
    slot.client = user.client;
    const refusedHeaders: Array<Record<string, string>> = [
      { origin: "https://evil.example" },
      { origin: "https://evil.example", "sec-fetch-site": "cross-site" },
      { origin: APP_ORIGIN, "sec-fetch-site": "cross-site" },
      { origin: "null" },
      {},
    ];
    for (const headers of refusedHeaders) {
      const res = await route.POST(post(headers, { scope: "global" }));
      expect(res.status, JSON.stringify(headers)).toBe(403);
      expect(await res.text()).toBe("");
      expect(res.headers.get("location")).toBeNull();
    }
    expect(slot.created).toBe(0);
    expect(await accessTokenWorks(before.access)).toBe(true);
  });

  it("refuses an unknown scope with 400 and signs nobody out", async () => {
    const user = await createUnlinkedUser();
    const before = await tokensOf(user.client);
    slot.client = user.client;
    const res = await route.POST(post({ origin: APP_ORIGIN }, { scope: "others" }));
    expect(res.status).toBe(400);
    expect(slot.created).toBe(0);
    expect(await accessTokenWorks(before.access)).toBe(true);
  });

  it("with no session: 303 to /login with Clear-Site-Data and no body", async () => {
    slot.client = freshClient();
    const res = await route.POST(post({ origin: APP_ORIGIN }, { scope: "local" }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/login");
    expect(res.headers.get("clear-site-data")).toBe('"cache"');
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).toBe("");
  });

  it("scope local (the default) revokes this session at GoTrue and leaves the user's other device signed in", async () => {
    const user = await createUnlinkedUser();
    const other = await secondSession(user.userEmail);
    const mine = await tokensOf(user.client);
    const theirs = await tokensOf(other);
    slot.client = user.client;

    // No form body at all: the default scope is local. Sec-Fetch-Site alone is enough.
    const res = await route.POST(post({ "sec-fetch-site": "same-origin" }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/login");
    expect(res.headers.get("clear-site-data")).toBe('"cache"');

    expect(await refreshFails(mine.refresh)).toBe("refresh_token_not_found");
    expect(await accessTokenWorks(mine.access)).toBe(false);
    expect(await accessTokenWorks(theirs.access)).toBe(true);
    const { data } = await freshClient().auth.refreshSession({ refresh_token: theirs.refresh });
    expect(data.session, "the other device can still refresh").not.toBeNull();
  });

  it("scope global revokes every session of the user", async () => {
    const user = await createUnlinkedUser();
    const other = await secondSession(user.userEmail);
    const mine = await tokensOf(user.client);
    const theirs = await tokensOf(other);
    slot.client = user.client;

    const res = await route.POST(post({ origin: APP_ORIGIN }, { scope: "global" }));
    expect(res.status).toBe(303);
    expect(res.headers.get("clear-site-data")).toBe('"cache"');

    expect(await refreshFails(mine.refresh)).toBe("refresh_token_not_found");
    expect(await refreshFails(theirs.refresh)).toBe("refresh_token_not_found");
    expect(await accessTokenWorks(mine.access)).toBe(false);
    expect(await accessTokenWorks(theirs.access)).toBe(false);
  });

  it("03-13a: with an EXPIRED access token the session is still revoked at GoTrue (refreshed first, then signed out)", async () => {
    const user = await createUnlinkedUser();
    const { client, store } = browserLikeClient();
    const { error } = await client.auth.signInWithPassword({ email: user.userEmail, password: seededUserPassword() });
    expect(error).toBeNull();
    const key = [...store.keys()].find((k) => /^sb-.*-auth-token$/.test(k));
    expect(key).toBeDefined();
    const stored = JSON.parse(store.get(key!)!) as { access_token: string; refresh_token: string; expires_at: number; expires_in: number };
    // The access token this device holds has expired (as after a laptop sleeps past jwt_expiry).
    const past = Math.floor(Date.now() / 1000) - 60;
    store.set(key!, JSON.stringify({ ...stored, expires_at: past, expires_in: -60 }));
    slot.client = client;

    const res = await route.POST(post({ origin: APP_ORIGIN }, { scope: "local" }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/login");
    expect(res.headers.get("clear-site-data")).toBe('"cache"');
    expect(store.has(key!), "the local session is cleared").toBe(false);
    expect(await refreshFails(stored.refresh_token)).toBe("refresh_token_not_found");
    expect(await accessTokenWorks(stored.access_token)).toBe(false);
  });

  it("when GoTrue cannot revoke, the auth cookies are still deleted and the answer is the same 303", async () => {
    slot.client = {
      auth: { signOut: async () => ({ error: Object.assign(new Error("upstream"), { code: "unexpected_failure", status: 502 }) }) },
    };
    jar.cookies = [
      { name: "sb-127-auth-token", value: "x" },
      { name: "sb-127-auth-token.0", value: "x" },
      { name: "sb-127-auth-token-code-verifier", value: "x" },
      { name: "theme", value: "light" },
    ];
    const res = await route.POST(post({ origin: APP_ORIGIN }, { scope: "local" }));
    expect(res.status).toBe(303);
    expect(res.headers.get("clear-site-data")).toBe('"cache"');
    expect(jar.deleted.sort()).toEqual(["sb-127-auth-token", "sb-127-auth-token-code-verifier", "sb-127-auth-token.0"]);
  });
});

describe("03-12b isSameOriginRequest", () => {
  const h = (init: Record<string, string>) => new Headers(init);
  it.each([
    [{ origin: "http://app.test" }, true],
    [{ origin: "http://app.test", "sec-fetch-site": "same-origin" }, true],
    [{ "sec-fetch-site": "same-origin" }, true],
    [{ origin: "http://preview.test", "sec-fetch-site": "same-origin" }, true],
    [{ origin: "https://evil.example" }, false],
    [{ origin: "http://app.test:8080" }, false],
    [{ origin: "https://app.test" }, false],
    [{ origin: "http://app.test", "sec-fetch-site": "cross-site" }, false],
    [{ origin: "http://app.test", "sec-fetch-site": "same-site" }, false],
    [{ "sec-fetch-site": "none" }, false],
    [{ origin: "null" }, false],
    [{}, false],
  ])("%j → %s", (headers, expected) => {
    expect(isSameOriginRequest(h(headers), "http://app.test")).toBe(expected);
  });

  it("with no trusted app origin only Sec-Fetch-Site: same-origin passes", () => {
    expect(isSameOriginRequest(h({ origin: "http://app.test" }), null)).toBe(false);
    expect(isSameOriginRequest(h({ "sec-fetch-site": "same-origin" }), null)).toBe(true);
  });
});
