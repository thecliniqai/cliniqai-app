import { runCleanups } from "@/lib/pwa/cleanup";
import { purgeDeviceState } from "@/lib/pwa/purge";
import { announceSignOut } from "@/lib/pwa/auth-broadcast";
import { reportClientError } from "@/lib/log/client";

/**
 * `hardSignOut(reason)`: the ONE exit helper for every way a user leaves a signed-in device (PWA_STRATEGY §4 D-5,
 * adapted to V2-03's `POST /auth/signout`; V2-06 06-05, rulings R-18, R-19; 06-09a H-WEBKIT, M-EVERYWHERE, M-TABS,
 * A L-3; T-03-13, T-06-03). Browser-only.
 *
 * Order (no step can hold the exit: every await is raced against a real timer, and steps 1 to 4 share one deadline):
 * 1. `runCleanups("signout")`: Realtime unsubscribes, in-flight aborts, in-memory state (`lib/pwa/cleanup.ts`).
 * 2. `announceSignOut()`: every other tab of the origin purges and leaves too (`lib/pwa/auth-broadcast.ts`).
 * 3. `POST /auth/signout` as a fetch caller (header {@link SIGN_OUT_FETCH_HEADER}; `scope=global` only for
 *    "everywhere"): GoTrue revokes the session, the auth cookies are deleted, `Clear-Site-Data: "cache"`. The route
 *    answers fetch callers 200 JSON when GoTrue revoked the session and 502 JSON when it could not (it then deletes
 *    this device's cookies anyway). Never a redirect: WebKit never settles a `redirect: "manual"` fetch of a 303 that
 *    carries `Clear-Site-Data` (06-09a evidence `webkit-signout-answer-probe.txt`), and no `AbortSignal.timeout`
 *    dependency (Safari < 16 has none).
 * 4. Only when the server call failed (offline, timeout, refused): the browser client's `auth.signOut` with the same
 *    scope (the only client `signOut` allowed: `signout-guard` UI-policy rule), and every Supabase auth cookie expired
 *    in the browser (they are JS-readable with @supabase/ssr), so this device is signed out even with no network.
 * 5. Always (a `finally`): `purgeDeviceState()` (caches outside the allowlist, `sessionStorage`, non-preference
 *    `localStorage`, IndexedDB), then `location.replace(target)`: a hard navigation (no React tree with patient data
 *    survives; Back does not return to this entry). Offline, the service worker answers with `/offline`.
 *
 * "Sign out of all devices" never reports success it did not get: when neither the route nor the browser client got
 * GoTrue to revoke every session, this device is still signed out and the target is `/login?signout=partial`, where
 * the user is told the other devices are still signed in ({@link PARTIAL_SIGN_OUT_TARGET}).
 *
 * Reasons: `user` (Sign out), `everywhere` (Sign out of all devices), `switch` (Switch user: plain `/login`, nothing
 * prefilled), `expired` and `removed` (06-06's session-status reaction), `idle` (V2-11 AUTH-09 timer), `recovery`
 * (the forgot-password page ending its recovery session: same sign-out and purge, no navigation). A second call while
 * one runs returns the same promise; an "everywhere" call during a weaker run escalates it (global scope if the
 * server call has not been sent yet, otherwise the partial notice). A subscription lock is NOT a sign-out (D-8).
 */
export const SIGN_OUT_REASONS = ["user", "everywhere", "switch", "expired", "removed", "idle", "recovery"] as const;
export type SignOutReason = (typeof SIGN_OUT_REASONS)[number];

export const SIGN_OUT_FETCH_HEADER = "x-clinicos-signout";
export const SIGN_OUT_FETCH_VALUE = "fetch";
export const SIGN_OUT_TARGET = "/login";
export const PARTIAL_SIGN_OUT_TARGET = "/login?signout=partial";
/** What `/login?signout=partial` tells the user (fixed copy; retry = sign in and choose the item again). */
export const PARTIAL_SIGN_OUT_NOTICE =
  "You're signed out on this device, but we couldn't sign out your other devices. Sign in and choose \"Sign out of all devices\" again to retry.";

