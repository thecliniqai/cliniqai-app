"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const supabase = createClient();
      const redirectUrl =
        typeof window !== "undefined"
          ? `${window.location.origin}/auth/callback`
          : undefined;

      const { error: otpError } = await supabase.auth.signInWithOtp({
        email,
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

      router.push(`/verify?email=${encodeURIComponent(email)}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred");
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white p-6 rounded-[var(--radius-lg)] border border-[var(--border-default)] shadow-sm">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">
            Sign in to ClinicQ
          </h1>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            Enter your email to receive a one-time sign-in code
          </p>
        </div>

        <form onSubmit={handleSendOtp} className="flex flex-col gap-4">
          <Field
            label="Email address"
            htmlFor="email"
            error={error || undefined}
            required
          >
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="doctor@clinic.com"
              required
              autoFocus
            />
          </Field>

          <Button type="submit" loading={loading} className="w-full mt-2">
            Send code
          </Button>
        </form>
      </div>
    </main>
  );
}
