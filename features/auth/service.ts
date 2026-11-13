import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { isPwnedPassword, type PwnedResult } from "@/lib/auth/pwned";
import { errorTag, log } from "@/lib/log";
import { getRequestId } from "@/lib/log/request-id";
import { en } from "@/messages/en";
import { AUTH_ERROR_MESSAGES, authErrorCodeOf, type AuthErrorCode } from "./errors";
import type { SetPasswordResult } from "./password-flows";
import { changePasswordSchema, setNewPasswordSchema } from "./schemas";

/**
 * Password changes on the session user's own account (V2-03 03-12a: AUTH-04b change password, FT-05, A00-5, R-5).
 *
 * Both entry points read the caller from the request's cookie session (`getClaims()` on the request client); no user
 * id is ever taken from input and no service-role client is used. Order: authenticate → validate → session freshness
 * (A00-5) → breached-password check (FT-05) → `updateUser` → `signOut({ scope: "others" })`. Nothing is called on
 * Pwned Passwords for an unauthenticated caller, and nothing is written when any step refuses.
 *
 * A00-5: Supabase exempts sessions established through the mailbox (an emailed code: OTP sign-in, recovery, signup or
 * invite verification) from "require current password" at any age (AUTH-00 E5), and a recovery session's `amr` reads
 * `otp`, like an OTP sign-in (E1b). So a password may be changed from such a session only within
 * {@link FRESH_MAILBOX_SESSION_SECONDS} of the code being used; the `amr` timestamp survives refresh (E7), so a refresh
 * cannot reset the clock. Hosted Auth enforces the current password on password sessions (drift-checked, 03-11a); the
 * CLI stack cannot enable it (R-34), so locally a wrong current password is only rejected when GoTrue says so.
 */

/** A00-5 / AUTH §3.5: the window, in seconds, in which an emailed-code session may set a password. */
export const FRESH_MAILBOX_SESSION_SECONDS = 600;

/** `amr` methods that prove control of the mailbox rather than knowledge of the password (GoTrue models/amr.go). */
const MAILBOX_METHODS = new Set(["otp", "recovery", "magiclink", "invite", "email/signup", "email_change"]);

type AuthDb = Pick<SupabaseClient, "auth">;

export type SessionAuth =
  /** No emailed-code factor in the session: it was established with the password (or another non-mailbox factor). */
  | { kind: "password" }
  /** Established (or stepped up) with an emailed code; `ageSeconds` since the newest such factor. */
  | { kind: "mailbox"; ageSeconds: number }
  /** No readable `amr`: treated as stale (fail closed). */
  | { kind: "unknown" };

/** Classifies the session from its JWT `amr` claim. `nowMs` is injectable for tests. */
export function sessionAuthFrom(amr: unknown, nowMs: number = Date.now()): SessionAuth {
  if (!Array.isArray(amr) || amr.length === 0) return { kind: "unknown" };
  const entries = amr.filter(
    (e): e is { method: string; timestamp: number } =>
      !!e && typeof e === "object" && typeof e.method === "string" && Number.isFinite(e.timestamp),
  );
  if (entries.length !== amr.length) return { kind: "unknown" };
  const mailbox = entries.filter((e) => MAILBOX_METHODS.has(e.method));
  if (mailbox.length === 0) return { kind: "password" };
  const newest = Math.max(...mailbox.map((e) => e.timestamp));
  return { kind: "mailbox", ageSeconds: Math.floor(nowMs / 1000) - newest };
}

/**
 * A00-5 bound: true only for a session established with an emailed code at most `maxAgeSeconds` ago (a clock skew of
 * a few seconds into the future is tolerated). Password sessions and unreadable `amr` claims are not fresh OTP sessions.
 */
export function assertFreshOtpSession(
  amr: unknown,
  maxAgeSeconds: number = FRESH_MAILBOX_SESSION_SECONDS,
  nowMs: number = Date.now(),
): boolean {
  const auth = sessionAuthFrom(amr, nowMs);
  return auth.kind === "mailbox" && auth.ageSeconds >= -30 && auth.ageSeconds <= maxAgeSeconds;
}

type Failure = Extract<SetPasswordResult, { ok: false }>;

function fail(code: AuthErrorCode | "invalid_input" | "unknown", message?: string): Failure {
  const text =
    message ?? (code === "invalid_input" || code === "unknown" ? en.auth.flows.change_failed : AUTH_ERROR_MESSAGES[code]);
  return { ok: false, code, message: text };
}

/** GoTrue refusals of `updateUser({ password })` that the user can act on; anything else is the generic failure. */
const UPDATE_ERROR_CODES = new Set<AuthErrorCode>([
  "weak_password",
  "same_password",
  "current_password_required",
  "current_password_invalid",
  "over_request_rate_limit",
  "over_email_send_rate_limit",
  "session_not_found",
]);

function mapUpdateError(error: unknown): Failure {
  const code = authErrorCodeOf(error);
  // `secure_password_change` (off today) would answer `reauthentication_needed`.
  if (code === "reauthentication_needed") return fail("reauth_required");
  if (code && UPDATE_ERROR_CODES.has(code as AuthErrorCode)) return fail(code as AuthErrorCode);
  return fail("unknown");
}