export const CLEANUP_BUDGET_MS = 2000;
export const SERVER_SIGN_OUT_TIMEOUT_MS = 5000;
export const LOCAL_SIGN_OUT_TIMEOUT_MS = 3000;
/** Steps 1 to 4 together; the purge and the navigation run after it whatever happened. */
export const SIGN_OUT_DEADLINE_MS = 8000;
export const PURGE_TIMEOUT_MS = 3000;

/** `@supabase/ssr` auth cookie names (whole or chunked) and the PKCE verifier; same shape as `app/auth/signout/route.ts`. */
export const SUPABASE_AUTH_COOKIE = /^sb-[a-z0-9-]+-auth-token(?:-code-verifier)?(?:\.\d+)?$/;

export type SignOutScope = "local" | "global";
/** `revoked`: GoTrue ended the session(s); `here-only`: this device is signed out, the revocation failed; `failed`: no answer. */
export type ServerOutcome = "revoked" | "here-only" | "failed";

/** What `hardSignOut` touches, injected so tests/pwa/hard-sign-out.spec.ts runs it in Node. */
export interface HardSignOutDeps {
  runCleanups: () => Promise<void>;
  announce: () => void;
  fetch: typeof fetch;
  /** The browser client's `auth.signOut({ scope })`; true only when GoTrue confirmed it. */
  signOutLocally: (scope: SignOutScope) => Promise<boolean>;
  expireAuthCookies: () => void;
  purge: () => Promise<{ failed: string[] }>;
  replace: (url: string) => void;
}

