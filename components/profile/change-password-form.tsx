"use client";

import React, { useState } from "react";
import { KeyRound } from "lucide-react";
import { changePasswordAction } from "@/features/auth/actions";
import { changePasswordFormSchema } from "@/features/auth/schemas";
import { FormMessage, PasswordInput } from "@/components/auth/auth-form-parts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { useHydrated } from "@/lib/hooks/use-hydrated";
import { en } from "@/messages/en";

/**
 * "Change password" on `/profile` (V2-03 03-12a, AUTH-04b). Current, new and confirm; the server action checks the
 * new password against Pwned Passwords (FT-05) and signs out every other session. Errors are the catalogue's fixed
 * copy (`features/auth/errors.ts`). The restyle is V2-11.
 */
export function ChangePasswordForm({ email }: { email: string }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const hydrated = useHydrated();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setNotice(null);

    const parsed = changePasswordFormSchema.safeParse({ currentPassword, newPassword, confirmPassword });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the form and try again");
      return;
    }

    setLoading(true);
    let result: Awaited<ReturnType<typeof changePasswordAction>>;
    try {
      result = await changePasswordAction({
        currentPassword: parsed.data.currentPassword,
        newPassword: parsed.data.newPassword,
      });
    } catch {
      result = { ok: false, code: "unknown", message: en.auth.flows.change_failed };
    }
    setLoading(false);

    if (!result.ok) {
      setError(result.message);
      return;
    }
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setNotice(result.otherSessionsSignedOut ? en.auth.changePassword.success : en.auth.changePassword.successOthersRemain);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center text-accent border border-blue-100">
            <KeyRound className="w-4 h-4" aria-hidden="true" />
          </div>
          <div>
            <CardTitle id="change-password-title">Change password</CardTitle>
            <CardDescription>Your other devices are signed out after the change.</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <form
          method="post"
          onSubmit={handleSubmit}
          noValidate
          aria-labelledby="change-password-title"
          aria-describedby="change-password-error change-password-notice"
          className="space-y-4"
        >
          {/* Hidden username so password managers update the right saved credential. */}
          <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />

          <FormMessage id="change-password-error" tone="error" message={error} />
          <FormMessage id="change-password-notice" tone="info" message={notice} />

          <Field label="Current password" htmlFor="current-password" required>
            <PasswordInput
              id="current-password"
              name="current-password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
            />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="New password" htmlFor="new-password" required help="At least 10 characters.">
              <PasswordInput
                id="new-password"
                name="new-password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
              />
            </Field>

            <Field label="Confirm new password" htmlFor="confirm-new-password" required>
              <PasswordInput
                id="confirm-new-password"
                name="confirm-new-password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
            </Field>
          </div>

          <div className="flex justify-end">
            <Button type="submit" variant="primary" loading={loading} disabled={!hydrated} className="w-full sm:w-auto h-11">
              Change password
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
