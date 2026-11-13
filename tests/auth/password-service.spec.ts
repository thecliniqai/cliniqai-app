/**
 * V2-03 03-12a unit tests for the password service behind `changePasswordAction` / `setNewPasswordAction`
 * (AUTH-04b, FT-05, A00-4 unit mapping, A00-5 bound). The auth client and the range check are fakes: these pin the
 * order of checks and the error mapping, including the GoTrue answers the CLI stack cannot produce (a wrong current
 * password needs hosted require-current-password, R-34; a 429 needs hosted per-IP limits, A00-4).
 * Synthetic passwords only; no assertion prints one.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { en } from "@/messages/en";
import type { PwnedResult } from "@/lib/auth/pwned";
import {
  FRESH_MAILBOX_SESSION_SECONDS,
  assertFreshOtpSession,
  changePassword,
  sessionAuthFrom,
  setNewPassword,
} from "@/features/auth/service";

const NOW = Date.UTC(2026, 10, 13, 6, 0, 0);
const nowSec = Math.floor(NOW / 1000);
const USER_ID = "00000000-0000-4000-8000-0000000000c1";
const CURRENT = "Synthetic-current-pass-1";
const NEXT = "Synthetic-next-pass-2";

type Amr = Array<{ method: string; timestamp: number }>;

function fakeAuth(amr: Amr | null, overrides: { updateError?: object | null; signOutError?: object | null } = {}) {
  const auth = {
    getClaims: vi.fn(async () =>
      amr === null ? { data: null, error: null } : { data: { claims: { sub: USER_ID, amr } }, error: null },
    ),
    updateUser: vi.fn(async () => ({ data: { user: {} }, error: overrides.updateError ?? null })),
    signOut: vi.fn(async () => ({ error: overrides.signOutError ?? null })),
  };
  return { db: { auth } as unknown as Pick<SupabaseClient, "auth">, auth };
}

const passwordSession: Amr = [{ method: "password", timestamp: nowSec - 3_600 }];
const otpSession = (ageSeconds: number): Amr => [{ method: "otp", timestamp: nowSec - ageSeconds }];
const clear = vi.fn<(password: string) => Promise<PwnedResult>>(async () => "clear");

let stderr: MockInstance;
let stdout: MockInstance;
const logs = () => [...stdout.mock.calls, ...stderr.mock.calls].map((c) => String(c[0])).join("");

beforeEach(() => {
  stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  clear.mockClear();
});
afterEach(() => {
  expect(logs()).not.toContain(CURRENT);
  expect(logs()).not.toContain(NEXT);
  vi.restoreAllMocks();
});

const deps = (db: Pick<SupabaseClient, "auth">, checkPwned: (password: string) => Promise<PwnedResult> = clear) => ({ db, checkPwned, now: () => NOW });

describe("changePassword", () => {
  it("unauthenticated: refused with the sign-in-again message; no range lookup, no update", async () => {
    const { db, auth } = fakeAuth(null);
    const result = await changePassword({ currentPassword: CURRENT, newPassword: NEXT }, deps(db));
    expect(result).toEqual({ ok: false, code: "session_not_found", message: en.auth.errors.session_not_found });
    expect(result.ok === false && /sign in/i.test(result.message)).toBe(true);
    expect(clear).not.toHaveBeenCalled();
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it("a valid change sends the current password, then signs out the other sessions", async () => {
    const { db, auth } = fakeAuth(passwordSession);
    expect(await changePassword({ currentPassword: CURRENT, newPassword: NEXT }, deps(db))).toEqual({
      ok: true,
      otherSessionsSignedOut: true,
    });
    expect(clear).toHaveBeenCalledWith(NEXT);
    expect(auth.updateUser).toHaveBeenCalledWith({ password: NEXT, current_password: CURRENT });
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "others" });
  });

  it("FT-05: a breached new password is refused before anything is written", async () => {
    const { db, auth } = fakeAuth(passwordSession);
    const pwned = vi.fn(async () => "pwned" as const);
    expect(await changePassword({ currentPassword: CURRENT, newPassword: NEXT }, deps(db, pwned))).toEqual({
      ok: false,
      code: "pwned_password",
      message: en.auth.errors.pwned_password,
    });
    expect(auth.updateUser).not.toHaveBeenCalled();
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it("FT-05 fail-open: with the range API unavailable the change goes ahead", async () => {
    const { db, auth } = fakeAuth(passwordSession);
    const down = vi.fn(async () => "unavailable" as const);
    expect(await changePassword({ currentPassword: CURRENT, newPassword: NEXT }, deps(db, down))).toMatchObject({ ok: true });
    expect(auth.updateUser).toHaveBeenCalledTimes(1);
  });

  it("a wrong current password (GoTrue current_password_invalid) is refused with its fixed copy; nobody is signed out", async () => {
    const leak = "Current password required when setting new password. user fixture@example.com";
    const { db, auth } = fakeAuth(passwordSession, {
      updateError: Object.assign(new Error(leak), { code: "current_password_invalid", status: 400 }),
    });
    const result = await changePassword({ currentPassword: "Synthetic-wrong-pass", newPassword: NEXT }, deps(db));
    expect(result).toEqual({ ok: false, code: "current_password_invalid", message: en.auth.errors.current_password_invalid });
    expect(auth.signOut).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("fixture@example.com");
    expect(logs()).not.toContain("fixture@example.com");
  });

  it("current_password_required maps to its fixed copy", async () => {
    const { db } = fakeAuth(passwordSession, { updateError: { code: "current_password_required", status: 400 } });
    expect(await changePassword({ currentPassword: CURRENT, newPassword: NEXT }, deps(db))).toEqual({
      ok: false,
      code: "current_password_required",
      message: en.auth.errors.current_password_required,
    });
  });

  it.each(["over_request_rate_limit", "over_email_send_rate_limit"])(
    "A00-4: a 429 from GoTrue (%s) maps to the wait-a-minute copy",
    async (code) => {
      const { db, auth } = fakeAuth(passwordSession, { updateError: { code, status: 429, message: "rate limit reached" } });
      const result = await changePassword({ currentPassword: CURRENT, newPassword: NEXT }, deps(db));
      expect(result).toEqual({ ok: false, code, message: "Too many attempts, please wait a minute" });
      expect(auth.signOut).not.toHaveBeenCalled();
      expect(logs()).toContain('"status":429');
    },
  );

  it.each([
    ["weak_password", en.auth.errors.weak_password],
    ["same_password", en.auth.errors.same_password],
    ["session_not_found", en.auth.errors.session_not_found],
  ])("GoTrue %s maps to its fixed copy", async (code, copy) => {
    const { db } = fakeAuth(passwordSession, { updateError: { code, status: 422 } });
    expect(await changePassword({ currentPassword: CURRENT, newPassword: NEXT }, deps(db))).toEqual({ ok: false, code, message: copy });
  });

  it("an unexpected GoTrue code or a thrown error gets the generic change failure", async () => {
    for (const updateError of [{ code: "unexpected_failure", status: 500 }, { status: 500 }]) {
      const { db } = fakeAuth(passwordSession, { updateError });
      expect(await changePassword({ currentPassword: CURRENT, newPassword: NEXT }, deps(db))).toEqual({
        ok: false,
        code: "unknown",
        message: en.auth.flows.change_failed,
      });
    }
    const { db, auth } = fakeAuth(passwordSession);
    auth.updateUser.mockRejectedValueOnce(new TypeError("fetch failed"));
    expect(await changePassword({ currentPassword: CURRENT, newPassword: NEXT }, deps(db))).toMatchObject({ ok: false, code: "unknown" });
  });

  it("A00-5: an emailed-code session older than 10 minutes must sign in again; at 10 minutes it may change", async () => {
    const stale = fakeAuth(otpSession(FRESH_MAILBOX_SESSION_SECONDS + 1));
    expect(await changePassword({ currentPassword: CURRENT, newPassword: NEXT }, deps(stale.db))).toEqual({
      ok: false,
      code: "reauth_required",
      message: en.auth.errors.reauth_required,
    });
    expect(stale.auth.updateUser).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();

    const fresh = fakeAuth(otpSession(FRESH_MAILBOX_SESSION_SECONDS));
    expect(await changePassword({ currentPassword: CURRENT, newPassword: NEXT }, deps(fresh.db))).toMatchObject({ ok: true });
    expect(fresh.auth.updateUser).toHaveBeenCalledWith({ password: NEXT, current_password: CURRENT });
  });

  it("an unreadable amr claim fails closed", async () => {
    for (const amr of [[], [{ method: "otp" }], [{ timestamp: nowSec }]] as unknown as Amr[]) {
      const { db, auth } = fakeAuth(amr);
      expect(await changePassword({ currentPassword: CURRENT, newPassword: NEXT }, deps(db))).toMatchObject({ code: "reauth_required" });
      expect(auth.updateUser).not.toHaveBeenCalled();
    }
  });

  it("invalid input is refused without a range lookup or an update", async () => {
    const { db, auth } = fakeAuth(passwordSession);
    for (const input of [{ currentPassword: "", newPassword: NEXT }, { currentPassword: CURRENT, newPassword: "short" }, null, "x"]) {
      expect(await changePassword(input, deps(db))).toMatchObject({ ok: false, code: "invalid_input" });
    }
    expect(clear).not.toHaveBeenCalled();
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it("reports otherSessionsSignedOut=false when signing out the other sessions fails", async () => {
    const { db } = fakeAuth(passwordSession, { signOutError: { code: "unexpected_failure", status: 500 } });
    expect(await changePassword({ currentPassword: CURRENT, newPassword: NEXT }, deps(db))).toEqual({
      ok: true,
      otherSessionsSignedOut: false,
    });
  });
});

describe("setNewPassword (forgot-password final step)", () => {
  it("a fresh recovery session sets the password without a current password and signs out the others", async () => {
    const { db, auth } = fakeAuth(otpSession(30));
    expect(await setNewPassword({ newPassword: NEXT }, deps(db))).toEqual({ ok: true, otherSessionsSignedOut: true });
    expect(auth.updateUser).toHaveBeenCalledWith({ password: NEXT });
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "others" });
  });

  it("FT-05: a breached password is refused before the update", async () => {
    const { db, auth } = fakeAuth(otpSession(30));
    const result = await setNewPassword({ newPassword: NEXT }, deps(db, vi.fn(async () => "pwned" as const)));
    expect(result).toEqual({ ok: false, code: "pwned_password", message: en.auth.errors.pwned_password });
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it("A00-5: a recovery session older than 10 minutes, or a plain password session, is refused", async () => {
    for (const amr of [otpSession(FRESH_MAILBOX_SESSION_SECONDS + 1), passwordSession]) {
      const { db, auth } = fakeAuth(amr);
      expect(await setNewPassword({ newPassword: NEXT }, deps(db))).toEqual({
        ok: false,
        code: "reauth_required",
        message: en.auth.flows.reset_session_stale,
      });
      expect(auth.updateUser).not.toHaveBeenCalled();
    }
  });

  it("unauthenticated is refused", async () => {
    const { db, auth } = fakeAuth(null);
    expect(await setNewPassword({ newPassword: NEXT }, deps(db))).toMatchObject({ ok: false, code: "session_not_found" });
    expect(auth.updateUser).not.toHaveBeenCalled();
  });
});

describe("session freshness (A00-5)", () => {
  it("classifies sessions by their amr methods", () => {
    expect(sessionAuthFrom(passwordSession, NOW)).toEqual({ kind: "password" });
    expect(sessionAuthFrom([{ method: "password", timestamp: nowSec - 10 }, { method: "totp", timestamp: nowSec }], NOW)).toEqual({
      kind: "password",
    });
    expect(sessionAuthFrom(otpSession(42), NOW)).toEqual({ kind: "mailbox", ageSeconds: 42 });
    for (const method of ["recovery", "magiclink", "invite", "email/signup", "email_change"]) {
      expect(sessionAuthFrom([{ method, timestamp: nowSec - 5 }], NOW)).toEqual({ kind: "mailbox", ageSeconds: 5 });
    }
    // A TOTP step-up after an emailed-code sign-in is still an emailed-code session, aged from the code.
    expect(sessionAuthFrom([{ method: "otp", timestamp: nowSec - 700 }, { method: "totp", timestamp: nowSec - 1 }], NOW)).toEqual({
      kind: "mailbox",
      ageSeconds: 700,
    });
    expect(sessionAuthFrom(undefined, NOW)).toEqual({ kind: "unknown" });
  });

  it("assertFreshOtpSession: 600 s is fresh, 601 s is not; password sessions are never fresh OTP sessions", () => {
    expect(assertFreshOtpSession(otpSession(600), 600, NOW)).toBe(true);
    expect(assertFreshOtpSession(otpSession(601), 600, NOW)).toBe(false);
    expect(assertFreshOtpSession(otpSession(0), 600, NOW)).toBe(true);
    expect(assertFreshOtpSession(otpSession(-3_600), 600, NOW)).toBe(false);
    expect(assertFreshOtpSession(passwordSession, 600, NOW)).toBe(false);
    expect(assertFreshOtpSession(null, 600, NOW)).toBe(false);
  });
});
