/**
 * V2-06 06-09d (H-AUTHOUT-R1, L-R1, L-R3): the Auth failure classifier (`lib/auth/auth-failure.ts`) and the Auth
 * transport of the cookie-session clients (`lib/supabase/auth-transport.ts`), in Node with an injected fetch and clock.
 * The end-to-end behaviour against the local GoTrue is tests/auth/session-auth-reverify-db.spec.ts.
 *
 * - Definitive = GoTrue's own codes only (with GoTrue's API-version header, as auth-js reads them); an uncoded 4xx,
 *   Kong's 401 "Invalid API key" and 404, `no_authorization`, 408 and 429 are not. Before 06-09d any JSON 4xx other
 *   than 408/429 was definitive (the re-verifier's 400gw / 404kong / 401kong probes answered 401).
 * - The transport records each Auth answer's outcome; `keepSessionCookies` drops auth-cookie deletions after an
 *   `unavailable` one (and only then).
 * - The budget: a hanging call is cut at the deadline with a synthetic 408; a refresh failing retryably is cut when
 *   auth-js's next sleep would pass the deadline; under the proxy's mark the session calls are answered without a
 *   request, other Auth calls (sign-in, sign-out) are still sent; PostgREST passes through.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthApiError, AuthInvalidJwtError, AuthRetryableFetchError, AuthSessionMissingError, AuthUnknownError } from "@supabase/supabase-js";
import { classifyAuthAnswer, DEFINITIVE_AUTH_CODES, isDefinitiveAuthRejection } from "@/lib/auth/auth-failure";
import {
  AUTH_REQUEST_BUDGET_MS,
  AUTH_UNAVAILABLE_CODE,
  createAuthTransport,
  keepSessionCookies,
} from "@/lib/supabase/auth-transport";

const BASE = "http://127.0.0.1:54321";
const REFRESH = `${BASE}/auth/v1/token?grant_type=refresh_token`;
const USER = `${BASE}/auth/v1/user`;

describe("isDefinitiveAuthRejection: GoTrue's codes, never a bare 4xx", () => {
  it("definitive: a missing session, a token that fails verification, GoTrue's session/refresh/user codes", () => {
    expect(isDefinitiveAuthRejection(new AuthSessionMissingError())).toBe(true);
    expect(isDefinitiveAuthRejection(new AuthInvalidJwtError("Invalid JWT signature"))).toBe(true);
    for (const code of DEFINITIVE_AUTH_CODES) {
      expect(isDefinitiveAuthRejection(new AuthApiError("refused", 400, code)), code).toBe(true);
      expect(isDefinitiveAuthRejection(new AuthApiError("refused", 403, code)), code).toBe(true);
    }
  });

  it("not definitive: uncoded 4xx (gateway 400, Kong 401/404), no_authorization, 408, 429, 5xx, network, unknown", () => {
    expect(isDefinitiveAuthRejection(new AuthApiError("Bad Request", 400, undefined))).toBe(false);
    expect(isDefinitiveAuthRejection(new AuthApiError("Invalid API key", 401, undefined))).toBe(false);
    expect(isDefinitiveAuthRejection(new AuthApiError("no Route matched with those values", 404, undefined))).toBe(false);
    expect(isDefinitiveAuthRejection(new AuthApiError("This endpoint requires a valid Bearer token", 401, "no_authorization"))).toBe(false);
    expect(isDefinitiveAuthRejection(new AuthApiError("slow down", 429, "over_request_rate_limit"))).toBe(false);
    expect(isDefinitiveAuthRejection(new AuthApiError("timeout", 408, "refresh_token_not_found"))).toBe(false);
    expect(isDefinitiveAuthRejection(new AuthApiError("boom", 505, "session_not_found"))).toBe(false);
    expect(isDefinitiveAuthRejection(new AuthApiError("other", 422, "weak_password"))).toBe(false);
    expect(isDefinitiveAuthRejection(new AuthRetryableFetchError("fetch failed", 0))).toBe(false);
    expect(isDefinitiveAuthRejection(new AuthUnknownError("not json", new SyntaxError("x")))).toBe(false);
    expect(isDefinitiveAuthRejection(new TypeError("fetch failed"))).toBe(false);
    expect(isDefinitiveAuthRejection(undefined)).toBe(false);
  });
});

describe("classifyAuthAnswer mirrors auth-js's reading of an answer", () => {
  it("reads body.code only with GoTrue's API-version header, else body.error_code", () => {
    expect(classifyAuthAnswer(200, {})).toBe("ok");
    expect(classifyAuthAnswer(400, { code: "refresh_token_not_found" }, "2024-01-01")).toBe("definitive");
    expect(classifyAuthAnswer(400, { code: "refresh_token_not_found" }, null), "no header: auth-js ignores body.code").toBe("unavailable");
    expect(classifyAuthAnswer(400, { code: 400, error_code: "refresh_token_not_found" }, null)).toBe("definitive");
    expect(classifyAuthAnswer(403, { code: "session_not_found" }, "2024-01-01")).toBe("definitive");
    expect(classifyAuthAnswer(401, { message: "Invalid API key" }, null)).toBe("unavailable");
    expect(classifyAuthAnswer(404, { message: "no Route matched with those values" }, null)).toBe("unavailable");
    expect(classifyAuthAnswer(401, { code: "no_authorization" }, "2024-01-01")).toBe("unavailable");
    expect(classifyAuthAnswer(429, { code: "over_request_rate_limit" }, "2024-01-01")).toBe("unavailable");
    expect(classifyAuthAnswer(403, null, null), "not JSON").toBe("unavailable");
    expect(classifyAuthAnswer(503, { code: "session_not_found" }, "2024-01-01")).toBe("unavailable");
    expect(classifyAuthAnswer(400, { code: "refresh_token_not_found" }, "2023-12-31")).toBe("unavailable");
    expect(classifyAuthAnswer(400, { code: "refresh_token_not_found" }, "garbage")).toBe("unavailable");
  });
});

const goTrue = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "x-supabase-api-version": "2024-01-01" } });

describe("createAuthTransport", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.useRealTimers();
  });

  it("records each Auth answer's outcome; keepSessionCookies drops auth-cookie deletions only after 'unavailable'", async () => {
    const answers = [goTrue(429, { code: "over_request_rate_limit" }), goTrue(400, { code: "refresh_token_not_found" }), new Response("{}", { status: 200 })];
    globalThis.fetch = vi.fn(async () => answers.shift()!) as typeof fetch;
    const t = createAuthTransport({ supabaseUrl: BASE });
    const writes = [
      { name: "sb-127-auth-token", value: "", options: { maxAge: 0 } },
      { name: "sb-127-auth-token.0", value: "", options: { maxAge: 0 } },
      { name: "sb-127-auth-token-code-verifier", value: "", options: { maxAge: 0 } },
      { name: "sb-127-auth-token.1", value: "", options: { expires: new Date(0) } },
      { name: "other", value: "", options: { maxAge: 0 } },
    ];
    expect(t.outcome()).toBe("none");
    expect(keepSessionCookies(t, writes)).toEqual(writes);
    await t.fetch(REFRESH, { method: "POST", body: "{}" });
    expect(t.outcome()).toBe("unavailable");
    expect(keepSessionCookies(t, writes)).toEqual([writes[4]]);
    await t.fetch(REFRESH, { method: "POST", body: "{}" });
    expect(t.outcome()).toBe("definitive");
    expect(keepSessionCookies(t, writes)).toEqual(writes);
    await t.fetch(USER);
    expect(t.outcome()).toBe("ok");
    const refreshed = [{ name: "sb-127-auth-token", value: "base64-x", options: { maxAge: 100 } }];
    expect(keepSessionCookies(t, refreshed)).toEqual(refreshed);
  });

  it("a thrown network error is 'unavailable' and is rethrown (auth-js maps it to a retryable error)", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    const t = createAuthTransport({ supabaseUrl: BASE });
    await expect(t.fetch(USER)).rejects.toThrow("fetch failed");
    expect(t.outcome()).toBe("unavailable");
  });

  it("a call still running at the deadline is aborted and answered 408 (synthetic); later calls get it without a request", async () => {
    vi.useFakeTimers();
    let aborted = false;
    const fetchImpl = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            aborted = true;
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    );
    globalThis.fetch = fetchImpl as unknown as typeof fetch;
    const t = createAuthTransport({ supabaseUrl: BASE });
    const pending = t.fetch(USER);
    await vi.advanceTimersByTimeAsync(AUTH_REQUEST_BUDGET_MS);
    const answer = await pending;
    expect(answer.status).toBe(408);
    expect(await answer.json()).toMatchObject({ code: AUTH_UNAVAILABLE_CODE });
    expect(aborted).toBe(true);
    expect(t.outcome()).toBe("unavailable");
    const later = await t.fetch(REFRESH, { method: "POST", body: "{}" });
    expect(later.status).toBe(408);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    t.restartBudget();
    fetchImpl.mockImplementationOnce(async () => new Response("{}", { status: 200 }));
    expect((await t.fetch(USER)).status, "a new budget sends again").toBe(200);
  });

  it("a refresh failing retryably is cut once auth-js's next back-off sleep would pass the deadline", async () => {
    let clock = 0;
    globalThis.fetch = vi.fn(async () => new Response("{}", { status: 503 })) as typeof fetch;
    const t = createAuthTransport({ supabaseUrl: BASE, now: () => clock });
    // auth-js: attempt n fails → sleep 200 × 2^n → attempt n + 1. Fast failures at t = 0, 0.2, 0.6, 1.4, 3.0 s.
    const statuses: number[] = [];
    for (const at of [0, 200, 600, 1400, 3000]) {
      clock = at;
      statuses.push((await t.fetch(REFRESH, { method: "POST", body: "{}" })).status);
    }
    // After the 5th failure (3.0 s) the next sleep (3.2 s) ends past 3.5 s: the 408 ends the loop now.
    expect(statuses).toEqual([503, 503, 503, 503, 408]);
    expect(t.outcome()).toBe("unavailable");
  });

  it("under the proxy's mark, /user and the refresh grant are answered at once; sign-in, sign-out and PostgREST are sent", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    globalThis.fetch = fetchImpl as unknown as typeof fetch;
    const t = createAuthTransport({ supabaseUrl: BASE, unavailable: true });
    expect((await t.fetch(USER)).status).toBe(408);
    expect((await t.fetch(REFRESH, { method: "POST", body: "{}" })).status).toBe(408);
    expect(fetchImpl).not.toHaveBeenCalled();
    await t.fetch(`${BASE}/auth/v1/token?grant_type=password`, { method: "POST", body: "{}" });
    await t.fetch(`${BASE}/auth/v1/logout?scope=local`, { method: "POST" });
    await t.fetch(`${BASE}/rest/v1/memberships?select=*`);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});
