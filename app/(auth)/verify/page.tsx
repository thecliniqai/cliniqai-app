"use client";

import React, { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";

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
    <div className="w-full max-w-sm bg-white p-6 rounded-[var(--radius-lg)] border border-[var(--border-default)] shadow-sm">
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">
          Check your email
        </h1>
        <p className="text-sm text-[var(--text-secondary)] mt-1">
          We sent a verification code to <span className="font-medium text-[var(--text-primary)]">{email}</span>
        </p>
      </div>

      <form onSubmit={handleVerify} className="flex flex-col gap-4">
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
            placeholder="6-digit code"
            required
            autoFocus
          />
        </Field>

        {resendMessage && (
          <p className="text-xs text-[var(--color-success)] text-center font-medium">
            {resendMessage}
          </p>
        )}

        <Button type="submit" loading={loading} className="w-full mt-2">
          Verify and Continue
        </Button>
      </form>

      <div className="mt-6 flex flex-col items-center gap-2 text-xs text-[var(--text-secondary)]">
        <button
          type="button"
          onClick={handleResend}
          disabled={resending}
          className="text-[var(--color-brand)] font-medium hover:underline disabled:opacity-50 cursor-pointer"
        >
          {resending ? "Sending fresh code..." : "Didn't receive code? Resend"}
        </button>
        <button
          type="button"
          onClick={() => router.push("/login")}
          className="hover:underline cursor-pointer"
        >
          Use a different email
        </button>
      </div>
    </div>
  );
}

export default function VerifyPage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <Suspense fallback={<div>Loading...</div>}>
        <VerifyForm />
      </Suspense>
    </main>
  );
}
