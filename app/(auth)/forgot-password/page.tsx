"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, KeyRound } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { abandonReset, completeReset, requestReset, type SetPasswordResult } from "@/features/auth/password-flows";
import { setNewPasswordAction } from "@/features/auth/actions";
import { PASSWORDS_DO_NOT_MATCH_MESSAGE, RECOVERY_CODE_LENGTH, completeResetFormSchema } from "@/features/auth/schemas";
import { ClinicShowcasePanel } from "@/components/auth/clinic-showcase-panel";
import { TurnstileField, type TurnstileFieldHandle } from "@/components/auth/turnstile-field";
import { AuthMobileBrand, FormMessage, PasswordInput } from "@/components/auth/auth-form-parts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { useHydrated } from "@/lib/hooks/use-hydrated";
import { publicEnv } from "@/lib/env";
import { en } from "@/messages/en";

const RESEND_COOLDOWN_SECONDS = 60;
const SENT_NOTICE = `If an account exists for this email, we've sent an ${RECOVERY_CODE_LENGTH}-digit code. It can take a minute to arrive.`;
const RESET_FAILED = "We couldn't reset your password, try again";

/**
 * Sets the password through the server action (FT-05 breached-password check + 10-minute recovery-session bound,
 * 03-12a). A network failure is a failed attempt, not a thrown error.
 */
async function saveNewPassword(input: { newPassword: string }): Promise<SetPasswordResult> {
  try {
    return await setNewPasswordAction(input);
  } catch {
    return { ok: false, code: "unknown", message: RESET_FAILED };
  }
}

