/**
 * AUTH-04a unit tests: password policy boundaries (AUTH_REDESIGN §5), the fixed error map (AD-7) and the
 * validate-before-verify ordering of the reset flow. 03-12a: the error catalogue (`features/auth/errors.ts` +
 * `messages/en.ts`, AUTH §4.2, A00-4) maps every listed code to its fixed copy and anything else to the generic
 * message; the change-password schemas. Pure: no network.
 */
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  APP_ERROR_CODES,
  AUTH_ERROR_MESSAGES,
  GOTRUE_ERROR_CODES,
  authErrorCodeOf,
  authErrorMessage,
  isRateLimitCode,
} from "@/features/auth/errors";
import { en } from "@/messages/en";
import {
  PASSWORD_TOO_LONG_MESSAGE,
  PASSWORD_TOO_SHORT_MESSAGE,
  PASSWORDS_DO_NOT_MATCH_MESSAGE,
  changePasswordFormSchema,
  changePasswordSchema,
  completeResetFormSchema,
  emailSchema,
  newPasswordSchema,
  recoveryCodeSchema,
  utf8ByteLength,
} from "@/features/auth/schemas";
import { AUTH_MESSAGES, completeReset, mapAuthError, requestReset, signIn } from "@/features/auth/password-flows";

function firstIssue(result: { success: boolean; error?: { issues: Array<{ message: string }> } }) {
  return result.success ? undefined : result.error?.issues[0]?.message;
}

describe("newPasswordSchema", () => {
  it("rejects 9 characters and accepts 10", () => {
    expect(firstIssue(newPasswordSchema.safeParse("a".repeat(9)))).toBe(PASSWORD_TOO_SHORT_MESSAGE);
    expect(newPasswordSchema.safeParse("a".repeat(10)).success).toBe(true);
  });

  it("counts characters, not UTF-16 units or bytes, for the minimum", () => {
    const tenEmoji = "😀".repeat(10); // 10 characters, 20 UTF-16 units, 40 bytes
    const nineEmoji = "😀".repeat(9);
    expect(newPasswordSchema.safeParse(tenEmoji).success).toBe(true);
    expect(firstIssue(newPasswordSchema.safeParse(nineEmoji))).toBe(PASSWORD_TOO_SHORT_MESSAGE);
  });

  it("accepts exactly 72 UTF-8 bytes and rejects 73", () => {
    expect(newPasswordSchema.safeParse("a".repeat(72)).success).toBe(true);
    expect(firstIssue(newPasswordSchema.safeParse("a".repeat(73)))).toBe(PASSWORD_TOO_LONG_MESSAGE);
  });

  it("measures multibyte characters in bytes for the maximum", () => {
    const deva = "क"; // 3 bytes in UTF-8
    const at72 = deva.repeat(24);
    const at73 = deva.repeat(24) + "a";
    const at75 = deva.repeat(25); // 25 characters but 75 bytes
    expect(utf8ByteLength(at72)).toBe(72);
    expect(newPasswordSchema.safeParse(at72).success).toBe(true);
    expect(utf8ByteLength(at73)).toBe(73);
    expect(firstIssue(newPasswordSchema.safeParse(at73))).toBe(PASSWORD_TOO_LONG_MESSAGE);
    expect(firstIssue(newPasswordSchema.safeParse(at75))).toBe(PASSWORD_TOO_LONG_MESSAGE);
  });
});