export interface PasswordServiceDeps {
  /** The request's cookie-session client (default `createClient()` from `@/lib/supabase/server`). */
  db?: AuthDb;
  /** FT-05 check (default {@link isPwnedPassword} with the environment's settings). */
  checkPwned?: (password: string) => Promise<PwnedResult>;
  now?: () => number;
}

type Operation = "change_password" | "set_new_password";

async function sessionUser(db: AuthDb): Promise<{ userId: string; amr: unknown } | null> {
  try {
    const { data, error } = await db.auth.getClaims();
    const claims = data?.claims as { sub?: unknown; amr?: unknown } | undefined;
    if (error || !claims || typeof claims.sub !== "string" || claims.sub === "") return null;
    return { userId: claims.sub, amr: claims.amr };
  } catch {
    return null;
  }
}

async function updatePassword(
  op: Operation,
  db: AuthDb,
  userId: string,
  newPassword: string,
  currentPassword: string | undefined,
  checkPwned: (password: string) => Promise<PwnedResult>,
): Promise<SetPasswordResult> {
  // FT-05 before anything is written. `unavailable` is allowed (fail-open, logged by the check).
  if ((await checkPwned(newPassword)) === "pwned") {
    log.info({ event: "auth.password.rejected", action: op, reason: "pwned_password", userId });
    return fail("pwned_password");
  }

  try {
    const attrs =
      currentPassword === undefined ? { password: newPassword } : { password: newPassword, current_password: currentPassword };
    const { error } = await db.auth.updateUser(attrs);
    if (error) {
      const mapped = mapUpdateError(error);
      const status = (error as { status?: unknown }).status;
      log.info({
        event: "auth.password.rejected",
        action: op,
        reason: mapped.code,
        ...(typeof status === "number" ? { status } : {}),
        userId,
      });
      return mapped;
    }
  } catch (err) {
    log.warn({ event: "auth.password.update_failed", action: op, code: errorTag(err), requestId: await getRequestId() });
    return fail("unknown");
  }

  let otherSessionsSignedOut = false;
  try {
    const { error } = await db.auth.signOut({ scope: "others" });
    otherSessionsSignedOut = !error;
  } catch {
    otherSessionsSignedOut = false;
  }
  if (!otherSessionsSignedOut) {
    log.warn({ event: "auth.password.others_not_signed_out", action: op, userId, requestId: await getRequestId() });
  }
  log.info({ event: "auth.password.changed", action: op, userId, requestId: await getRequestId() });
  return { ok: true, otherSessionsSignedOut };
}

/**
 * Change password from `/profile`: the current password is always sent (hosted require-current-password checks it on
 * password sessions), and an emailed-code session older than 10 minutes must sign in again (A00-5).
 */
export async function changePassword(input: unknown, deps: PasswordServiceDeps = {}): Promise<SetPasswordResult> {
  const db = deps.db ?? (await createClient());
  const user = await sessionUser(db);
  if (!user) return fail("session_not_found");

  const parsed = changePasswordSchema.safeParse(input);
  if (!parsed.success) return fail("invalid_input", parsed.error.issues[0]?.message);

  const now = (deps.now ?? Date.now)();
  const auth = sessionAuthFrom(user.amr, now);
  const stale = auth.kind === "unknown" || (auth.kind === "mailbox" && !assertFreshOtpSession(user.amr, FRESH_MAILBOX_SESSION_SECONDS, now));
  if (stale) {
    log.info({ event: "auth.password.rejected", action: "change_password", reason: "reauth_required", userId: user.userId });
    return fail("reauth_required");
  }

  return updatePassword(
    "change_password",
    db,
    user.userId,
    parsed.data.newPassword,
    parsed.data.currentPassword,
    deps.checkPwned ?? ((p) => isPwnedPassword(p)),
  );
}

/**
 * Forgot-password final step: only on a session established with an emailed code at most 10 minutes ago (the browser
 * has just verified the recovery code, R-5). A plain password session is refused: it must use change password.
 */
export async function setNewPassword(input: unknown, deps: PasswordServiceDeps = {}): Promise<SetPasswordResult> {
  const db = deps.db ?? (await createClient());
  const user = await sessionUser(db);
  if (!user) return fail("session_not_found");

  const parsed = setNewPasswordSchema.safeParse(input);
  if (!parsed.success) return fail("invalid_input", parsed.error.issues[0]?.message);

  if (!assertFreshOtpSession(user.amr, FRESH_MAILBOX_SESSION_SECONDS, (deps.now ?? Date.now)())) {
    log.info({ event: "auth.password.rejected", action: "set_new_password", reason: "reauth_required", userId: user.userId });
    return fail("reauth_required", en.auth.flows.reset_session_stale);
  }

  return updatePassword(
    "set_new_password",
    db,
    user.userId,
    parsed.data.newPassword,
    undefined,
    deps.checkPwned ?? ((p) => isPwnedPassword(p)),
  );
}
