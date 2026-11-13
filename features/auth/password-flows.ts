import type { SupabaseClient } from "@supabase/supabase-js";
import { en } from "@/messages/en";
import { AUTH_ERROR_MESSAGES, authErrorCodeOf, isRateLimitCode, type AuthErrorCode } from "./errors";
import {
  completeResetSchema,
  resetRequestSchema,
  signInSchema,
  type CompleteResetInput,
  type ResetRequestInput,
  type SignInInput,
} from "./schemas";

/**
 * Password sign-in and forgot-password flows (AUTH-04a, AUTH_REDESIGN §3.3, §3.4; 03-12a).
 *
 * Sign-in, the reset request and the recovery-code check run in the browser through `lib/supabase/client.ts` so
 * Supabase's per-IP limits see the user's IP (AUTH §2.4, R-5). They must never be given a service-role client: that
 * skips CAPTCHA on `/token` (AUTH-00 E10). Setting the new password is NOT done here: it is the server action
 * `setNewPasswordAction` (features/auth/actions.ts), which checks the password against Pwned Passwords (FT-05) and the
 * recovery session's age (A00-5) before it calls `updateUser`; `completeReset` takes it as `setPassword`.
 *
 * Errors are mapped by code through the catalogue (`errors.ts`). The Supabase `error.message` is never shown,
 * returned or logged (AD-7).
 */

type AuthClient = Pick<SupabaseClient, "auth">;

export type AuthFlowErrorCode =
  | "invalid_input"
  | "invalid_credentials"
  | "rate_limited"
  | "code_invalid"
  | "weak_password"
  | "same_password"
  | "captcha_failed"
  | "unknown";

export type AuthFlowFailure = { ok: false; code: AuthFlowErrorCode; message: string };
export type AuthFlowResult = { ok: true } | AuthFlowFailure;

/** What the server action that sets the password answers (features/auth/actions.ts). */
export type SetPasswordResult =
  | { ok: true; otherSessionsSignedOut: boolean }
  | { ok: false; code: AuthErrorCode | "invalid_input" | "unknown"; message: string };

/** Outcome of the final reset step. `stage` says whether the recovery code was already used. */
export type CompleteResetResult =
  | { ok: true; otherSessionsSignedOut: boolean }
  | ((AuthFlowFailure | Extract<SetPasswordResult, { ok: false }>) & { stage: "verify" | "update" });

/** Fixed messages of these flows, all from the catalogue (`messages/en.ts`). */
export const AUTH_MESSAGES = {
  invalid_credentials: AUTH_ERROR_MESSAGES.invalid_credentials,
  rate_limited: AUTH_ERROR_MESSAGES.over_request_rate_limit,
  code_invalid: AUTH_ERROR_MESSAGES.otp_expired,
  weak_password: AUTH_ERROR_MESSAGES.weak_password,
  same_password: AUTH_ERROR_MESSAGES.same_password,
  captcha_failed: AUTH_ERROR_MESSAGES.captcha_failed,
  sign_in_failed: en.auth.flows.sign_in_failed,
  reset_request_failed: en.auth.flows.reset_request_failed,
  reset_failed: en.auth.flows.reset_failed,
} as const;

type Flow = "sign_in" | "reset_request" | "verify_code";

const GENERIC_BY_FLOW: Record<Flow, string> = {
  sign_in: AUTH_MESSAGES.sign_in_failed,
  reset_request: AUTH_MESSAGES.reset_request_failed,
  verify_code: AUTH_MESSAGES.reset_failed,
};

/**
 * Maps a Supabase Auth error to a fixed result. Only `error.code` is read; the message is ignored.
 * `email_not_confirmed` gets the same text as `invalid_credentials` so sign-in does not reveal which accounts exist.
 * Both rate-limit codes (HTTP 429) share one message (A00-4).
 */
