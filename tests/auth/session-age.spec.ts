/**
 * V2-03 03-13a (H-AUTH, review D L-2): how a session was established, from its `amr` claim. The proxy ends a session
 * when `sessionMustEnd` says so; the password actions apply the same classification (A00-5).
 *
 * Fails without the fix: before 03-13a an `amr` method outside a fixed mailbox list (a method the app had never heard
 * of) classified as a PASSWORD session, so it was never bounded (fail open), and nothing ended a stale emailed-code
 * session at all.
 */
import { describe, expect, it } from "vitest";
import {
  FRESH_MAILBOX_SESSION_SECONDS,
  assertFreshOtpSession,
  isSupabaseAuthCookie,
  sessionAuthFrom,
  sessionMustEnd,
} from "@/lib/auth/session-age";
import { sessionAuthFrom as serviceSessionAuthFrom } from "@/features/auth/service";

const NOW_MS = 1_800_000_000_000;
const NOW = NOW_MS / 1000;
const ago = (seconds: number) => NOW - seconds;

describe("sessionAuthFrom: fail closed on unknown methods (L-2)", () => {
  it.each(["otp", "recovery", "invite", "magiclink", "email/signup", "email_change"])(
    "%s is an emailed-code factor",
    (method) => {
      expect(sessionAuthFrom([{ method, timestamp: ago(30) }], NOW_MS)).toEqual({ kind: "mailbox", ageSeconds: 30 });
    },
  );

  it.each(["web3", "oauth", "sso/saml", "anonymous", "token_refresh", "some_future_method", ""])(
    "an unknown or non-password method (%j) counts as an emailed code, not a password",
    (method) => {
      expect(sessionAuthFrom([{ method, timestamp: ago(700) }], NOW_MS)).toEqual({ kind: "mailbox", ageSeconds: 700 });
      expect(sessionMustEnd([{ method, timestamp: ago(700) }], NOW_MS)).toBe(true);
    },
  );

  it.each(["password", "totp", "mfa/totp", "mfa/phone", "mfa/webauthn"])("%s alone is not an emailed code", (method) => {
    expect(sessionAuthFrom([{ method, timestamp: ago(86_400) }], NOW_MS)).toEqual({ kind: "password" });
    expect(sessionMustEnd([{ method, timestamp: ago(86_400) }], NOW_MS)).toBe(false);
  });

  it("an MFA step-up on a recovery session does not hide the emailed code", () => {
    const amr = [
      { method: "totp", timestamp: ago(10) },
      { method: "otp", timestamp: ago(700) },
    ];
    expect(sessionAuthFrom(amr, NOW_MS)).toEqual({ kind: "mailbox", ageSeconds: 700 });
    expect(sessionMustEnd(amr, NOW_MS)).toBe(true);
  });

  it("a LATER password sign-in supersedes the emailed code; an earlier one does not", () => {
    const later = [
      { method: "password", timestamp: ago(100) },
      { method: "otp", timestamp: ago(900) },
    ];
    expect(sessionAuthFrom(later, NOW_MS)).toEqual({ kind: "password" });
    expect(sessionMustEnd(later, NOW_MS)).toBe(false);
    const earlier = [
      { method: "password", timestamp: ago(900) },
      { method: "recovery", timestamp: ago(700) },
    ];
    expect(sessionAuthFrom(earlier, NOW_MS)).toEqual({ kind: "mailbox", ageSeconds: 700 });
    expect(sessionMustEnd(earlier, NOW_MS)).toBe(true);
  });

  it.each([[undefined], [null], [[]], ["otp"], [[{ method: "otp" }]], [[{ timestamp: NOW }]], [[{ method: "otp", timestamp: "x" }]]])(
    "an unreadable amr (%j) is unknown and must end",
    (amr) => {
      expect(sessionAuthFrom(amr, NOW_MS)).toEqual({ kind: "unknown" });
      expect(sessionMustEnd(amr, NOW_MS)).toBe(true);
      expect(assertFreshOtpSession(amr, FRESH_MAILBOX_SESSION_SECONDS, NOW_MS)).toBe(false);
    },
  );

  it("the service re-exports the same classifier (one rule for the proxy and the password actions)", () => {
    expect(serviceSessionAuthFrom).toBe(sessionAuthFrom);
  });
});

describe("sessionMustEnd: the 600 s bound (H-AUTH)", () => {
  it("keeps an emailed-code session up to 600 s and ends it after", () => {
    expect(FRESH_MAILBOX_SESSION_SECONDS).toBe(600);
    expect(sessionMustEnd([{ method: "otp", timestamp: ago(600) }], NOW_MS)).toBe(false);
    expect(sessionMustEnd([{ method: "otp", timestamp: ago(601) }], NOW_MS)).toBe(true);
    expect(sessionMustEnd([{ method: "recovery", timestamp: ago(7 * 86_400) }], NOW_MS)).toBe(true);
  });

  it("the newest emailed-code factor counts (a second code restarts the clock)", () => {
    const amr = [
      { method: "otp", timestamp: ago(5_000) },
      { method: "otp", timestamp: ago(60) },
    ];
    expect(sessionMustEnd(amr, NOW_MS)).toBe(false);
  });

  it("a timestamp slightly in the future (clock skew) is not ended", () => {
    expect(sessionMustEnd([{ method: "otp", timestamp: NOW + 20 }], NOW_MS)).toBe(false);
  });
});

describe("isSupabaseAuthCookie", () => {
  it.each(["sb-127-auth-token", "sb-127-auth-token.0", "sb-abcdefgh-auth-token.12", "sb-127-auth-token-code-verifier"])(
    "%s is an auth cookie",
    (name) => expect(isSupabaseAuthCookie(name)).toBe(true),
  );
  it.each(["theme", "sb-127-auth-tokenx", "xsb-127-auth-token", "sb-127-other"])("%s is not", (name) =>
    expect(isSupabaseAuthCookie(name)).toBe(false),
  );
});
