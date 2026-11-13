/**
 * CAPTCHA wiring of the browser auth flows (V2-03 03-12c; C43, R-22). With the Turnstile widget on, sign-in and the
 * reset request without a token are refused before any Supabase call (Supabase would answer `captcha_failed`), and a
 * token is passed as `options.captchaToken` (supabase-js sends it as `gotrue_meta_security.captcha_token`; the e2e
 * spec tests/e2e/auth/turnstile.spec.ts checks the wire body). GoTrue's own `captcha_failed` maps to the catalogue copy.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { AUTH_MESSAGES, requestReset, signIn } from "@/features/auth/password-flows";
import { en } from "@/messages/en";

/** Synthetic, built at runtime (a password-shaped literal next to a password key trips gitleaks' generic rule). */
const SYNTHETIC_PASSWORD = ["Synthetic", "sign", "in", String(4242)].join("-");
const EMAIL = "captcha-unit@example.com";
const TOKEN = "XXXX.DUMMY.TOKEN.XXXX-1";

function fakeClient() {
  const auth = {
    signInWithPassword: vi.fn().mockResolvedValue({ data: { session: { access_token: "t" } }, error: null }),
    resetPasswordForEmail: vi.fn().mockResolvedValue({ data: {}, error: null }),
  };
  return { client: { auth } as unknown as Pick<SupabaseClient, "auth">, auth };
}

const REQUIRED = { ok: false, code: "captcha_required", message: en.auth.captcha.required };

describe("signIn with Turnstile", () => {
  it.each([[undefined], [null], [""]])("refuses a missing token (%j) without calling Supabase", async (token) => {
    const { client, auth } = fakeClient();
    expect(await signIn(client, { email: EMAIL, password: SYNTHETIC_PASSWORD }, { required: true, token })).toEqual(REQUIRED);
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it("passes the token as options.captchaToken", async () => {
    const { client, auth } = fakeClient();
    expect(await signIn(client, { email: EMAIL, password: SYNTHETIC_PASSWORD }, { required: true, token: TOKEN })).toEqual({ ok: true });
    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      email: EMAIL,
      password: SYNTHETIC_PASSWORD,
      options: { captchaToken: TOKEN },
    });
  });

  it("without the widget (no site key) signs in without a token, exactly as before", async () => {
    const { client, auth } = fakeClient();
    expect(await signIn(client, { email: EMAIL, password: SYNTHETIC_PASSWORD }, { required: false })).toEqual({ ok: true });
    expect(await signIn(client, { email: EMAIL, password: SYNTHETIC_PASSWORD })).toEqual({ ok: true });
    expect(auth.signInWithPassword).toHaveBeenNthCalledWith(1, { email: EMAIL, password: SYNTHETIC_PASSWORD });
    expect(auth.signInWithPassword).toHaveBeenNthCalledWith(2, { email: EMAIL, password: SYNTHETIC_PASSWORD });
  });

  it("maps GoTrue's captcha_failed to the catalogue copy (never the Supabase message)", async () => {
    const { client, auth } = fakeClient();
    auth.signInWithPassword.mockResolvedValue({
      data: { session: null },
      error: { code: "captcha_failed", message: "captcha protection: request disallowed (invalid-input-response)" },
    });
    const result = await signIn(client, { email: EMAIL, password: SYNTHETIC_PASSWORD }, { required: true, token: TOKEN });
    expect(result).toEqual({ ok: false, code: "captcha_failed", message: AUTH_MESSAGES.captcha_failed });
  });

  it("validates input before the CAPTCHA check (a malformed email never needs a token)", async () => {
    const { client, auth } = fakeClient();
    expect(await signIn(client, { email: "nope", password: "x" }, { required: true, token: null })).toMatchObject({
      ok: false,
      code: "invalid_input",
    });
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });
});

describe("requestReset with Turnstile", () => {
  it.each([[undefined], [null], [""]])("refuses a missing token (%j) without calling Supabase", async (token) => {
    const { client, auth } = fakeClient();
    expect(await requestReset(client, { email: EMAIL }, { required: true, token })).toEqual(REQUIRED);
    expect(auth.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("passes the token as captchaToken", async () => {
    const { client, auth } = fakeClient();
    expect(await requestReset(client, { email: EMAIL }, { required: true, token: TOKEN })).toEqual({ ok: true });
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith(EMAIL, { captchaToken: TOKEN });
  });

  it("without the widget requests the code with the email only", async () => {
    const { client, auth } = fakeClient();
    expect(await requestReset(client, { email: EMAIL })).toEqual({ ok: true });
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith(EMAIL);
  });

  it("maps GoTrue's captcha_failed to the catalogue copy", async () => {
    const { client, auth } = fakeClient();
    auth.resetPasswordForEmail.mockResolvedValue({ data: null, error: { code: "captcha_failed", message: "x" } });
    expect(await requestReset(client, { email: EMAIL }, { required: true, token: TOKEN })).toEqual({
      ok: false,
      code: "captcha_failed",
      message: AUTH_MESSAGES.captcha_failed,
    });
  });
});
