"use client";

import React, { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ClinicShowcasePanel } from "@/components/auth/clinic-showcase-panel";
import { SocialAuthButtons } from "@/components/auth/social-auth-buttons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import {
  Stethoscope,
  ArrowRight,
  Mail,
  KeyRound,
  CheckCircle2,
  RefreshCw,
  Edit2,
  ShieldCheck,
} from "lucide-react";

export default function LoginPage() {
  const router = useRouter();

  // Form states: 'email' or 'otp'
  const [step, setStep] = useState<"email" | "otp">("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Resend cooldown timer
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resendSuccess, setResendSuccess] = useState(false);

  const otpInputRef = useRef<HTMLInputElement>(null);

  // Handle countdown timer
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  // Focus OTP input when switching to OTP step
  useEffect(() => {
    if (step === "otp") {
      setTimeout(() => {
        otpInputRef.current?.focus();
      }, 80);
    }
  }, [step]);

  // Step 1: Send OTP to Email
  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = email.trim();
    if (!cleanEmail) {
      setError("Please enter your clinic email address.");
      return;
    }

    setError(null);
    setLoading(true);

    try {
      const supabase = createClient();
      const redirectUrl =
        typeof window !== "undefined"
          ? `${window.location.origin}/auth/callback`
          : undefined;

      const { error: otpError } = await supabase.auth.signInWithOtp({
        email: cleanEmail,
        options: {
          shouldCreateUser: true,
          emailRedirectTo: redirectUrl,
        },
      });

      if (otpError) {
        setError(otpError.message);
        setLoading(false);
        return;
      }

      setStep("otp");
      setOtp("");
      setResendCooldown(30);
      setResendSuccess(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to send verification code.");
    } finally {
      setLoading(false);
    }
  };

  // Step 2: Verify OTP
  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanOtp = otp.trim();
    if (!cleanOtp) {
      setError("Please enter the verification code.");
      return;
    }

    setError(null);
    setLoading(true);

    try {
      const supabase = createClient();
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: cleanOtp,
        type: "email",
      });

      if (verifyError) {
        setError(verifyError.message);
        setLoading(false);
        return;
      }

      router.push("/");
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to verify code.");
      setLoading(false);
    }
  };

  // Resend OTP Action
  const handleResend = async () => {
    if (resendCooldown > 0 || loading) return;
    setError(null);
    setLoading(true);
    setResendSuccess(false);

    try {
      const supabase = createClient();
      const redirectUrl =
        typeof window !== "undefined"
          ? `${window.location.origin}/auth/callback`
          : undefined;

      const { error: resendErr } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          shouldCreateUser: true,
          emailRedirectTo: redirectUrl,
        },
      });

      if (resendErr) {
        setError(resendErr.message);
      } else {
        setResendCooldown(30);
        setResendSuccess(true);
      }
    } catch {
      setError("Failed to resend verification code.");
    } finally {
      setLoading(false);
    }
  };

  // Handle OTP paste (e.g. 8 digits copied from email)
  const handleOtpChange = (val: string) => {
    const digitsOnly = val.replace(/[^0-9]/g, "").slice(0, 8);
    setOtp(digitsOnly);
  };

  return (
    <main className="min-h-screen w-full flex flex-col lg:flex-row bg-white">
      {/* LEFT SIDE: Rich ClinicOS Showcase Panel */}
      <ClinicShowcasePanel />

      {/* RIGHT SIDE: Authentication Form (Prioritized on Mobile) */}
      <div className="w-full lg:w-1/2 min-h-screen flex items-center justify-center p-6 sm:p-12 xl:p-16 bg-white">
        <div className="w-full max-w-md mx-auto space-y-7">
          {/* Mobile-only Top Brand Header */}
          <div className="lg:hidden flex items-center justify-between pb-2 border-b border-gray-100">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-[#1769E0] text-white flex items-center justify-center shadow-theme-xs">
                <Stethoscope className="w-5 h-5" />
              </div>
              <span className="text-base font-bold text-gray-900">
                ClinicOS
              </span>
            </div>
            <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
              ABDM Ready
            </span>
          </div>

          {/* Form Header */}
          <div>
            <div className="w-11 h-11 rounded-2xl bg-blue-50 border border-blue-100 text-[#1769E0] flex items-center justify-center mb-4 shadow-2xs">
              {step === "email" ? (
                <Mail className="w-5 h-5" />
              ) : (
                <KeyRound className="w-5 h-5" />
              )}
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-gray-900">
              {step === "email" ? "Sign in to ClinicOS" : "Enter verification code"}
            </h1>
            <p className="text-xs sm:text-sm text-gray-500 mt-1.5">
              {step === "email"
                ? "Enter your clinic email to receive a secure one-time login code."
                : "Enter the code sent to your email to verify your identity."}
            </p>
          </div>

          {/* Error Banner */}
          {error && (
            <div className="p-3.5 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl flex items-start gap-2.5 shadow-2xs">
              <span className="font-semibold shrink-0">Error:</span>
              <span className="leading-relaxed">{error}</span>
            </div>
          )}

          {/* Resend Success Banner */}
          {resendSuccess && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-xl flex items-center gap-2 shadow-2xs">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>A new verification code has been dispatched to your email.</span>
            </div>
          )}

          {/* STEP 1: EMAIL INPUT */}
          {step === "email" && (
            <form onSubmit={handleSendOtp} className="space-y-4">
              <Field
                label="Clinic Email Address"
                htmlFor="email"
                required
              >
                <div className="relative">
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="doctor@clinic.com"
                    required
                    autoFocus
                    className="h-11 ps-3.5 text-sm"
                  />
                </div>
              </Field>

              <Button
                type="submit"
                variant="primary"
                loading={loading}
                className="w-full h-11 text-sm font-semibold gap-2 shadow-theme-xs"
              >
                <span>Send Verification Code</span>
                <ArrowRight className="w-4 h-4" />
              </Button>
            </form>
          )}

          {/* STEP 2: INLINE OTP VERIFICATION (8-DIGIT SUPPORT) */}
          {step === "otp" && (
            <form onSubmit={handleVerifyOtp} className="space-y-4">
              {/* Destination Email Info Bar with Edit Action */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-gray-50 border border-gray-200/80 text-xs text-gray-600">
                <div className="truncate max-w-[240px]">
                  <span className="text-gray-400 block text-[10px] uppercase font-semibold">
                    Code sent to
                  </span>
                  <span className="font-semibold text-gray-900 truncate block">
                    {email}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setStep("email");
                    setError(null);
                    setResendSuccess(false);
                  }}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#1769E0] hover:underline cursor-pointer px-2 py-1 rounded-md hover:bg-blue-50 transition-colors"
                >
                  <Edit2 className="w-3 h-3" />
                  <span>Change</span>
                </button>
              </div>

              {/* 8-Digit OTP Input */}
              <Field
                label="Verification Code (6 to 8 digits)"
                htmlFor="otp-code"
                required
              >
                <div className="relative">
                  <Input
                    ref={otpInputRef}
                    id="otp-code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={otp}
                    onChange={(e) => handleOtpChange(e.target.value)}
                    placeholder="••••••••"
                    maxLength={8}
                    required
                    className="h-12 text-center text-xl font-mono font-bold tracking-[0.28em] rounded-xl border-gray-300 focus:border-[#1769E0]"
                  />
                </div>
              </Field>

              <Button
                type="submit"
                variant="primary"
                loading={loading}
                className="w-full h-11 text-sm font-semibold gap-2 shadow-theme-xs"
              >
                <span>Verify and Continue</span>
                <ArrowRight className="w-4 h-4" />
              </Button>

              {/* Resend Action with Countdown */}
              <div className="flex items-center justify-between pt-1 text-xs">
                <span className="text-gray-500">Didn&apos;t get the email?</span>
                {resendCooldown > 0 ? (
                  <span className="text-gray-400 font-medium">
                    Resend in <strong className="text-gray-600 font-mono">{resendCooldown}s</strong>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={handleResend}
                    disabled={loading}
                    className="inline-flex items-center gap-1 font-semibold text-[#1769E0] hover:underline cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>Resend Code</span>
                  </button>
                )}
              </div>
            </form>
          )}

          {/* Social Logins: Google & Microsoft (Locked for Phase 3) */}
          <SocialAuthButtons />

          {/* Trust, Privacy & HIPAA/ABDM Assurance Footer */}
          <div className="pt-4 border-t border-gray-100 text-center space-y-2">
            <div className="flex items-center justify-center gap-1.5 text-[11px] text-gray-500 font-medium">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
              <span>Multi-Tenant RLS &middot; 256-Bit Encrypted &middot; ABDM Compliant</span>
            </div>
            <p className="text-[11px] text-gray-400">
              By accessing ClinicOS, you confirm authorization under your clinic&apos;s healthcare governance policy.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
