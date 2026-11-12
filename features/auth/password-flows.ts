import type { SupabaseClient } from "@supabase/supabase-js";
import {
  completeResetSchema,
  newPasswordSchema,
  resetRequestSchema,
  signInSchema,
  type CompleteResetInput,
  type ResetRequestInput,
  type SignInInput,
} from "./schemas";

/**
 * Password sign-in and forgot-password flows (AUTH-04a, AUTH_REDESIGN §3.3, §3.4).
 *
 * These run in the browser through `lib/supabase/client.ts` so Supabase's per-IP limits see the user's IP
 * (AUTH §2.4). They must never be given a service-role client: that skips CAPTCHA on `/token` (AUTH-00 E10).
 *
 * Errors are mapped to fixed strings. The Supabase `error.message` is never shown, returned or logged (AD-7).
 * The full error catalogue (`errors.ts`) arrives with AUTH-04b.
 */

type AuthClient = Pick<SupabaseClient, "auth">;

export type AuthFlowErrorCode =
  | "invalid_input"
  | "invalid_credentials"
  | "rate_limited"
  | "code_invalid"
  | "weak_password"
  | "same_password"
  | "unknown";

export type AuthFlowFailure = { ok: false; code: AuthFlowErrorCode; message: string };
export type AuthFlowResult = { ok: true } | AuthFlowFailure;

/** Outcome of setting the new password. `stage` says whether the recovery code was already used. */
export type CompleteResetResult =
  | { ok: true; otherSessionsSignedOut: boolean }
  | (AuthFlowFailure & { stage: "verify" | "update" });

export const AUTH_MESSAGES = {
  invalid_credentials: "Email or password is incorrect",
  rate_limited: "Too many attempts, please wait a minute",
  sign_in_failed: "Sign-in failed, try again",
  code_invalid: "Code is wrong or expired",
  weak_password: "Choose a stronger password of at least 10 characters",
  same_password: "Choose a different password",
  reset_request_failed: "We couldn't send the code, try again",
  reset_failed: "We couldn't reset your password, try again",
} as const;

type Flow = "sign_in" | "reset_request" | "verify_code" | "update_password";

const GENERIC_BY_FLOW: Record<Flow, string> = {
  sign_in: AUTH_MESSAGES.sign_in_failed,
  reset_request: AUTH_MESSAGES.reset_request_failed,
  verify_code: AUTH_MESSAGES.reset_failed,
  update_password: AUTH_MESSAGES.reset_failed,
};

function errorCodeOf(error: unknown): string | undefined {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

/**
 * Maps a Supabase Auth error to a fixed result. Only `error.code` is read; the message is ignored.
 * `email_not_confirmed` gets the same text as `invalid_credentials` so sign-in does not reveal which accounts exist.
 */
export function mapAuthError(error: unknown, flow: Flow): AuthFlowFailure {
  const code = errorCodeOf(error);
  switch (code) {
    case "invalid_credentials":
    case "email_not_confirmed":
      if (flow === "sign_in") {
        return { ok: false, code: "invalid_credentials", message: AUTH_MESSAGES.invalid_credentials };
      }
      break;
    case "over_request_rate_limit":
    case "over_email_send_rate_limit":
      return { ok: false, code: "rate_limited", message: AUTH_MESSAGES.rate_limited };
    case "otp_expired":
      if (flow === "verify_code") {
        return { ok: false, code: "code_invalid", message: AUTH_MESSAGES.code_invalid };
      }
      break;
    case "weak_password":
      if (flow === "update_password") {
        return { ok: false, code: "weak_password", message: AUTH_MESSAGES.weak_password };
      }
      break;
    case "same_password":
      if (flow === "update_password") {
        return { ok: false, code: "same_password", message: AUTH_MESSAGES.same_password };
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
      if (errorCodeOf(error) === "over_email_send_rate_limit") return { ok: true };
      return mapAuthError(error, "reset_request");
    }
    return { ok: true };
  } catch {
    return mapAuthError(null, "reset_request");
  }
}

/**
 * Sets the new password on a session that has just been established with a recovery code, then signs out every
 * other session for the user. Also used to retry after `completeReset` failed at the `update` stage.
 */
export async function setNewPassword(
  client: AuthClient,
  newPassword: string,
): Promise<{ ok: true; otherSessionsSignedOut: boolean } | AuthFlowFailure> {
  const parsed = newPasswordSchema.safeParse(newPassword);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);

  try {
    const { error } = await client.auth.updateUser({ password: parsed.data });
    if (error) return mapAuthError(error, "update_password");
  } catch {
    return mapAuthError(null, "update_password");
  }

  try {
    const { error } = await client.auth.signOut({ scope: "others" });
    return { ok: true, otherSessionsSignedOut: !error };
  } catch {
    return { ok: true, otherSessionsSignedOut: false };
  }
}

/**
 * Step 2 of forgot password. The input (including the new password) is validated before the code is used, so a
 * weak password does not burn the code. The code is verified with type `recovery` only: Supabase would also accept
 * a recovery code as `email`/`magiclink` (AUTH-00 E1), so the type is pinned here.
 */
export async function completeReset(client: AuthClient, input: CompleteResetInput): Promise<CompleteResetResult> {
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

  const updated = await setNewPassword(client, newPassword);
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
