import { createBrowserClient, type CookieOptions } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Database } from "@/lib/db/types";
import { publicEnv } from "@/lib/env";

export function createClient() {
  return createBrowserClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  );
}

/** A Supabase session cookie (whole or chunked); not the PKCE code verifier. */
const SESSION_COOKIE = /^sb-[a-z0-9-]+-auth-token(?:\.\d+)?$/;

function documentCookiesOf(cookie: string): { name: string; value: string }[] {
  return cookie
    .split(";")
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const eq = pair.indexOf("=");
      const name = eq < 0 ? pair : pair.slice(0, eq);
      const raw = eq < 0 ? "" : pair.slice(eq + 1);
      try {
        return { name, value: raw.includes("%") ? decodeURIComponent(raw) : raw };
      } catch {
        return { name, value: raw };
      }
    });
}

function documentCookies(): { name: string; value: string }[] {
  return documentCookiesOf(document.cookie);
}

function writeCookie(name: string, value: string, options: CookieOptions): void {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${options.path ?? "/"}`];
  if (typeof options.maxAge === "number") parts.push(`Max-Age=${Math.floor(options.maxAge)}`);
  if (options.expires) parts.push(`Expires=${new Date(options.expires).toUTCString()}`);
  if (options.domain) parts.push(`Domain=${options.domain}`);
  if (options.sameSite) parts.push(`SameSite=${options.sameSite === true ? "Strict" : options.sameSite}`);
  if (options.secure) parts.push("Secure");
  document.cookie = parts.join("; ");
}

/**
 * V2-06 06-09d close (re-check L-N3): the browser client of `/forgot-password` (request a code, verify it). It works on
 * a view of the cookies WITHOUT the device's existing session: a signed-in user's session cookies are never shown to it,
 * so it never refreshes them, and never deletes them when a refresh fails (auth-js deletes the stored session on a
 * refresh 429 or uncoded 4xx; any client that sees an expired session refreshes it, even with `autoRefreshToken: off`,
 * because supabase-js reads the session for its INITIAL_SESSION event). Only the proxy refreshes a session, through the
 * Auth transport, which keeps it on such answers. What this client writes (the PKCE verifier, the recovery session from
 * `verifyOtp`) goes to the real cookies as usual, and the first session it stores replaces every session cookie the
 * device had (as the shared client would: no stale chunk is left for the server to combine). Not the shared singleton.
 */
export function createAuthPageClient() {
  const own = new Set<string>();
  return createBrowserClient<Database>(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    isSingleton: false,
    auth: { autoRefreshToken: false },
    cookies: {
      getAll: () => documentCookies().filter((c) => !SESSION_COOKIE.test(c.name) || own.has(c.name)),
      setAll: (cookies) => {
        const storesSession = cookies.some((c) => SESSION_COOKIE.test(c.name) && c.value !== "");
        if (storesSession && own.size === 0) {
          for (const { name } of documentCookies()) {
            if (SESSION_COOKIE.test(name) && !cookies.some((c) => c.name === name)) writeCookie(name, "", { path: "/", maxAge: 0 });
          }
        }
        for (const { name, value, options } of cookies) {
          writeCookie(name, value, options);
          if (!SESSION_COOKIE.test(name)) continue;
          if (value === "" || options.maxAge === 0) own.delete(name);
          else own.add(name);
        }
      },
    },
  });
}

/**
 * V2-08 08-03a (R-10): the browser's Realtime connection for live views (Today). A client that is given the session's
 * access token and nothing else: with the `accessToken` option supabase-js builds no auth client, so it can never refresh,
 * rewrite or delete the session cookies (06-09d above: any browser client that sees an expired session refreshes it, and
 * auth-js deletes the stored session on some refresh failures; only the proxy refreshes a session); it is given no cookie
 * access at all. The token is read from the session cookie each time Realtime asks for it (connect, rejoin), so it is the
 * one the proxy last wrote. The cookie is not HttpOnly (the SSR client reads it in the browser too). Not a data client: it is
 * used for broadcast channels only.
 */
const BASE64_PREFIX = "base64-";
const SESSION_COOKIE_BASE = /^sb-[a-z0-9-]+-auth-token$/;

function fromBase64Url(text: string): string {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

/** The access token inside the Supabase session cookie of `cookie` (a `document.cookie` string), or null. */
export function accessTokenFromCookie(cookie: string): string | null {
  const jar = new Map(documentCookiesOf(cookie).map((c) => [c.name, c.value]));
  const key = [...jar.keys()].map((name) => name.replace(/\.\d+$/, "")).find((base) => SESSION_COOKIE_BASE.test(base));
  if (!key) return null;
  try {
    let combined = jar.get(key);
    if (combined === undefined) {
      // A session too long for one cookie is split into `<key>.0`, `<key>.1`, ...
      combined = "";
      for (let i = 0; jar.has(`${key}.${i}`); i++) combined += jar.get(`${key}.${i}`);
    }
    if (!combined) return null;
    const json = combined.startsWith(BASE64_PREFIX) ? fromBase64Url(combined.slice(BASE64_PREFIX.length)) : combined;
    const session = JSON.parse(json) as { access_token?: unknown };
    return typeof session.access_token === "string" && session.access_token ? session.access_token : null;
  } catch {
    return null;
  }
}

let realtime: SupabaseClient | null = null;

/** The shared Realtime client of this page (created on first use). */
export function realtimeClient(): SupabaseClient {
  realtime ??= createBrowserClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    isSingleton: false,
    accessToken: async () => accessTokenFromCookie(document.cookie),
    cookies: { getAll: () => [], setAll: () => undefined },
    realtime: { params: { eventsPerSecond: 5 } },
  }) as unknown as SupabaseClient;
  return realtime;
}
