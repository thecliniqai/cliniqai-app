import { classifyAuthAnswer, type AuthAnswerOutcome } from "@/lib/auth/auth-failure";
import { isSupabaseAuthCookie } from "@/lib/auth/session-age";

/**
 * V2-06 06-09d (H-AUTHOUT-R1, L-R2, L-R3): the transport every cookie-session Supabase client (`proxy.ts`,
 * `lib/supabase/server.ts`) uses for its Auth API calls, and the rule that keeps auth-js from deleting the session
 * cookies when Supabase Auth only failed to answer.
 *
 * Why: when the access token has expired, `auth.getUser()` / `getClaims()` refresh it first, and auth-js 2.117
 * (`_callRefreshToken`) removes the stored session for ANY refresh error that is not an `AuthRetryableFetchError`
 * (a 429, an uncoded 400, a gateway 404 or 401). `@supabase/ssr` then hands `setAll` the deletion of every auth cookie,
 * so a rate-limited `/token` signed out and purged every device whose access token expired meanwhile. And for a
 * retryable error (network, 5xx) auth-js retries the refresh with back-off for up to ~25 s, far beyond the client's
 * 10 s status timeout (`STATUS_TIMEOUT_MS`), twice per poll (proxy, then route).
 *
 * What this does:
 * - Records the outcome of every `/auth/v1/*` answer (`classifyAuthAnswer`: only GoTrue's definitive codes are
 *   `definitive`; a network error, a timeout, 5xx, 429, 408, an uncoded or non-GoTrue 4xx are `unavailable`).
 *   {@link keepSessionCookies} drops the auth-cookie deletions auth-js asks for after an `unavailable` answer.
 * - Bounds the Auth calls of one client to {@link AUTH_REQUEST_BUDGET_MS} from its first Auth call: a call still
 *   running at the deadline is aborted, and every Auth call after it is answered at once with a synthetic 408 (never
 *   sent). auth-js does not retry a 408 (it is an `AuthApiError`), so its back-off loop ends there; the outcome is
 *   `unavailable` (no deletion). A refresh attempt that failed in a way auth-js would retry (a network error, or one of
 *   its "network" statuses 500–504, 520–530) is also answered with the 408 when auth-js's next back-off sleep
 *   (200 ms × 2^attempt, `_refreshAccessToken`) would end past the deadline, so the loop never sleeps beyond it.
 *   Proxy + route handler therefore answer within 2 × the budget, inside the client's 10 s.
 * - `unavailable: true` (the proxy found Auth unavailable for this request, {@link AUTH_STATE_HEADER}): the
 *   session-bearing calls (`GET /user`, the refresh-token grant) are answered with the synthetic 408 without a request,
 *   so a page or handler never refreshes the session a second time (a refresh in a Server Component could not even store
 *   the rotated tokens). Sign-in, sign-out and every other Auth call are sent as usual.
 *
 * Non-Auth requests (PostgREST, Storage) pass through untouched. `globalThis.fetch` is read at call time.
 */

/** The Auth budget of one client (ms): a refresh's retries, or one `/user` call, end within it. */
export const AUTH_REQUEST_BUDGET_MS = 3500;

/**
 * Set by `proxy.ts` on the forwarded request (and removed from every inbound request) when Supabase Auth could not
 * answer for this request: `lib/supabase/server.ts` then answers the session-bearing calls "unavailable" at once.
 */
export const AUTH_STATE_HEADER = "x-clinicos-auth-state";
export const AUTH_STATE_UNAVAILABLE = "unavailable";

/** The code of the synthetic answer (never a GoTrue code, so never definitive). */
export const AUTH_UNAVAILABLE_CODE = "clinicos_auth_unavailable";

/** The statuses auth-js 2.117 treats as a retryable network failure (`NETWORK_ERROR_CODES` in its `fetch.ts`). */
const AUTH_JS_RETRYABLE_STATUSES: ReadonlySet<number> = new Set([500, 501, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527, 528, 529, 530]);
/** auth-js's sleep before refresh attempt n + 1 is 200 ms × 2^n (`_refreshAccessToken`). */
const refreshBackOffMs = (attempt: number) => 200 * 2 ** attempt;

export interface AuthTransport {
  /** The `global.fetch` for the Supabase client. */
  fetch: typeof fetch;
  /** The outcome of the last Auth answer through this transport (`none` before the first). */
  outcome: () => AuthAnswerOutcome | "none";
  /** Starts a new budget (a second, separate Auth operation on the same client, e.g. the proxy's sign-out). */
  restartBudget: () => void;
}

export interface AuthTransportOptions {
  supabaseUrl: string;
  /** The proxy found Auth unavailable for this request: answer session-bearing calls at once. */
  unavailable?: boolean;
  budgetMs?: number;
  now?: () => number;
}

