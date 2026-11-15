/**
 * V2-06 06-09d (H-AUTHOUT-R1, L-R1): which Supabase Auth failures are a definitive "no valid session" (sign out) and
 * which are "Auth could not answer" (keep the session, answer 503 / show the unavailable state). Pure: `proxy.ts`,
 * `lib/supabase/auth-transport.ts` and `lib/auth/tenant.ts` share it.
 *
 * Only GoTrue's own error codes are definitive, never an HTTP status alone. A gateway in front of GoTrue answers 4xx
 * too (Kong's 401 "Invalid API key" on a key rotation, its 404 "no Route matched", a proxy's uncoded 400), and so does
 * GoTrue itself for "try later" (429 `over_request_rate_limit`, 408). Treating any of those as "signed out" would sign
 * out, and purge, every device at once. A missing session (no cookie, or `session_not_found`, which auth-js turns into
 * `AuthSessionMissingError`) and a token that fails local verification (`AuthInvalidJwtError`) are definitive too.
 */

/**
 * GoTrue error codes that mean this session (or its refresh token, or its user) is gone for good
 * (`@supabase/auth-js` `ErrorCode`). Anything else, coded or not, is retryable. Only the session calls are classified
 * (`GET /user`, the refresh-token grant, `getClaims`), so `validation_failed` can only be GoTrue refusing the refresh
 * token itself (local GoTrue: "Refresh token is not valid" for a malformed one). Not `no_authorization`: auth-js never
 * sends a session call without a bearer (it answers `AuthSessionMissingError` itself), so GoTrue saying "no bearer" to
 * one means a gateway dropped the header, which must not sign the fleet out.
 */
export const DEFINITIVE_AUTH_CODES: ReadonlySet<string> = new Set([
  "session_not_found",
  "session_expired",
  "refresh_token_not_found",
  "refresh_token_already_used",
  "validation_failed",
  "bad_jwt",
  "user_not_found",
  "user_banned",
]);

/**
 * auth-js reads `body.code` only from answers of API version 2024-01-01 or later (its `X-Supabase-Api-Version`). The
 * version is a calendar date (YYYY-MM-DD), so a valid one compares as a string.
 */
const API_VERSION = /^2[0-9]{3}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;
const CODE_IN_BODY_SINCE = "2024-01-01";

/** A GoTrue refusal status: 4xx other than 408 (timeout) and 429 (rate limit), which are "try later". */
function isRefusalStatus(status: number): boolean {
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

/**
 * Whether an error from `auth.getUser()` / `auth.getClaims()` is a definitive "no valid session" (401, sign out)
 * rather than a failure to check (503). auth-js marks its errors with `__isAuthError` and names them (its own
 * `isAuth…Error` guards read the same fields; a value import from the Supabase packages is not allowed here, P1-34).
 * An `AuthApiError` is definitive only with a GoTrue refusal status AND one of {@link DEFINITIVE_AUTH_CODES}.
 */
export function isDefinitiveAuthRejection(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("__isAuthError" in error)) return false;
  const { name, status, code } = error as { name?: unknown; status?: unknown; code?: unknown };
  if (name === "AuthSessionMissingError" || name === "AuthInvalidJwtError") return true;
  if (name === "AuthRetryableFetchError") return false;
  return typeof status === "number" && isRefusalStatus(status) && typeof code === "string" && DEFINITIVE_AUTH_CODES.has(code);
}

/** What one answer of the Auth API means for the session. */
export type AuthAnswerOutcome = "ok" | "definitive" | "unavailable";

/**
 * Classifies an HTTP answer of `/auth/v1/*` the same way {@link isDefinitiveAuthRejection} classifies the error auth-js
 * builds from it (`handleError`, auth-js 2.117): the code is `body.code` when the answer's `X-Supabase-Api-Version` is
 * 2024-01-01 or later and `body.code` is a string, else `body.error_code`. A body that is not JSON (`body` null) or
 * carries no definitive code is never definitive.
 */
export function classifyAuthAnswer(status: number, body: unknown, apiVersion: string | null = null): AuthAnswerOutcome {
  if (status >= 200 && status < 300) return "ok";
  if (!isRefusalStatus(status) || typeof body !== "object" || body === null) return "unavailable";
  const record = body as { code?: unknown; error_code?: unknown };
  const versioned = apiVersion !== null && API_VERSION.test(apiVersion) && apiVersion >= CODE_IN_BODY_SINCE;
  const code =
    versioned && typeof record.code === "string" ? record.code : typeof record.error_code === "string" ? record.error_code : null;
  return code !== null && DEFINITIVE_AUTH_CODES.has(code) ? "definitive" : "unavailable";
}
