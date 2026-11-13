import { en } from "@/messages/en";

/**
 * Auth error catalogue (V2-03 03-12a, AUTH_REDESIGN §4.2, AUTH-00 spike pinned unit 1, A00-4).
 *
 * Every Supabase Auth failure the app can show is mapped by `error.code` to a fixed message from `messages/en.ts`.
 * The Supabase `error.message` is never read, shown, returned or logged (AD-7): it can carry internal detail. An
 * unknown or missing code gets the generic message. Client-safe (no server imports): the browser flows use it too.
 */

/** GoTrue error codes the catalogue maps (supabase-js `AuthError.code`). */
export const GOTRUE_ERROR_CODES = [
  "invalid_credentials",
  "email_not_confirmed",
  "over_request_rate_limit",
  "over_email_send_rate_limit",
  "otp_expired",
  "weak_password",
  "same_password",
  "captcha_failed",
  "current_password_required",
  "current_password_invalid",
  "user_already_exists",
  "otp_disabled",
  "signup_disabled",
  "session_not_found",
] as const;

/** Codes the app itself returns. */
export const APP_ERROR_CODES = ["pwned_password", "reauth_required"] as const;

export type GoTrueErrorCode = (typeof GOTRUE_ERROR_CODES)[number];
export type AppAuthErrorCode = (typeof APP_ERROR_CODES)[number];
export type AuthErrorCode = GoTrueErrorCode | AppAuthErrorCode;

export const AUTH_ERROR_MESSAGES: Readonly<Record<AuthErrorCode | "generic", string>> = en.auth.errors;

const KNOWN = new Set<string>([...GOTRUE_ERROR_CODES, ...APP_ERROR_CODES]);

export function isAuthErrorCode(code: unknown): code is AuthErrorCode {
  return typeof code === "string" && KNOWN.has(code);
}

/** The `code` of a Supabase Auth error (or any `{ code: string }`); never its message. */
export function authErrorCodeOf(error: unknown): string | undefined {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

/** The fixed message for `code`; anything outside the catalogue gets the generic message. */
export function authErrorMessage(code: unknown): string {
  return isAuthErrorCode(code) ? AUTH_ERROR_MESSAGES[code] : AUTH_ERROR_MESSAGES.generic;
}

/** A rate-limit refusal from GoTrue (HTTP 429): both codes share one "wait a minute" message (A00-4). */
export function isRateLimitCode(code: unknown): boolean {
  return code === "over_request_rate_limit" || code === "over_email_send_rate_limit";
}
