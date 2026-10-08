"use client";

import React, { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Mail, CheckCircle2 } from "lucide-react";

function VerifyForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const emailParam = searchParams.get("email") || "";

  const [email] = useState(emailParam);
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [resending, setResending] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const supabase = createClient();
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email,
        token: token.trim(),
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
      setError(err instanceof Error ? err.message : "Failed to verify code");
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setResending(true);
    setResendMessage(null);
    setError(null);

    try {
      const supabase = createClient();
      const redirectUrl =
        typeof window !== "undefined"
          ? `${window.location.origin}/auth/callback`
          : undefined;

      const { error: resendError } = await supabase.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: true,
          emailRedirectTo: redirectUrl,
        },
      });

      if (resendError) {
        setError(resendError.message);
      } else {
        setResendMessage("A new verification code has been sent!");
      }
    } catch {
      setError("Failed to resend code");
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="w-full max-w-md bg-white p-8 sm:p-10 rounded-2xl border border-gray-200 shadow-theme-sm">
      <div className="mb-8 text-center flex flex-col items-center">
        <div className="w-12 h-12 rounded-2xl bg-brand-50 border border-brand-100 text-brand-600 flex items-center justify-center mb-4 shadow-2xs">
          <Mail className="w-6 h-6" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">
          Check your email
        </h1>
        <p className="text-sm text-gray-500 mt-1.5 max-w-xs">
          We sent a verification code to{" "}
          <span className="font-semibold text-gray-900">{email}</span>
        </p>
      </div>

      <form onSubmit={handleVerify} className="space-y-5">
        <Field
          label="Verification Code"
          htmlFor="token"
          error={error || undefined}
          required
        >
          <Input
            id="token"
            type="text"
            inputMode="numeric"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Enter verification code"
            className="text-center tracking-widest text-lg font-bold"
            maxLength={10}
            required
            autoFocus
          />
        </Field>

        {resendMessage && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-center text-xs font-semibold text-emerald-800">
            <CheckCircle2 className="w-4 h-4 mr-1.5 text-emerald-600 shrink-0" />
            <span>{resendMessage}</span>
          </div>
        )}

        <Button
          type="submit"
          variant="primary"
          loading={loading}
          className="w-full h-11 text-sm font-semibold shadow-theme-xs"
        >
          Verify and Continue
        </Button>
      </form>

      <div className="mt-8 pt-6 border-t border-gray-100 flex flex-col items-center gap-2 text-xs text-gray-500">
        <button
          type="button"
          onClick={handleResend}
          disabled={resending}
          className="text-brand-600 font-semibold hover:underline disabled:opacity-50 cursor-pointer"
        >
          {resending ? "Sending fresh code..." : "Didn't receive code? Resend"}
        </button>
        <button
          type="button"
          onClick={() => router.push("/login")}
          className="text-gray-400 hover:text-gray-600 hover:underline cursor-pointer"
        >
          Use a different email
        </button>
      </div>
    </div>
  );
}

export default function VerifyPage() {
  return (
    <main className="min-h-screen bg-gray-50/70 flex items-center justify-center p-4">
      <Suspense fallback={<div className="text-sm text-gray-500">Loading verification...</div>}>
        <VerifyForm />
      </Suspense>
    </main>
  );
}

