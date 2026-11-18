"use client";

import React, { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { acceptInvite } from "@/features/staff/actions";
import { acceptInviteWithPasswordAction } from "@/features/auth/actions";
import { TurnstileField, type TurnstileFieldHandle } from "@/components/auth/turnstile-field";
import { FormMessage, PasswordInput } from "@/components/auth/auth-form-parts";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { useHydrated } from "@/lib/hooks/use-hydrated";
import { PASSWORDS_DO_NOT_MATCH_MESSAGE } from "@/features/auth/schemas";
import { en } from "@/messages/en";

const M = en.auth.invite;
const LINK_CLASS =
  "text-sm font-semibold text-accent hover:underline rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40";

/** Signed-in invitee: accept with the current session (the server checks the session's address). */
export function JoinAcceptButton({ token, email }: { token: string; email: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAccept = async () => {
    if (loading) return;
    setError(null);
    setLoading(true);
    const result = await acceptInvite(token);
    if (!result.success) {
      setError(result.error);
      setLoading(false);
      return;
    }
    router.replace("/");
    router.refresh();
  };

  return (
    <div className="space-y-4">
      <FormMessage id="join-error" tone="error" message={error} />
      <p className="text-sm text-gray-700 text-center">
        Signed in as <span className="font-semibold text-gray-900 break-all">{email}</span>
      </p>
      <Button
        type="button"
        variant="primary"
        loading={loading}
        onClick={handleAccept}
        aria-describedby="join-error"
        className="w-full h-11 text-sm font-semibold"
      >
        Accept invitation
      </Button>
    </div>
  );
}

/** Signed-out invitee: set a password (new account) or sign in first (existing account). */
export function JoinSetPasswordForm({ token, siteKey }: { token: string; siteKey: string | undefined }) {
  const hydrated = useHydrated();
  const turnstile = useRef<TurnstileFieldHandle>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError(null);
    if (password !== confirm) {
      setError(PASSWORDS_DO_NOT_MATCH_MESSAGE);
      return;
    }
    setLoading(true);
    const turnstileToken = siteKey ? ((await turnstile.current?.token()) ?? "") : "";
    const result = await acceptInviteWithPasswordAction({ token, password, turnstileToken });
    // Turnstile tokens are single-use.
    if (turnstileToken) turnstile.current?.reset();
    setLoading(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setPassword("");
    setConfirm("");
    setDone(true);
  };

  if (done) {
    return (
      <div className="space-y-4 text-center">
        <p className="text-sm text-gray-700" role="status">
          {M.accepted}
        </p>
        <Link href="/login" className={LINK_CLASS}>
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-700">{M.set_password_intro}</p>
      <FormMessage id="join-error" tone="error" message={error} />
      <form method="post" onSubmit={handleSubmit} className="space-y-4" noValidate aria-describedby="join-error">
        <Field label="New password" htmlFor="join-password" required>
          <PasswordInput
            id="join-password"
            name="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            invalid={Boolean(error)}
          />
        </Field>
        <Field label="Confirm password" htmlFor="join-password-confirm" required>
          <PasswordInput
            id="join-password-confirm"
            name="confirmPassword"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            invalid={Boolean(error)}
          />
        </Field>
        <TurnstileField ref={turnstile} siteKey={siteKey} id="join-turnstile" action="invite-accept" />
        <Button type="submit" variant="primary" loading={loading} disabled={!hydrated} className="w-full h-11 text-sm font-semibold">
          Create account and join
        </Button>
      </form>
      <p className="pt-4 border-t border-gray-100 text-center text-sm text-gray-600">
        {M.sign_in_to_accept}{" "}
        <Link href="/login" className={LINK_CLASS}>
          Sign in
        </Link>
      </p>
    </div>
  );
}
