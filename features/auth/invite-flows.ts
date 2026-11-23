import "server-only";

import { createClient } from "@/lib/supabase/server";
import { forgetSessionContext, getSessionClaims } from "@/lib/auth/tenant";
import { isPwnedPassword, type PwnedResult } from "@/lib/auth/pwned";
import { TURNSTILE_ACTIONS, verifyTurnstile, type TurnstileResult } from "@/lib/auth/turnstile";
import { log } from "@/lib/log";
import { en } from "@/messages/en";
import { inviteTokenHash } from "@/features/staff/invite";
import { redeemInvitationWithPassword, type InviteRedeemOutcome } from "@/features/auth/system";
import { AUTH_ERROR_MESSAGES } from "./errors";
import { newPasswordSchema } from "./schemas";

/**
 * Invite acceptance (V2-05 05-07b; AUTH-06, AUTH_REDESIGN §3.2; R-30, R-44 proposed ADR-0005 amendment A4, R-46).
 *
 * This is the one module outside the ADR-0005 allow-list that may import `features/auth/system.ts` (ESLint A4 zone,
 * tests/security/p1-34-lint-gates.spec.ts). It reaches the system path only after, in this order:
 *   1. the raw token's shape (64 hex) → its SHA-256 (the only form the database knows);
 *   2. the server-side Turnstile check (fail closed; an unset secret refuses, never skips);
 *   3. the password policy (10+ characters, at most 72 bytes) and FT-05 Pwned Passwords;
 * so a failed check changes no account. The system path then creates or completes the account for the address the
 * database validated, and redeems the invitation (`redeemInvitationWithPassword`).
 *
 * `acceptInvite` is the signed-in path: a confirmed account whose email is the invited address redeems through
 * `consume_invitation` (authenticated; binds the membership to `auth.uid()`).
 *
 * Every refusal is a fixed catalogue text (messages/en.ts); nothing from the database, GoTrue or Cloudflare is shown,
 * and no token, hash, address or password is logged.
 */

export type AcceptInviteWithPasswordInput = { token: string; password: string; turnstileToken: string };
export type AcceptInviteWithPasswordResult = { ok: true } | { ok: false; message: string };
export type AcceptInviteResult = { success: true; tenantId: string } | { success: false; error: string };

const M = en.auth.invite;

export interface InviteFlowDeps {
  verify?: (token: string) => Promise<TurnstileResult>;
  checkPwned?: (password: string) => Promise<PwnedResult>;
  redeem?: (tokenHash: string, password: string) => Promise<InviteRedeemOutcome>;
}

const REDEEM_MESSAGES: Record<Exclude<InviteRedeemOutcome, { ok: true }>["code"], string> = {
  not_found: M.not_found,
  expired: M.expired,
  revoked: M.revoked,
  used: M.used,
  account_exists: M.account_exists,
  email_mismatch: M.email_mismatch,
  already_member: M.already_member,
  weak_password: AUTH_ERROR_MESSAGES.weak_password,
  failed: M.accept_failed,
};

export async function acceptInviteWithPassword(
  input: AcceptInviteWithPasswordInput,
  deps: InviteFlowDeps = {},
): Promise<AcceptInviteWithPasswordResult> {
  const record = (typeof input === "object" && input !== null ? input : {}) as Partial<AcceptInviteWithPasswordInput>;
  const tokenHash = inviteTokenHash(record.token);
  if (tokenHash === null) return { ok: false, message: M.not_found };

  const verified = await (deps.verify ?? ((t: string) => verifyTurnstile(t, { expectedAction: TURNSTILE_ACTIONS.inviteAccept })))(
    typeof record.turnstileToken === "string" ? record.turnstileToken : "",
  );
  if (!verified.ok) {
    return { ok: false, message: verified.reason === "unconfigured" ? M.captcha_unconfigured : en.auth.captcha.failed };
  }

  const parsed = newPasswordSchema.safeParse(record.password);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? AUTH_ERROR_MESSAGES.weak_password };
  const password = parsed.data;
  if ((await (deps.checkPwned ?? ((p: string) => isPwnedPassword(p)))(password)) === "pwned") {
    log.info({ event: "auth.invite_accept.rejected", action: "invite_accept", reason: "pwned_password" });
    return { ok: false, message: AUTH_ERROR_MESSAGES.pwned_password };
  }

  const outcome = await (deps.redeem ?? redeemInvitationWithPassword)(tokenHash, password);
  if (!outcome.ok) return { ok: false, message: REDEEM_MESSAGES[outcome.code] };
  log.info({ event: "auth.invite_accept.done", action: "invite_accept", tenantId: outcome.tenantId });
  return { ok: true };
}

/** The signed-in path: the session user (confirmed, the invited address) redeems the invitation. */
export async function acceptInvite(rawToken: string): Promise<AcceptInviteResult> {
  const supabase = await createClient();
  try {
    // Authenticate before anything else (ADR-0005 V1); the RPC re-checks auth.uid() and binds the membership to it.
    // V2-09d: the verified session claims (no Auth round trip).
    try {
      await getSessionClaims();
    } catch {
      return { success: false, error: "Sign in to accept this invitation." };
    }
    const tokenHash = inviteTokenHash(rawToken);
    if (tokenHash === null) return { success: false, error: "Missing or invalid invitation token." };

    const { data: tenantId, error } = await (
      supabase.rpc as unknown as (
        name: string,
        args: { p_token_hash: string },
      ) => Promise<{ data: string | null; error: { message: string } | null }>
    )("consume_invitation", { p_token_hash: tokenHash });

    if (error || !tenantId) {
      const msg = error?.message || "";
      if (msg.includes("already been used")) return { success: false, error: "This invitation has already been used." };
      if (msg.includes("expired")) return { success: false, error: "This invitation has expired. Please ask for a new invite." };
      if (msg.includes("Invalid invitation token")) return { success: false, error: "Invalid invitation link." };
      // V2-05 05-11b (H-INVITE, migration 000071): only the invited address may accept, once it is confirmed.
      if (msg.includes("INVITATION_EMAIL_MISMATCH")) return { success: false, error: M.email_mismatch };
      if (msg.includes("INVITATION_EMAIL_UNCONFIRMED")) {
        return { success: false, error: "Confirm your email address first, then open the invitation link again." };
      }
      // V2-05 05-05 (migration 000087): an invitation revoked (by a resend, a revoke or the inviter's removal) is dead.
      if (msg.includes("INVITATION_REVOKED")) return { success: false, error: "This invitation has been withdrawn. Please ask for a new invite." };
      if (msg.includes("ALREADY_MEMBER")) return { success: false, error: M.already_member };
      return { success: false, error: "Failed to accept invitation. Please try again." };
    }
    // V2-09d: the caller joined a clinic; the session context is read from the database again.
    await forgetSessionContext();
    return { success: true, tenantId };
  } catch {
    return { success: false, error: "Failed to accept invitation. Please try again." };
  }
}