describe("emailSchema and recoveryCodeSchema", () => {
  it("normalises email case and whitespace", () => {
    expect(emailSchema.parse("  Dr.Rao@Example.COM ")).toBe("dr.rao@example.com");
    expect(emailSchema.safeParse("not-an-email").success).toBe(false);
  });

  it("accepts exactly six digits", () => {
    expect(recoveryCodeSchema.safeParse("123456").success).toBe(true);
    for (const bad of ["12345", "1234567", "12345a", "", "12 3456"]) {
      expect(recoveryCodeSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("requires the confirmation to match", () => {
    const result = completeResetFormSchema.safeParse({
      email: "a@example.com",
      code: "123456",
      newPassword: "correct horse battery",
      confirmPassword: "correct horse batterY",
    });
    expect(firstIssue(result)).toBe(PASSWORDS_DO_NOT_MATCH_MESSAGE);
  });
});

describe("auth error catalogue (03-12a)", () => {
  const EXPECTED: Record<string, string> = {
    invalid_credentials: "Email or password is incorrect",
    email_not_confirmed: "Email or password is incorrect",
    over_request_rate_limit: "Too many attempts, please wait a minute",
    over_email_send_rate_limit: "Too many attempts, please wait a minute",
    otp_expired: "Code is wrong or expired",
    weak_password: "Choose a stronger password of at least 10 characters",
    same_password: "Choose a different password",
    captcha_failed: "We couldn't verify this request. Try again.",
    current_password_required: "Enter your current password",
    current_password_invalid: "Your current password is incorrect",
    user_already_exists: "We couldn't complete this request. Try signing in instead.",
    otp_disabled: "Sign-in with a code is not available. Use your password.",
    signup_disabled: "New accounts can't be created here. Ask your clinic for an invitation.",
    session_not_found: "Your session has ended. Please sign in again.",
    pwned_password: "This password has appeared in a data breach. Choose a different one.",
    reauth_required: "For your security, please sign in again before changing your password.",
  };

  it("covers exactly the AUTH §4.2 codes plus the two app codes", () => {
    expect([...GOTRUE_ERROR_CODES, ...APP_ERROR_CODES].sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it.each(Object.entries(EXPECTED))("maps %s to its fixed copy", (code, copy) => {
    expect(authErrorMessage(code)).toBe(copy);
    expect(AUTH_ERROR_MESSAGES[code as keyof typeof AUTH_ERROR_MESSAGES]).toBe(copy);
  });

  it("maps an unknown, missing or non-string code to the generic message", () => {
    for (const code of ["unexpected_failure", "", undefined, null, 42, { code: "x" }, "toString", "__proto__"]) {
      expect(authErrorMessage(code)).toBe(en.auth.errors.generic);
    }
  });

  it("A00-4: both GoTrue 429 codes share the one wait-a-minute message", () => {
    expect(isRateLimitCode("over_request_rate_limit")).toBe(true);
    expect(isRateLimitCode("over_email_send_rate_limit")).toBe(true);
    expect(isRateLimitCode("over_sms_send_rate_limit")).toBe(false);
    expect(authErrorMessage("over_request_rate_limit")).toBe(authErrorMessage("over_email_send_rate_limit"));
  });

  it("reads only error.code, never the message", () => {
    const error = Object.assign(new Error("User fixture@example.com exists (internal detail)"), { code: "weak_password" });
    expect(authErrorCodeOf(error)).toBe("weak_password");
    expect(authErrorCodeOf(new Error("no code"))).toBeUndefined();
    expect(authErrorCodeOf({ code: 7 })).toBeUndefined();
  });
});

describe("mapAuthError (browser flows)", () => {
  const SECRET_MESSAGE = "User fixture@example.com not found in auth.users (internal detail)";
  const err = (code?: string) => Object.assign(new Error(SECRET_MESSAGE), { code, status: 400 });

  it.each([
    ["invalid_credentials", "sign_in", "invalid_credentials", AUTH_MESSAGES.invalid_credentials],
    ["email_not_confirmed", "sign_in", "invalid_credentials", AUTH_MESSAGES.invalid_credentials],
    ["over_request_rate_limit", "sign_in", "rate_limited", AUTH_MESSAGES.rate_limited],
    ["over_request_rate_limit", "reset_request", "rate_limited", AUTH_MESSAGES.rate_limited],
    ["over_request_rate_limit", "verify_code", "rate_limited", AUTH_MESSAGES.rate_limited],
    ["over_email_send_rate_limit", "reset_request", "rate_limited", AUTH_MESSAGES.rate_limited],
    ["otp_expired", "verify_code", "code_invalid", AUTH_MESSAGES.code_invalid],
    ["captcha_failed", "sign_in", "captcha_failed", AUTH_MESSAGES.captcha_failed],
    ["captcha_failed", "reset_request", "captcha_failed", AUTH_MESSAGES.captcha_failed],
  ] as const)("maps %s during %s to a fixed message", (code, flow, expectedCode, expectedMessage) => {
    const mapped = mapAuthError(err(code), flow);
    expect(mapped).toEqual({ ok: false, code: expectedCode, message: expectedMessage });
  });

  it("the flow messages come from the catalogue", () => {
    expect(AUTH_MESSAGES.rate_limited).toBe(en.auth.errors.over_request_rate_limit);
    expect(AUTH_MESSAGES.code_invalid).toBe(en.auth.errors.otp_expired);
    expect(AUTH_MESSAGES.invalid_credentials).toBe(en.auth.errors.invalid_credentials);
  });

  it.each([
    ["sign_in", AUTH_MESSAGES.sign_in_failed],
    ["reset_request", AUTH_MESSAGES.reset_request_failed],
    ["verify_code", AUTH_MESSAGES.reset_failed],
  ] as const)("maps unknown, missing and non-error values during %s to the generic message", (flow, generic) => {
    for (const value of [err("unexpected_failure"), err(undefined), null, "boom", { code: 42 }]) {
      expect(mapAuthError(value, flow)).toEqual({ ok: false, code: "unknown", message: generic });
    }
  });

  it("never echoes the Supabase error message", () => {
    const codes = ["invalid_credentials", "otp_expired", "weak_password", "same_password", "captcha_failed", "whatever", undefined];
    const flows = ["sign_in", "reset_request", "verify_code"] as const;
    for (const code of codes) {
      for (const flow of flows) {
        const mapped = mapAuthError(err(code), flow);
        expect(Object.values(AUTH_MESSAGES)).toContain(mapped.message);
        expect(mapped.message).not.toContain("fixture@example.com");
        expect(mapped.message).not.toContain(SECRET_MESSAGE);
      }
    }
  });
});

describe("change-password schemas (03-12a)", () => {
  it("requires the current password and applies the new-password policy", () => {
    expect(changePasswordSchema.safeParse({ currentPassword: "", newPassword: "a".repeat(10) }).success).toBe(false);
    expect(firstIssue(changePasswordSchema.safeParse({ currentPassword: "x", newPassword: "short" }))).toBe(PASSWORD_TOO_SHORT_MESSAGE);
    expect(firstIssue(changePasswordSchema.safeParse({ currentPassword: "a".repeat(73), newPassword: "a".repeat(10) }))).toBe(
      PASSWORD_TOO_LONG_MESSAGE,
    );
    expect(changePasswordSchema.safeParse({ currentPassword: "x", newPassword: "a".repeat(10) }).success).toBe(true);
  });

  it("the form requires the confirmation to match", () => {
    const result = changePasswordFormSchema.safeParse({
      currentPassword: "current",
      newPassword: "correct horse battery",
      confirmPassword: "correct horse batterY",
    });
    expect(firstIssue(result)).toBe(PASSWORDS_DO_NOT_MATCH_MESSAGE);
  });
});

/** Synthetic, built at runtime (a password-shaped literal next to a password key trips gitleaks' generic rule). */
const SYNTHETIC_NEW_PASSWORD = ["Synthetic", "pass", String(123)].join("-");

describe("flows validate input before calling Supabase", () => {
  function fakeClient() {
    const auth = {
      signInWithPassword: vi.fn(),
      resetPasswordForEmail: vi.fn(),
      verifyOtp: vi.fn(),
      updateUser: vi.fn(),
      signOut: vi.fn(),
    };
    return { client: { auth } as unknown as Pick<SupabaseClient, "auth">, auth };
  }

  it("completeReset rejects a short or over-long password without using the code", async () => {
    const { client, auth } = fakeClient();
    const setPassword = vi.fn();
    for (const newPassword of ["short", "a".repeat(73)]) {
      const result = await completeReset(client, { email: "a@example.com", code: "123456", newPassword }, setPassword);
      expect(result).toMatchObject({ ok: false, code: "invalid_input", stage: "verify" });
    }
    expect(auth.verifyOtp).not.toHaveBeenCalled();
    expect(setPassword).not.toHaveBeenCalled();
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it("completeReset never sets the password in the browser: the server action does, after the code is verified", async () => {
    const { client, auth } = fakeClient();
    auth.verifyOtp.mockResolvedValue({ data: { session: { access_token: "t" } }, error: null });
    const pwned = { ok: false as const, code: "pwned_password" as const, message: en.auth.errors.pwned_password };
    const setPassword = vi.fn().mockResolvedValueOnce(pwned).mockResolvedValueOnce({ ok: true, otherSessionsSignedOut: true });
    const input = { email: "a@example.com", code: "123456", newPassword: SYNTHETIC_NEW_PASSWORD };

    expect(await completeReset(client, input, setPassword)).toEqual({ ...pwned, stage: "update" });
    expect(auth.verifyOtp).toHaveBeenCalledWith({ email: "a@example.com", token: "123456", type: "recovery" });
    expect(setPassword).toHaveBeenCalledWith({ newPassword: SYNTHETIC_NEW_PASSWORD });
    expect(await completeReset(client, input, setPassword)).toEqual({ ok: true, otherSessionsSignedOut: true });
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it("completeReset maps a thrown server action to the generic reset failure at the update stage", async () => {
    const { client, auth } = fakeClient();
    auth.verifyOtp.mockResolvedValue({ data: { session: { access_token: "t" } }, error: null });
    const result = await completeReset(
      client,
      { email: "a@example.com", code: "123456", newPassword: SYNTHETIC_NEW_PASSWORD },
      vi.fn().mockRejectedValue(new Error("network down")),
    );
    expect(result).toEqual({ ok: false, code: "unknown", message: AUTH_MESSAGES.reset_failed, stage: "update" });
  });

  it("signIn and requestReset reject a malformed email without a network call", async () => {
    const { client, auth } = fakeClient();
    expect(await signIn(client, { email: "nope", password: "x" })).toMatchObject({ ok: false, code: "invalid_input" });
    expect(await requestReset(client, { email: "nope" })).toMatchObject({ ok: false, code: "invalid_input" });
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
    expect(auth.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("signIn maps a thrown network error to the generic message", async () => {
    const { client, auth } = fakeClient();
    auth.signInWithPassword.mockRejectedValue(new Error("fetch failed: ECONNREFUSED 10.0.0.1"));
    expect(await signIn(client, { email: "a@example.com", password: "x" })).toEqual({
      ok: false,
      code: "unknown",
      message: AUTH_MESSAGES.sign_in_failed,
    });
  });
});
