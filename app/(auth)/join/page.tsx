import { Building2 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getSessionClaims } from "@/lib/auth/tenant";
import { inviteTokenHash } from "@/features/staff/invite";
import { publicEnv } from "@/lib/env";
import { en } from "@/messages/en";
import { roleLabel } from "@/lib/email/templates/invite";
import { JoinAcceptButton, JoinSetPasswordForm } from "./join-forms";

/**
 * `/join?token=…` (V2-05 05-07b; AUTH-06, AUTH_REDESIGN §3.2; minimal functional form, R-31: the styled page and
 * journey J-A2 are V2-11's).
 *
 * GET has no side effect (link scanners open it): the page hashes the token and asks `peek_invitation` (anon) for the
 * status, the clinic's name, the role and a masked address; nothing is consumed or minted here. Then:
 *   - not pending (unknown, expired, revoked, used) → a fixed message;
 *   - signed in → "Accept invitation" (`acceptInvite` → `consume_invitation`: the session's confirmed address must be
 *     the invited one);
 *   - signed out → a set-password form for a new invitee (Turnstile + password; `acceptInviteWithPasswordAction`) and
 *     "Sign in to accept" for an existing account.
 * The token is never logged; the page is public (`lib/auth/public-paths.ts`).
 */
export const dynamic = "force-dynamic";

type Peek =
  | { status: "pending"; clinicName: string; role: string; maskedEmail: string }
  | { status: "not_found" | "expired" | "revoked" | "used" | "incomplete" };

async function peek(token: string | undefined): Promise<Peek> {
  if (!token) return { status: "incomplete" };
  const hash = inviteTokenHash(token);
  if (hash === null) return { status: "not_found" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("peek_invitation", { p_token_hash: hash });
  if (error || data === null || typeof data !== "object" || Array.isArray(data)) return { status: "not_found" };
  const d = data as Record<string, unknown>;
  if (d.status === "pending" && typeof d.clinic_name === "string" && typeof d.role === "string" && typeof d.masked_email === "string") {
    return { status: "pending", clinicName: d.clinic_name, role: d.role, maskedEmail: d.masked_email };
  }
  if (d.status === "expired" || d.status === "revoked" || d.status === "used") return { status: d.status };
  return { status: "not_found" };
}

/** V2-09d: the verified session claims (no Auth round trip); null when signed out or the session cannot be read. */
async function signedInEmail(): Promise<string | null> {
  try {
    return (await getSessionClaims()).email ?? "";
  } catch {
    return null;
  }
}

const M = en.auth.invite;

export default async function JoinClinicPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const raw = (await searchParams).token;
  const token = (Array.isArray(raw) ? raw[0] : raw)?.trim() || undefined;
  const invitation = await peek(token);
  const email = invitation.status === "pending" ? await signedInEmail() : null;

  return (
    <main className="min-h-app bg-gray-50/70 flex flex-col justify-center items-center p-4">
      <div className="w-full max-w-md bg-white border border-gray-200 rounded-2xl p-6 sm:p-10 shadow-theme-sm space-y-6">
        <div className="text-center flex flex-col items-center">
          <div className="w-12 h-12 rounded-2xl bg-accent-subtle border border-accent-border text-accent-fg flex items-center justify-center mb-4 shadow-2xs">
            <Building2 className="w-6 h-6" aria-hidden="true" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">{M.title}</h1>
          <p className="text-sm text-gray-600 mt-1.5 max-w-xs">{M.intro}</p>
        </div>

        {invitation.status !== "pending" ? (
          <p className="text-sm text-gray-700 text-center" role="status">
            {M[invitation.status]}
          </p>
        ) : (
          <div className="space-y-6">
            <dl className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm space-y-2">
              <div className="flex justify-between gap-4">
                <dt className="text-gray-600">Clinic</dt>
                <dd className="font-semibold text-gray-900 text-right break-words">{invitation.clinicName}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-gray-600">Role</dt>
                <dd className="font-semibold text-gray-900">{roleLabel(invitation.role)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-gray-600">Invited address</dt>
                <dd className="font-semibold text-gray-900 break-all">{invitation.maskedEmail}</dd>
              </div>
            </dl>

            {email !== null ? (
              <JoinAcceptButton token={token ?? ""} email={email} />
            ) : (
              <JoinSetPasswordForm token={token ?? ""} siteKey={publicEnv.NEXT_PUBLIC_TURNSTILE_SITE_KEY} />
            )}
          </div>
        )}
      </div>
    </main>
  );
}
