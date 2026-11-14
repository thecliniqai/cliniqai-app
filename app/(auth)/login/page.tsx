"use client";

import React, { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogIn } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { signIn } from "@/features/auth/password-flows";
import { ClinicShowcasePanel } from "@/components/auth/clinic-showcase-panel";
import { TurnstileField, type TurnstileFieldHandle } from "@/components/auth/turnstile-field";
import { AuthMobileBrand, FormMessage, PasswordInput } from "@/components/auth/auth-form-parts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { useHydrated } from "@/lib/hooks/use-hydrated";
import { safeNextPath } from "@/lib/auth/safe-next";
import { publicEnv } from "@/lib/env";

/** Where to go after sign-in: the `next` the proxy set if it is a same-origin path (03-12c, T-03-04), else `/`. */
function afterSignInPath(): string {
  return safeNextPath(new URLSearchParams(window.location.search).get("next")) ?? "/";
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hydrated = useHydrated();
  // 03-12c (C43): Turnstile on sign-in when a site key is configured; Supabase verifies the token.
  const siteKey = publicEnv.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const turnstile = useRef<TurnstileFieldHandle>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setLoading(true);

    const captchaToken = siteKey ? ((await turnstile.current?.token()) ?? null) : null;
    const result = await signIn(createClient(), { email, password }, { required: Boolean(siteKey), token: captchaToken });
    // Turnstile tokens are single-use: every attempt that used one needs a new one.
    if (captchaToken) turnstile.current?.reset();
    if (!result.ok) {
      setError(result.message);
      // A missing security check keeps the typed password; a refused sign-in clears it.
      if (result.code !== "captcha_required") setPassword("");
      setLoading(false);
      return;
    }

    // `/` lets the dashboard layout pick the role's page (membership checks); a safe `next` goes back where the
    // proxy sent the user from.
    router.replace(afterSignInPath());
    router.refresh();
  };

  return (
    <main className="min-h-app w-full flex flex-col lg:flex-row bg-white">
      <ClinicShowcasePanel />

      <div className="w-full lg:w-1/2 min-h-app flex items-center justify-center p-6 sm:p-12 xl:p-16 bg-white">
        <div className="w-full max-w-md mx-auto space-y-7">
          <AuthMobileBrand />

          <div>
            <div className="w-11 h-11 rounded-2xl bg-blue-50 border border-blue-100 text-accent flex items-center justify-center mb-4 shadow-2xs">
              <LogIn className="w-5 h-5" aria-hidden="true" />
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-gray-900">Sign in to ClinicOS</h1>
            <p className="text-sm text-gray-500 mt-1.5">Use your clinic email and password.</p>
          </div>

          <FormMessage id="login-error" tone="error" message={error} />

          <form method="post" onSubmit={handleSubmit} className="space-y-4" noValidate aria-describedby="login-error">
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
                invalid={Boolean(error)}
                className="h-11"
              />
            </Field>

            <Field label="Password" htmlFor="password" required>
              <PasswordInput
                id="password"
                name="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                invalid={Boolean(error)}
              />
            </Field>

            <div className="flex justify-end">
              <Link
                href="/forgot-password"
                className="text-sm font-semibold text-accent hover:underline rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                Forgot password?
              </Link>
            </div>

            <TurnstileField ref={turnstile} siteKey={siteKey} id="login-turnstile" action="sign-in" />

            <Button type="submit" variant="primary" loading={loading} disabled={!hydrated} className="w-full h-11 text-sm font-semibold">
              Sign in
            </Button>
          </form>

          <p className="pt-4 border-t border-gray-100 text-center text-sm text-gray-500">
            Access is by invitation from your clinic.
          </p>
        </div>
      </div>
    </main>
  );
}
