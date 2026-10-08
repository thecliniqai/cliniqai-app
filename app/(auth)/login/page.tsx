"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Stethoscope, ArrowRight } from "lucide-react";

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
    <main className="min-h-screen bg-gray-50/70 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white p-8 sm:p-10 rounded-2xl border border-gray-200 shadow-theme-sm">
        {/* Clinic Logo & Brand */}
        <div className="mb-8 text-center flex flex-col items-center">
          <div className="w-12 h-12 rounded-2xl bg-brand-500 text-white flex items-center justify-center shadow-theme-xs mb-4">
            <Stethoscope className="w-6 h-6" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">
            Sign in to ClinicQ
          </h1>
          <p className="text-sm text-gray-500 mt-1.5 max-w-xs">
            Enter your email to receive a secure one-time verification code
          </p>
        </div>

        <form onSubmit={handleSendOtp} className="space-y-5">
          <Field
            label="Email Address"
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

        <div className="mt-8 pt-6 border-t border-gray-100 text-center">
          <p className="text-xs text-gray-400">
            Secure multi-tenant healthcare operating system
          </p>
        </div>
      </div>
    </main>
  );
}