type Step = "request" | "reset" | "done";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [supabase] = useState(() => createClient());

  const [step, setStep] = useState<Step>("request");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPasswordValue] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const hydrated = useHydrated();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  // True once the code has been accepted but the new password was not saved yet (a recovery session exists).
  const [codeAccepted, setCodeAccepted] = useState(false);
  // 03-12c (C43): the reset request (`/recover`) carries a Turnstile token when a site key is configured. The request
  // step and the "Resend code" row each render their own widget (only one is mounted at a time).
  const siteKey = publicEnv.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const requestTurnstile = useRef<TurnstileFieldHandle>(null);
  const resendTurnstile = useRef<TurnstileFieldHandle>(null);

  const pendingRecovery = useRef(false);
  useEffect(() => {
    pendingRecovery.current = codeAccepted && step !== "done";
  }, [codeAccepted, step]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  // Leaving the page with an unfinished reset ends the recovery session on this device.
  useEffect(() => {
    return () => {
      if (pendingRecovery.current) void abandonReset(supabase);
    };
  }, [supabase]);

  const sendCode = async (turnstile: React.RefObject<TurnstileFieldHandle | null>) => {
    setError(null);
    setNotice(null);
    setLoading(true);
    const captchaToken = siteKey ? ((await turnstile.current?.token()) ?? null) : null;
    const result = await requestReset(supabase, { email }, { required: Boolean(siteKey), token: captchaToken });
    // Turnstile tokens are single-use: every attempt that used one needs a new one.
    if (captchaToken) turnstile.current?.reset();
    setLoading(false);
    if (!result.ok) {
      setError(result.message);
      return false;
    }
    setNotice(SENT_NOTICE);
    setCooldown(RESEND_COOLDOWN_SECONDS);
    return true;
  };

  const handleRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    if (await sendCode(requestTurnstile)) setStep("reset");
  };

  const handleResend = async () => {
    if (loading || cooldown > 0) return;
    await sendCode(resendTurnstile);
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setNotice(null);

    if (codeAccepted) {
      // Retry after the code was used: only the password update remains.
      if (newPassword !== confirmPassword) {
        setError(PASSWORDS_DO_NOT_MATCH_MESSAGE);
        return;
      }
      setLoading(true);
      const retried = await saveNewPassword({ newPassword });
      setLoading(false);
      if (!retried.ok) {
        if (retried.code === "reauth_required") await restartAfterStaleSession(retried.message);
        else setError(retried.message);
        return;
      }
      await finish(retried.otherSessionsSignedOut);
      return;
    }

    // Validate everything before the code is used, so a weak password does not burn it.
    const parsed = completeResetFormSchema.safeParse({ email, code, newPassword, confirmPassword });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the form and try again");
      return;
    }

    setLoading(true);
    const result = await completeReset(supabase, parsed.data, saveNewPassword);
    setLoading(false);
    if (!result.ok) {
      if (result.stage === "update" && result.code === "reauth_required") {
        await restartAfterStaleSession(result.message);
        return;
      }
      if (result.stage === "update") setCodeAccepted(true);
      setError(result.message);
      return;
    }
    await finish(result.otherSessionsSignedOut);
  };

  // The recovery session is older than the 10-minute bound (A00-5): end it here and start again with a new code.
  const restartAfterStaleSession = async (message: string) => {
    setCodeAccepted(false);
    await abandonReset(supabase);
    setCode("");
    setNewPasswordValue("");
    setConfirmPassword("");
    setCooldown(0);
    setStep("request");
    setError(message);
  };

  // Ruling R-35 (H-AUTH): the reset ends signed out. The server action has already revoked every session, the
  // recovery session included; clearing this device's copy as well covers a revocation that did not reach GoTrue.
  const finish = async (otherSessionsSignedOut: boolean) => {
    setCodeAccepted(false);
    await abandonReset(supabase);
    setStep("done");
    setNotice(otherSessionsSignedOut ? null : "We could not sign out your other devices. Sign out on them too.");
  };

  const handleCancel = async () => {
    if (codeAccepted) {
      setCodeAccepted(false);
      await abandonReset(supabase);
    }
    router.replace("/login");
  };

  return (
    <main className="min-h-screen w-full flex flex-col lg:flex-row bg-white">
      <ClinicShowcasePanel />

      <div className="w-full lg:w-1/2 min-h-screen flex items-center justify-center p-6 sm:p-12 xl:p-16 bg-white">
        <div className="w-full max-w-md mx-auto space-y-7">
          <AuthMobileBrand />

          <div>
            <div className="w-11 h-11 rounded-2xl bg-blue-50 border border-blue-100 text-[#1769E0] flex items-center justify-center mb-4 shadow-2xs">
              <KeyRound className="w-5 h-5" aria-hidden="true" />
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-gray-900">
              {step === "request" ? "Reset your password" : step === "reset" ? "Set a new password" : "Password changed"}
            </h1>
            <p className="text-sm text-gray-500 mt-1.5">
              {step === "request"
                ? `Enter your clinic email and we'll send you an ${RECOVERY_CODE_LENGTH}-digit code.`
                : step === "reset"
                  ? "Enter the code from the email and choose a new password."
                  : en.auth.flows.reset_done}
            </p>
          </div>

          <FormMessage id="reset-error" tone="error" message={error} />
          <FormMessage id="reset-notice" tone="info" message={notice} />

          {step === "request" && (
            <form method="post" onSubmit={handleRequest} className="space-y-4" noValidate aria-describedby="reset-error">
              <Field label="Email" htmlFor="email" required>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@clinic.com"
                  required
                  autoFocus
                  className="h-11"
                />
              </Field>

              <TurnstileField ref={requestTurnstile} siteKey={siteKey} id="reset-request-turnstile" action="password-reset" />

              <Button type="submit" variant="primary" loading={loading} disabled={!hydrated} className="w-full h-11 text-sm font-semibold">
                Send code
              </Button>
            </form>
          )}

          {step === "reset" && (
            <form
              method="post"
              onSubmit={handleReset}
              className="space-y-4"
              noValidate
              aria-describedby="reset-error reset-notice"
            >
              <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-gray-50 border border-gray-200 text-sm">
                <span className="min-w-0 truncate text-gray-700">
                  <span className="sr-only">Code sent to </span>
                  {email.trim()}
                </span>
                {!codeAccepted && (
                  <button
                    type="button"
                    onClick={() => {
                      setStep("request");
                      setError(null);
                      setNotice(null);
                      setCode("");
                    }}
                    className="shrink-0 text-sm font-semibold text-[#1769E0] hover:underline rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1769E0]/40"
                  >
                    Change email
                  </button>
                )}
              </div>

              {/* Hidden username field so password managers save the new password against the right account. */}
              <input type="email" name="username" autoComplete="username" value={email.trim()} readOnly hidden />

              <Field label={`${RECOVERY_CODE_LENGTH}-digit code`} htmlFor="code" required>
                <Input
                  id="code"
                  name="code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern={`[0-9]{${RECOVERY_CODE_LENGTH}}`}
                  maxLength={RECOVERY_CODE_LENGTH}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, RECOVERY_CODE_LENGTH))}
                  required
                  autoFocus
                  disabled={codeAccepted}
                  className="h-11 text-center text-lg font-mono tracking-[0.3em]"
                />
              </Field>

              <Field label="New password" htmlFor="new-password" required help="At least 10 characters.">
                <PasswordInput
                  id="new-password"
                  name="new-password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPasswordValue(e.target.value)}
                  required
                />
              </Field>

              <Field label="Confirm new password" htmlFor="confirm-password" required>
                <PasswordInput
                  id="confirm-password"
                  name="confirm-password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
              </Field>

              <Button type="submit" variant="primary" loading={loading} disabled={!hydrated} className="w-full h-11 text-sm font-semibold">
                Save new password
              </Button>

              {!codeAccepted && (
                <TurnstileField
                  ref={resendTurnstile}
                  siteKey={siteKey}
                  id="reset-resend-turnstile"
                  action="password-reset"
                  appearance="interaction-only"
                />
              )}

              {!codeAccepted && (
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-gray-500">Didn&apos;t get the email?</span>
                  <button
                    type="button"
                    onClick={handleResend}
                    disabled={loading || cooldown > 0}
                    className="font-semibold text-[#1769E0] hover:underline disabled:text-gray-400 disabled:no-underline disabled:cursor-not-allowed rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1769E0]/40"
                  >
                    {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
                  </button>
                </div>
              )}
            </form>
          )}

          {step === "done" && (
            <Button
              type="button"
              variant="primary"
              className="w-full h-11 text-sm font-semibold"
              onClick={() => {
                router.replace("/login");
              }}
            >
              Sign in
            </Button>
          )}

          {step !== "done" && (
            <div className="pt-4 border-t border-gray-100">
              {codeAccepted ? (
                <button
                  type="button"
                  onClick={handleCancel}
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-600 hover:text-gray-900 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1769E0]/40"
                >
                  <ArrowLeft className="w-4 h-4" aria-hidden="true" />
                  Cancel and back to sign in
                </button>
              ) : (
                <Link
                  href="/login"
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-600 hover:text-gray-900 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1769E0]/40"
                >
                  <ArrowLeft className="w-4 h-4" aria-hidden="true" />
                  Back to sign in
                </Link>
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
