import type { SupabaseClient } from "@supabase/supabase-js";
import { hardSignOut } from "@/lib/auth/hard-sign-out";
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
 *
 * CAPTCHA (03-12c, C43): when the page shows the Turnstile widget it passes `{ required: true, token }`. Without a
 * token the flow is refused here, before any request (Supabase would answer `captcha_failed`); with one, the token
 * goes to GoTrue as `options.captchaToken` (sent as `gotrue_meta_security.captcha_token`), and Supabase verifies it
 * with Cloudflare (no app-side siteverify). Tokens are single-use: the page resets the widget after every attempt.
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
  | "captcha_required"
  | "email_send_limited"
  | "unknown";

export type AuthFlowFailure = { ok: false; code: AuthFlowErrorCode; message: string };
export type AuthFlowResult = { ok: true } | AuthFlowFailure;

/** What the server action that sets the password answers (features/auth/actions.ts). */
export type SetPasswordResult =
  /** `signedOut`: this session was ended too (the reset, ruling R-35): the user signs in with the new password. */
  | { ok: true; otherSessionsSignedOut: boolean; signedOut?: boolean }
  | { ok: false; code: AuthErrorCode | "invalid_input" | "unknown"; message: string };

/** Outcome of the final reset step. `stage` says whether the recovery code was already used. */
export type CompleteResetResult =
  | { ok: true; otherSessionsSignedOut: boolean; signedOut?: boolean }
  | ((AuthFlowFailure | Extract<SetPasswordResult, { ok: false }>) & { stage: "verify" | "update" });

/** Fixed messages of these flows, all from the catalogue (`messages/en.ts`). */
export const AUTH_MESSAGES = {
  invalid_credentials: AUTH_ERROR_MESSAGES.invalid_credentials,
  rate_limited: AUTH_ERROR_MESSAGES.over_request_rate_limit,
  code_invalid: AUTH_ERROR_MESSAGES.otp_expired,
  weak_password: AUTH_ERROR_MESSAGES.weak_password,
  same_password: AUTH_ERROR_MESSAGES.same_password,
  captcha_failed: AUTH_ERROR_MESSAGES.captcha_failed,
  captcha_required: en.auth.captcha.required,
  sign_in_failed: en.auth.flows.sign_in_failed,
  reset_request_failed: en.auth.flows.reset_request_failed,
  reset_failed: en.auth.flows.reset_failed,
  reset_unconfirmed: en.auth.flows.reset_unconfirmed,
  reset_send_limited: en.auth.flows.reset_send_limited,
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

/** The page's CAPTCHA state: `required` when the Turnstile widget is on; `token` from its last success. */
export interface CaptchaInput {
  required: boolean;
  token?: string | null;
}

const CAPTCHA_REQUIRED: AuthFlowFailure = { ok: false, code: "captcha_required", message: AUTH_MESSAGES.captcha_required };

/** The token to send, `null` for none, or a refusal when the widget is on and gave no token. */
function captchaToken(captcha: CaptchaInput | undefined): string | null | AuthFlowFailure {
  const token = typeof captcha?.token === "string" && captcha.token.length > 0 ? captcha.token : null;
  if (captcha?.required && token === null) return CAPTCHA_REQUIRED;
  return token;
}

/** Email + password sign-in. A normal sign-in is a `/token` password grant only, so it sends no email. */
export async function signIn(client: AuthClient, input: SignInInput, captcha?: CaptchaInput): Promise<AuthFlowResult> {
  const parsed = signInSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);
  const token = captchaToken(captcha);
  if (token !== null && typeof token === "object") return token;

  try {
    const { data, error } = await client.auth.signInWithPassword(
      token === null ? parsed.data : { ...parsed.data, options: { captchaToken: token } },
    );
    if (error) return mapAuthError(error, "sign_in");
    if (!data.session) return mapAuthError(null, "sign_in");
    return { ok: true };
  } catch {
    return mapAuthError(null, "sign_in");
  }
}

/**
 * Step 1 of forgot password: request an 8-digit recovery code (R-36). No `redirectTo`: recovery is code-only.
 * The result is the same whether or not the account exists (Supabase `/recover` answers 200 either way).
 *
 * M-EMAILCAP (03-13a): `over_email_send_rate_limit` is NOT reported as success. GoTrue uses that one code both for the
 * per-address minimum interval and for the project-wide `email_sent` cap; when the cap is spent no email goes out for
 * anyone, and a "we've sent a code" notice would leave the user waiting for nothing. The page says "try again later"
 * instead. The per-address case reveals that the address requested a code in the last minute; GoTrue already answers
 * a direct `/recover` caller with that 429, so hiding it here protected nothing.
 */
