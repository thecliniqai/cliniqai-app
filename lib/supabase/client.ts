import { createBrowserClient, type CookieOptions } from "@supabase/ssr";
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

function documentCookies(): { name: string; value: string }[] {
  return document.cookie
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
