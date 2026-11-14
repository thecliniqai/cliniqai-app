"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Building2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { acceptInvite } from "@/features/staff/actions";
import { FormMessage } from "@/components/auth/auth-form-parts";
import { Button } from "@/components/ui/button";

/**
 * Minimal invitation acceptance (AUTH-04a, ruling R4): an invitee who already has an account signs in, opens the
 * invitation link again and accepts. Setting a password from the invite (new staff) arrives with AUTH-06.
 */
function JoinClinicContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token")?.trim() ?? "";

  const [supabase] = useState(() => createClient());
  const [session, setSession] = useState<"checking" | "signed_out" | { email: string }>("checking");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    supabase.auth
      .getUser()
      .then(({ data }) => {
        if (!active) return;
        setSession(data.user ? { email: data.user.email ?? "" } : "signed_out");
      })
      .catch(() => {
        if (active) setSession("signed_out");
      });
    return () => {
      active = false;
    };
  }, [supabase]);

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
    <main className="min-h-screen bg-gray-50/70 flex flex-col justify-center items-center p-4">
      <div className="w-full max-w-md bg-white border border-gray-200 rounded-2xl p-6 sm:p-10 shadow-theme-sm space-y-6">
        <div className="text-center flex flex-col items-center">
          <div className="w-12 h-12 rounded-2xl bg-accent-subtle border border-accent-border text-accent-fg flex items-center justify-center mb-4 shadow-2xs">
            <Building2 className="w-6 h-6" aria-hidden="true" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Join your clinic</h1>
          <p className="text-sm text-gray-500 mt-1.5 max-w-xs">Accept your invitation to the clinic team on ClinicOS.</p>
        </div>

        <FormMessage id="join-error" tone="error" message={error} />

        {!token ? (
          <p className="text-sm text-gray-700 text-center">
            This invitation link is incomplete. Ask your clinic to send it again.
          </p>
        ) : session === "checking" ? (
          <p className="text-sm text-gray-500 text-center" role="status">
            Checking your sign-in…
          </p>
        ) : session === "signed_out" ? (
          <div className="space-y-4 text-center">
            <p className="text-sm text-gray-700">Sign in to accept this invitation.</p>
            <p className="text-sm text-gray-500">After signing in, open the invitation link again.</p>
            <Link
              href="/login"
              className="inline-flex w-full items-center justify-center min-h-[44px] px-4 rounded-lg bg-accent text-white text-sm font-semibold hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-ring"
            >
              Sign in
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-gray-700 text-center">
              Signed in as <span className="font-semibold text-gray-900 break-all">{session.email}</span>
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
        )}
      </div>
    </main>
  );
}

export default function JoinClinicPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-50/70 flex items-center justify-center">
          <p className="text-sm text-gray-500">Loading invitation…</p>
        </div>
      }
    >
      <JoinClinicContent />
    </Suspense>
  );
}
