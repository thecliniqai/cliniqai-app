/**
 * AUTH-04a unit tests: password policy boundaries (AUTH_REDESIGN §5), the fixed error map (AD-7) and the
 * validate-before-verify ordering of the reset flow. Pure: no network.
 */
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  PASSWORD_TOO_LONG_MESSAGE,
  PASSWORD_TOO_SHORT_MESSAGE,
  PASSWORDS_DO_NOT_MATCH_MESSAGE,
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

describe("mapAuthError", () => {
  const SECRET_MESSAGE = "User fixture@example.com not found in auth.users (internal detail)";
  const err = (code?: string) => Object.assign(new Error(SECRET_MESSAGE), { code, status: 400 });

  it.each([
    ["invalid_credentials", "sign_in", "invalid_credentials", AUTH_MESSAGES.invalid_credentials],
    ["email_not_confirmed", "sign_in", "invalid_credentials", AUTH_MESSAGES.invalid_credentials],
    ["over_request_rate_limit", "sign_in", "rate_limited", AUTH_MESSAGES.rate_limited],
    ["over_request_rate_limit", "reset_request", "rate_limited", AUTH_MESSAGES.rate_limited],
    ["over_email_send_rate_limit", "reset_request", "rate_limited", AUTH_MESSAGES.rate_limited],
    ["otp_expired", "verify_code", "code_invalid", AUTH_MESSAGES.code_invalid],
    ["weak_password", "update_password", "weak_password", AUTH_MESSAGES.weak_password],
    ["same_password", "update_password", "same_password", AUTH_MESSAGES.same_password],
  ] as const)("maps %s during %s to a fixed message", (code, flow, expectedCode, expectedMessage) => {
    const mapped = mapAuthError(err(code), flow);
    expect(mapped).toEqual({ ok: false, code: expectedCode, message: expectedMessage });
  });

  it.each([
    ["sign_in", AUTH_MESSAGES.sign_in_failed],
    ["reset_request", AUTH_MESSAGES.reset_request_failed],
    ["verify_code", AUTH_MESSAGES.reset_failed],
    ["update_password", AUTH_MESSAGES.reset_failed],
  ] as const)("maps unknown, missing and non-error values during %s to the generic message", (flow, generic) => {
    for (const value of [err("unexpected_failure"), err(undefined), null, "boom", { code: 42 }]) {
      expect(mapAuthError(value, flow)).toEqual({ ok: false, code: "unknown", message: generic });
    }
  });

  it("never echoes the Supabase error message", () => {
    const codes = ["invalid_credentials", "otp_expired", "weak_password", "same_password", "whatever", undefined];
    const flows = ["sign_in", "reset_request", "verify_code", "update_password"] as const;
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
    for (const newPassword of ["short", "a".repeat(73)]) {
      const result = await completeReset(client, { email: "a@example.com", code: "123456", newPassword });
      expect(result).toMatchObject({ ok: false, code: "invalid_input", stage: "verify" });
    }
    expect(auth.verifyOtp).not.toHaveBeenCalled();
    expect(auth.updateUser).not.toHaveBeenCalled();
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