export function mapAuthError(error: unknown, flow: Flow): AuthFlowFailure {
  const code = authErrorCodeOf(error);
  if (isRateLimitCode(code)) return { ok: false, code: "rate_limited", message: AUTH_MESSAGES.rate_limited };
  switch (code) {
    case "invalid_credentials":
    case "email_not_confirmed":
      if (flow === "sign_in") {
        return { ok: false, code: "invalid_credentials", message: AUTH_MESSAGES.invalid_credentials };
      }
      break;
    case "captcha_failed":
      return { ok: false, code: "captcha_failed", message: AUTH_MESSAGES.captcha_failed };
    case "otp_expired":
      if (flow === "verify_code") {
        return { ok: false, code: "code_invalid", message: AUTH_MESSAGES.code_invalid };
      }
      break;
  }
  return { ok: false, code: "unknown", message: GENERIC_BY_FLOW[flow] };
}

function invalidInput(message: string | undefined): AuthFlowFailure {
  return { ok: false, code: "invalid_input", message: message ?? "Check the form and try again" };
}

/** Email + password sign-in. A normal sign-in is a `/token` password grant only, so it sends no email. */
export async function signIn(client: AuthClient, input: SignInInput): Promise<AuthFlowResult> {
  const parsed = signInSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);

  try {
    const { data, error } = await client.auth.signInWithPassword(parsed.data);
    if (error) return mapAuthError(error, "sign_in");
    if (!data.session) return mapAuthError(null, "sign_in");
    return { ok: true };
  } catch {
    return mapAuthError(null, "sign_in");
  }
}

/**
 * Step 1 of forgot password: request a 6-digit recovery code. No `redirectTo`: recovery is code-only.
 * The result is the same whether or not the account exists (Supabase `/recover` answers 200 either way). The
 * per-address resend limit (`over_email_send_rate_limit`) can only trigger for an address that exists, so it is
 * also reported as success to avoid revealing the account.
 */
export async function requestReset(client: AuthClient, input: ResetRequestInput): Promise<AuthFlowResult> {
  const parsed = resetRequestSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);

  try {
    const { error } = await client.auth.resetPasswordForEmail(parsed.data.email);
    if (error) {
      if (authErrorCodeOf(error) === "over_email_send_rate_limit") return { ok: true };
      return mapAuthError(error, "reset_request");
    }
    return { ok: true };
  } catch {
    return mapAuthError(null, "reset_request");
  }
}

/**
 * Step 2 of forgot password. The input (including the new password) is validated before the code is used, so a
 * weak password does not burn the code. The code is verified in the browser with type `recovery` only (R-5; Supabase
 * would also accept a recovery code as `email`/`magiclink`, AUTH-00 E1, so the type is pinned here). That leaves a
 * fresh recovery session; `setPassword` (the `setNewPasswordAction` server action) then sets the password on it and
 * signs out every other session. After a failure at the `update` stage the page retries `setPassword` alone.
 */
export async function completeReset(
  client: AuthClient,
  input: CompleteResetInput,
  setPassword: (input: { newPassword: string }) => Promise<SetPasswordResult>,
): Promise<CompleteResetResult> {
  const parsed = completeResetSchema.safeParse(input);
  if (!parsed.success) return { ...invalidInput(parsed.error.issues[0]?.message), stage: "verify" };

  const { email, code, newPassword } = parsed.data;

  try {
    const { data, error } = await client.auth.verifyOtp({ email, token: code, type: "recovery" });
    if (error) return { ...mapAuthError(error, "verify_code"), stage: "verify" };
    if (!data.session) return { ...mapAuthError(null, "verify_code"), stage: "verify" };
  } catch {
    return { ...mapAuthError(null, "verify_code"), stage: "verify" };
  }

  let updated: SetPasswordResult;
  try {
    updated = await setPassword({ newPassword });
  } catch {
    updated = { ok: false, code: "unknown", message: AUTH_MESSAGES.reset_failed };
  }
  if (!updated.ok) return { ...updated, stage: "update" };
  return updated;
}

/** Ends the recovery session on this device only (user cancels after the code was accepted). */
export async function abandonReset(client: AuthClient): Promise<void> {
  try {
    await client.auth.signOut({ scope: "local" });
  } catch {
    // Nothing to report: the local session is cleared either way.
  }
}