export async function requestReset(
  client: AuthClient,
  input: ResetRequestInput,
  captcha?: CaptchaInput,
): Promise<AuthFlowResult> {
  const parsed = resetRequestSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);
  const token = captchaToken(captcha);
  if (token !== null && typeof token === "object") return token;

  try {
    const { error } =
      token === null
        ? await client.auth.resetPasswordForEmail(parsed.data.email)
        : await client.auth.resetPasswordForEmail(parsed.data.email, { captchaToken: token });
    if (error) {
      if (authErrorCodeOf(error) === "over_email_send_rate_limit") {
        return { ok: false, code: "email_send_limited", message: AUTH_MESSAGES.reset_send_limited };
      }
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
 * ends every session of the user, this one included (R-35: the user signs in with the new password). After a failure at the `update` stage the page retries `setPassword` alone.
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

/** What the browser learned about the recovery session after a save whose answer did not arrive. */
export type RecoverySessionProbe = "alive" | "gone" | "unknown";

/**
 * Asks Supabase Auth whether the recovery session the browser holds still exists (`auth.getUser()`: GoTrue checks the session, not just the
 * token). A successful reset revokes every session of the user, this one included (ruling R-35), so a session that GoTrue answers 401/403 or
 * `session_not_found` for was ended by the save; a user is a session that is still open (nothing saved); any other answer (a network error,
 * a timeout, 5xx, 429) tells nothing. Never reads an error message.
 */
export async function probeRecoverySession(client: AuthClient): Promise<RecoverySessionProbe> {
  try {
    const { data, error } = await client.auth.getUser();
    if (!error && data?.user) return "alive";
    if (!error) return "gone";
    const code = authErrorCodeOf(error);
    const status = (error as { status?: unknown }).status;
    const name = (error as { name?: unknown }).name;
    if (code === "session_not_found" || name === "AuthSessionMissingError" || status === 401 || status === 403) return "gone";
    return "unknown";
  } catch {
    return "unknown";
  }
}

export interface SaveRecheckDeps {
  /** The save (the server action). A throw is "no answer": the function ran or not, nobody knows. */
  save: (input: { newPassword: string }) => Promise<SetPasswordResult>;
  probe: () => Promise<RecoverySessionProbe>;
  /** Called once when the answer did not arrive and the page starts checking ("Checking whether your password was saved…"). */
  onChecking?: () => void;
}

/** The result of a save that went through although its answer was lost: the session is gone, as a reset leaves it. */
const SAVED_UNSEEN: SetPasswordResult = { ok: true, otherSessionsSignedOut: false, signedOut: true };
const UNCONFIRMED: SetPasswordResult = { ok: false, code: "unknown", message: AUTH_MESSAGES.reset_unconfirmed };

/**
 * The reset page's save, safe against a lost answer (staging finding of 2026-11-23: the first save stalled about 30 s, the page said "We
 * couldn't reset your password", and the password had in fact been saved). An answer that arrives is the outcome, success or failure. When the
 * call throws (a network failure, a function timeout) the outcome is unknown, so it is looked up before anything is claimed:
 *  1. the recovery session is gone  → the save went through (a reset ends signed out): success;
 *  2. the session is still open     → the save did not happen: it is tried once more, and a second silence is looked up the same way
 *     (a "session not found" answer to the retry means the first call finished meanwhile: success);
 *  3. the session check itself gave no answer (twice) → "We couldn't confirm that your password was changed ..." (never "failed").
 */
export async function saveWithRecheck(input: { newPassword: string }, deps: SaveRecheckDeps): Promise<SetPasswordResult> {
  try {
    return await deps.save(input);
  } catch {
    // no answer: fall through to the check
  }
  deps.onChecking?.();
  let state = await deps.probe();
  if (state === "unknown") state = await deps.probe();
  if (state === "gone") return SAVED_UNSEEN;
  if (state === "unknown") return UNCONFIRMED;
  try {
    const retried = await deps.save(input);
    // The first call was still running on the server and finished between our check and this call: its save ended the session.
    if (!retried.ok && retried.code === "session_not_found") return SAVED_UNSEEN;
    return retried;
  } catch {
    // a second silence
  }
  const after = await deps.probe();
  return after === "gone" ? SAVED_UNSEEN : after === "alive" ? { ok: false, code: "unknown", message: AUTH_MESSAGES.reset_failed } : UNCONFIRMED;
}

/**
 * Ends the recovery session on this device (user cancels after the code was accepted, a stale recovery session, or the
 * reset finished). Through `hardSignOut("recovery")` (V2-06 06-09a M-GUARD): the same server sign-out, local fallback,
 * device purge and other-tab signal as every exit, without navigating away from the page. This module runs in the
 * browser (it is imported by the "use client" auth pages), so it may not call `auth.signOut` itself.
 */
export async function abandonReset(): Promise<void> {
  try {
    await hardSignOut("recovery");
  } catch {
    // Nothing to report: hardSignOut reports its own failures and never leaves an auth cookie behind.
  }
}