function browserDeps(): HardSignOutDeps {
  return {
    runCleanups: () => runCleanups("signout"),
    announce: () => announceSignOut(),
    fetch: (input, init) => window.fetch(input, init),
    signOutLocally: async (scope) => {
      // Loaded only on this fallback path, so the menu bundle does not carry supabase-js.
      const { createClient } = await import("@/lib/supabase/client");
      const { error } = await createClient().auth.signOut({ scope });
      return !error;
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

/**
 * What the route's answer to a fetch caller means: 200 `{ revoked: true }` → revoked; 502 `{ revoked: false }` → this
 * device is signed out but GoTrue did not revoke; anything else (a 303 from an older route, 403, 500, HTML) → failed.
 */
export async function readServerOutcome(response: Pick<Response, "status" | "json">): Promise<ServerOutcome> {
  if (response.status !== 200 && response.status !== 502) return "failed";
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return "failed";
  }
  const revoked = body !== null && typeof body === "object" ? (body as { revoked?: unknown }).revoked : undefined;
  if (response.status === 200 && revoked === true) return "revoked";
  if (response.status === 502 && revoked === false) return "here-only";
  return "failed";
}

const TIMEOUT = Symbol("timeout");

/** `work`, or TIMEOUT after `ms` (a plain timer: it fires even when the work never settles). Never rejects. */
async function within<T>(work: () => Promise<T>, ms: number): Promise<T | typeof TIMEOUT | Error> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve()
        .then(work)
        .catch((err: unknown) => (err instanceof Error ? err : new Error("rejected"))),
      new Promise<typeof TIMEOUT>((resolve) => {
        timer = setTimeout(() => resolve(TIMEOUT), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

interface RunState {
  reason: SignOutReason;
  /** Set when "everywhere" is asked for, at the start or during the run (A L-3). */
  wantsGlobal: boolean;
  /** The scope actually sent to the server, once sent. */
  sentScope: SignOutScope | null;
  /** Set when the deadline passed: steps still pending afterwards do nothing more. */
  over: boolean;
}

async function serverSignOut(scope: SignOutScope, deps: HardSignOutDeps): Promise<ServerOutcome> {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const answer = await within(
    async () => {
      const response = await deps.fetch("/auth/signout", {
        method: "POST",
        body: new URLSearchParams({ scope }),
        headers: { [SIGN_OUT_FETCH_HEADER]: SIGN_OUT_FETCH_VALUE, accept: "application/json" },
        redirect: "manual",
        credentials: "same-origin",
        signal: controller?.signal,
      });
      return readServerOutcome(response);
    },
    SERVER_SIGN_OUT_TIMEOUT_MS,
  );
  if (answer === TIMEOUT) controller?.abort();
  return answer === TIMEOUT || answer instanceof Error ? "failed" : answer;
}

/** Steps 1 to 4. Resolves to whether every session the user asked to end has ended ("partial" when not). */
async function signOutSteps(state: RunState, deps: HardSignOutDeps): Promise<"done" | "partial"> {
  const cleaned = await within(() => deps.runCleanups(), CLEANUP_BUDGET_MS);
  if (cleaned instanceof Error) reportClientError("auth.hard_sign_out_cleanup", cleaned);
  if (state.over) return "partial";

  try {
    deps.announce();
  } catch (err) {
    reportClientError("auth.hard_sign_out_announce", err);
  }

  const scope: SignOutScope = state.wantsGlobal ? "global" : "local";
  state.sentScope = scope;
  const server = await serverSignOut(scope, deps);
  if (state.over) return "partial";

  let revokedAsAsked = server === "revoked";
  if (server === "failed") {
    const local = await within(() => deps.signOutLocally(scope), LOCAL_SIGN_OUT_TIMEOUT_MS);
    if (local instanceof Error) reportClientError("auth.hard_sign_out_local", local);
    if (state.over) return "partial";
    revokedAsAsked = local === true;
    deps.expireAuthCookies();
  }
  // "everywhere" asked after a local call went out cannot be honoured any more: the session is gone.
  if (state.wantsGlobal && (scope !== "global" || !revokedAsAsked)) return "partial";
  return "done";
}

async function run(state: RunState, deps: HardSignOutDeps): Promise<void> {
  let outcome: "done" | "partial" | typeof TIMEOUT | Error = TIMEOUT;
  try {
    outcome = await within(() => signOutSteps(state, deps), SIGN_OUT_DEADLINE_MS);
  } finally {
    state.over = true;
    if (outcome === TIMEOUT || outcome instanceof Error) {
      // The steps did not finish (a stuck primitive): this device must still hold no auth cookie.
      try {
        deps.expireAuthCookies();
      } catch (err) {
        reportClientError("auth.hard_sign_out_cookies", err);
      }
    }
    const purged = await within(() => deps.purge(), PURGE_TIMEOUT_MS);
    if (purged instanceof Error) reportClientError("auth.hard_sign_out_purge", purged);
    else if (purged !== TIMEOUT && purged.failed.length > 0) {
      reportClientError("auth.hard_sign_out_purge", new Error(`purge failed: ${purged.failed.join(",")}`));
    }
    const partial = outcome === "partial" || (state.wantsGlobal && outcome !== "done");
    if (state.reason !== "recovery") deps.replace(partial ? PARTIAL_SIGN_OUT_TARGET : SIGN_OUT_TARGET);
  }
}

let current: { state: RunState; promise: Promise<void> } | null = null;

export function hardSignOut(reason: SignOutReason, deps: HardSignOutDeps = browserDeps()): Promise<void> {
  if (!SIGN_OUT_REASONS.includes(reason)) throw new Error("unknown sign-out reason");
  if (current) {
    if (reason === "everywhere") current.state.wantsGlobal = true;
    return current.promise;
  }
  const state: RunState = { reason, wantsGlobal: reason === "everywhere", sentScope: null, over: false };
  const promise = run(state, deps).finally(() => {
    current = null;
  });
  current = { state, promise };
  return promise;
}

/** What a tab that hears another tab's sign-out runs (M-TABS): no server call, no announcement, no new cookies used. */
export interface FollowSignOutDeps {
  runCleanups: () => Promise<void>;
  purge: () => Promise<{ failed: string[] }>;
  replace: (url: string) => void;
}

/** Another tab signed this device out: drop this tab's state and leave for `/login` (PwaRuntime calls it). */
export async function followSignOutElsewhere(
  deps: FollowSignOutDeps = { runCleanups: () => runCleanups("signout"), purge: () => purgeDeviceState(), replace: (url) => window.location.replace(url) },
): Promise<void> {
  try {
    await within(() => deps.runCleanups(), CLEANUP_BUDGET_MS);
    await within(() => deps.purge(), PURGE_TIMEOUT_MS);
  } finally {
    deps.replace(SIGN_OUT_TARGET);
  }
}
