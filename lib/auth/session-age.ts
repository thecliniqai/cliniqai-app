/**
 * How a session was established, from its JWT `amr` claim (V2-03 03-12a A00-5; 03-13a H-AUTH, L-2). Pure and
 * client-safe: `proxy.ts` and `features/auth/service.ts` both use it.
 *
 * A session established with an emailed code (OTP sign-in, recovery, invite, magic link, signup or email-change
 * verification) proves control of the mailbox, not knowledge of the password. Supabase exempts such sessions from
 * "require current password" at any age (AUTH-00 E5) and a recovery session's `amr` reads `otp` (E1b); the `amr`
 * timestamp survives every refresh (E7). So such a session may live only {@link FRESH_MAILBOX_SESSION_SECONDS} after
 * the code was used: `proxy.ts` ends it after that (H-AUTH), and the password actions refuse it (A00-5).
 *
 * Fail closed (L-2): only the methods in {@link NON_MAILBOX_METHODS} count as "not an emailed code". Any other method,
 * including one this file has never heard of, is treated as an emailed code. A session whose newest password sign-in
 * is LATER than its newest emailed-code factor counts as a password session (the password was proven after the code).
 */

/** A00-5 / AUTH §3.5: seconds an emailed-code session may live after the code was used. */
export const FRESH_MAILBOX_SESSION_SECONDS = 600;

/** Clock skew tolerated for a timestamp slightly in the future (seconds). */
export const CLOCK_SKEW_SECONDS = 30;

/**
 * `amr` methods that do not prove only mailbox control (GoTrue models/amr.go): the password grant and the MFA factors
 * stepped up on top of a session. Everything else is treated as an emailed code.
 *
 * 03-13e: GoTrue applies the same list and bound before it mints any token, through the Custom Access Token hook
 * `private.session_age_token_hook` (migration 000030: `private.session_age_non_mailbox_methods()`,
 * `private.session_age_fresh_seconds()`). Change both together: tests/auth/session-age-token-hook-db.spec.ts fails
 * when they differ.
 */
export const NON_MAILBOX_METHODS: ReadonlySet<string> = new Set(["password", "totp", "mfa/totp", "mfa/phone", "mfa/webauthn"]);

/** Methods that prove the password itself (a later one supersedes an emailed code). */
const PASSWORD_METHODS: ReadonlySet<string> = new Set(["password"]);

export type SessionAuth =
  /** No emailed-code factor newer than the newest password sign-in. */
  | { kind: "password" }
  /** Established (or stepped up) with an emailed code (or an unknown method); `ageSeconds` since the newest one. */
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
  const mailbox = entries.filter((e) => !NON_MAILBOX_METHODS.has(e.method));
  if (mailbox.length === 0) return { kind: "password" };
  const newestMailbox = Math.max(...mailbox.map((e) => e.timestamp));
  const passwords = entries.filter((e) => PASSWORD_METHODS.has(e.method));
  if (passwords.length > 0 && Math.max(...passwords.map((e) => e.timestamp)) > newestMailbox) return { kind: "password" };
  return { kind: "mailbox", ageSeconds: Math.floor(nowMs / 1000) - newestMailbox };
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
  return auth.kind === "mailbox" && auth.ageSeconds >= -CLOCK_SKEW_SECONDS && auth.ageSeconds <= maxAgeSeconds;
}

/**
 * H-AUTH: true when the proxy must end this session. An emailed-code session older than the bound, and a session
 * whose `amr` cannot be read (fail closed). A password session never expires here (Supabase's own lifetime applies).
 */
export function sessionMustEnd(amr: unknown, nowMs: number = Date.now()): boolean {
  const auth = sessionAuthFrom(amr, nowMs);
  if (auth.kind === "unknown") return true;
  return auth.kind === "mailbox" && auth.ageSeconds > FRESH_MAILBOX_SESSION_SECONDS;
}

/** The cookies `@supabase/ssr` stores a session in (single or chunked, plus the PKCE verifier). */
export const SUPABASE_AUTH_COOKIE = /^sb-[a-z0-9-]+-auth-token(?:-code-verifier)?(?:\.\d+)?$/;

export function isSupabaseAuthCookie(name: string): boolean {
  return SUPABASE_AUTH_COOKIE.test(name);
}
