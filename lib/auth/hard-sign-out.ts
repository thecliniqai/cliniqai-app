import { runCleanups } from "@/lib/pwa/cleanup";
import { purgeDeviceState } from "@/lib/pwa/purge";
import { reportClientError } from "@/lib/log/client";

/**
 * `hardSignOut(reason)`: the ONE exit helper for every way a user leaves a signed-in device (PWA_STRATEGY §4 D-5,
 * adapted to V2-03's `POST /auth/signout`; V2-06 06-05, rulings R-18, R-19; T-03-13, T-06-03). Browser-only.
 *
 * Order:
 * 1. `runCleanups("signout")`: Realtime unsubscribes, in-flight aborts, in-memory state (`lib/pwa/cleanup.ts`).
 * 2. `POST /auth/signout` (`redirect: "manual"`, 5 s timeout; `scope=global` only for "everywhere"): GoTrue revokes the
 *    session, the auth cookies are deleted, `Clear-Site-Data: "cache"`. Success = the route's 303 (an opaque redirect
 *    to `fetch`).
 * 3. Only when that failed (offline, timeout, refused): the browser client's `auth.signOut({ scope: "local" })` (the
 *    only client `signOut` allowed: `signout-guard` UI-policy rule) and every Supabase auth cookie expired in the
 *    browser (they are JS-readable with @supabase/ssr), so this device is signed out even with no network. The
 *    client is imported on demand; offline that chunk may not load, and the cookie expiry alone signs the device out
 *    GoTrue cannot be told while offline in either case: the server-side session stays valid until it is revoked
 *    ("Sign out of all devices") or ends by the auth settings, but no copy of its tokens is left on this device.
 * 4. `purgeDeviceState()`: caches outside the allowlist, `sessionStorage`, non-preference `localStorage`, IndexedDB.
 * 5. `location.replace("/login")`: a hard navigation (no React tree with patient data survives; Back does not return
 *    to this entry). Offline, the service worker answers with `/offline`.
 *
 * Reasons: `user` (Sign out), `everywhere` (Sign out of all devices), `switch` (Switch user: plain `/login`, nothing
 * prefilled), `expired` and `removed` (06-06's session-status reaction), `idle` (V2-11 AUTH-09 timer). A second call
 * while one runs returns the same promise. A subscription lock is NOT a sign-out (D-8, 06-06).
 */
export const SIGN_OUT_REASONS = ["user", "everywhere", "switch", "expired", "removed", "idle"] as const;
export type SignOutReason = (typeof SIGN_OUT_REASONS)[number];

export const SERVER_SIGN_OUT_TIMEOUT_MS = 5000;
export const LOCAL_SIGN_OUT_TIMEOUT_MS = 3000;

/** `@supabase/ssr` auth cookie names (whole or chunked) and the PKCE verifier; same shape as `app/auth/signout/route.ts`. */
export const SUPABASE_AUTH_COOKIE = /^sb-[a-z0-9-]+-auth-token(?:-code-verifier)?(?:\.\d+)?$/;

/** What `hardSignOut` touches, injected so tests/pwa/hard-sign-out.spec.ts runs it in Node. */
export interface HardSignOutDeps {
  runCleanups: () => Promise<void>;
  fetch: typeof fetch;
  signOutLocally: () => Promise<void>;
  expireAuthCookies: () => void;
  purge: () => Promise<{ failed: string[] }>;
  replace: (url: string) => void;
}

function browserDeps(): HardSignOutDeps {
  return {
    runCleanups: () => runCleanups("signout"),
    fetch: (input, init) => window.fetch(input, init),
    signOutLocally: async () => {
      // Loaded only on this fallback path, so the menu bundle does not carry supabase-js.
      const { createClient } = await import("@/lib/supabase/client");
      await createClient().auth.signOut({ scope: "local" });
    },
    expireAuthCookies: () => {
      for (const pair of document.cookie.split(";")) {
        const name = pair.split("=")[0]?.trim();
        if (name && SUPABASE_AUTH_COOKIE.test(name)) document.cookie = `${name}=; Max-Age=0; path=/; SameSite=Lax`;
      }
    },
    purge: () => purgeDeviceState(),
    replace: (url) => window.location.replace(url),
  };
}

/** True when the sign-out route answered its 303 (seen by a `redirect: "manual"` fetch as an opaque redirect). */
export function serverSignedOut(response: Pick<Response, "type" | "status">): boolean {
  return response.type === "opaqueredirect" || response.status === 303;
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | "timeout"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    work,
    new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function run(reason: SignOutReason, deps: HardSignOutDeps): Promise<void> {
  try {
    await deps.runCleanups();
  } catch (err) {
    reportClientError("auth.hard_sign_out_cleanup", err);
  }

  let serverOk = false;
  try {
    const response = await deps.fetch("/auth/signout", {
      method: "POST",
      body: new URLSearchParams({ scope: reason === "everywhere" ? "global" : "local" }),
      redirect: "manual",
      credentials: "same-origin",
      signal: AbortSignal.timeout(SERVER_SIGN_OUT_TIMEOUT_MS),
    });
    serverOk = serverSignedOut(response);
  } catch {
    // Offline, timed out or blocked: sign out locally below.
  }

  if (!serverOk) {
    try {
      await withTimeout(deps.signOutLocally(), LOCAL_SIGN_OUT_TIMEOUT_MS);
    } catch (err) {
      reportClientError("auth.hard_sign_out_local", err);
    }
    deps.expireAuthCookies();
  }

  try {
    const { failed } = await deps.purge();
    if (failed.length > 0) reportClientError("auth.hard_sign_out_purge", new Error(`purge failed: ${failed.join(",")}`));
  } catch (err) {
    reportClientError("auth.hard_sign_out_purge", err);
  }

  deps.replace("/login");
}

let inFlight: Promise<void> | null = null;

export function hardSignOut(reason: SignOutReason, deps: HardSignOutDeps = browserDeps()): Promise<void> {
  if (!SIGN_OUT_REASONS.includes(reason)) throw new Error("unknown sign-out reason");
  inFlight ??= run(reason, deps).finally(() => {
    inFlight = null;
  });
  return inFlight;
}