function urlOf(input: RequestInfo | URL): URL | null {
  try {
    return new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  } catch {
    return null;
  }
}

function unavailableAnswer(): Response {
  return new Response(JSON.stringify({ code: AUTH_UNAVAILABLE_CODE, msg: "Supabase Auth did not answer in time" }), {
    status: 408,
    headers: { "content-type": "application/json" },
  });
}

export function createAuthTransport(options: AuthTransportOptions): AuthTransport {
  const authPrefix = `${new URL(options.supabaseUrl).pathname.replace(/\/$/, "")}/auth/v1/`;
  const authOrigin = new URL(options.supabaseUrl).origin;
  const budgetMs = options.budgetMs ?? AUTH_REQUEST_BUDGET_MS;
  const now = options.now ?? (() => Date.now());
  let deadline: number | null = null;
  let outcome: AuthAnswerOutcome | "none" = "none";
  /** Refresh attempts that failed retryably in a row (auth-js's attempt counter, mirrored). */
  let refreshFailures = 0;
  /** True when auth-js would sleep past the deadline before its next refresh attempt (after `refreshFailures` ≥ 1). */
  const nextRetryMissesDeadline = () => deadline !== null && now() + refreshBackOffMs(refreshFailures - 1) >= deadline;

  const isAuthCall = (url: URL | null) => url !== null && url.origin === authOrigin && url.pathname.startsWith(authPrefix);
  const carriesSession = (url: URL, method: string) =>
    (url.pathname === `${authPrefix}user` && method === "GET") ||
    (url.pathname === `${authPrefix}token` && url.searchParams.get("grant_type") === "refresh_token");

  const transportFetch: typeof fetch = async (input, init) => {
    const url = urlOf(input);
    if (!isAuthCall(url)) return globalThis.fetch(input, init);
    const method = (init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET")).toUpperCase();
    const isRefresh = url!.pathname === `${authPrefix}token` && url!.searchParams.get("grant_type") === "refresh_token";
    if (options.unavailable && carriesSession(url!, method)) {
      outcome = "unavailable";
      return unavailableAnswer();
    }
    deadline ??= now() + budgetMs;
    const remaining = deadline - now();
    if (remaining <= 0) {
      outcome = "unavailable";
      return unavailableAnswer();
    }
    const controller = new AbortController();
    const callerSignal = init?.signal ?? null;
    const onCallerAbort = () => controller.abort(callerSignal?.reason);
    if (callerSignal?.aborted) controller.abort(callerSignal.reason);
    else callerSignal?.addEventListener("abort", onCallerAbort, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const answer = await Promise.race([
        globalThis.fetch(input, { ...init, signal: controller.signal }),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), remaining);
        }),
      ]);
      if (answer === null) {
        controller.abort();
        outcome = "unavailable";
        return unavailableAnswer();
      }
      outcome = answer.ok
        ? "ok"
        : classifyAuthAnswer(answer.status, await answer.clone().json().catch(() => null), answer.headers.get("x-supabase-api-version"));
      if (isRefresh && AUTH_JS_RETRYABLE_STATUSES.has(answer.status)) {
        refreshFailures += 1;
        if (nextRetryMissesDeadline()) return unavailableAnswer();
      } else if (isRefresh) refreshFailures = 0;
      return answer;
    } catch (err) {
      outcome = "unavailable";
      if (isRefresh) {
        refreshFailures += 1;
        if (nextRetryMissesDeadline()) return unavailableAnswer();
      }
      throw err;
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener("abort", onCallerAbort);
    }
  };

  return {
    fetch: transportFetch,
    outcome: () => outcome,
    restartBudget: () => {
      deadline = null;
      refreshFailures = 0;
    },
  };
}

/** One cookie write as `@supabase/ssr` hands it to `setAll`. */
export interface CookieWrite {
  name: string;
  value: string;
  options?: { maxAge?: number; expires?: Date | number | string } & Record<string, unknown>;
}

function deletesAuthCookie(cookie: CookieWrite): boolean {
  if (!isSupabaseAuthCookie(cookie.name)) return false;
  const expires = cookie.options?.expires;
  const expired = expires !== undefined && new Date(expires).getTime() <= Date.now();
  return cookie.value === "" || cookie.options?.maxAge === 0 || (typeof cookie.options?.maxAge === "number" && cookie.options.maxAge < 0) || expired;
}

/**
 * The writes of one `setAll` call that may reach the browser: after an `unavailable` Auth answer, every deletion of an
 * auth cookie is dropped (the session stays; only a definitive GoTrue answer ends it). Other writes pass unchanged.
 */
export function keepSessionCookies<T extends CookieWrite>(transport: AuthTransport, cookies: readonly T[]): T[] {
  if (transport.outcome() !== "unavailable") return [...cookies];
  return cookies.filter((cookie) => !deletesAuthCookie(cookie));
}
