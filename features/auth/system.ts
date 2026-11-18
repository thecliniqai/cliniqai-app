import "server-only";

import { getSystemDb } from "@/lib/supabase/system";
import { errorTag, log, logWord } from "@/lib/log";

/**
 * The Send Email hook's shared delivery record (V2-04 04-03c; R-43, proposed ADR-0005 amendment A3; T-04-23, T-04-24).
 *
 * Supabase Auth retries a hook call with the same Standard Webhooks `webhook-id`, and a retry can land on another
 * server instance, past the route's per-instance memory. These two functions record the id in the shared inbound store
 * (`ops.inbound_webhook_events`, provider `supabase_auth_hook`, migration 000037) so a delivery is sent once across
 * instances. They run on the service role (reason `auth.send_email_hook`) and are importable only from
 * `app/api/auth/send-email/route.ts` (ESLint A3 zone), which calls them only after the signature check.
 *
 * Only the provider, the id and timestamps reach the table: never an address, a code or a token.
 * The store fails OPEN: a database error is logged (`errorTag`) and reported as `unavailable`, and the route sends the
 * email anyway. An auth email is never blocked by its dedupe store.
 */
const PROVIDER = "supabase_auth_hook";

/** A `webhook-id` the store accepts; any other id skips the shared layer (the per-instance memory still applies). */
const WEBHOOK_ID = /^[A-Za-z0-9_.-]{1,128}$/;

/**
 * - `process`: first delivery of this id (or the earlier attempt failed / never finished): send it.
 * - `duplicate`: this id was delivered: answer 200, send nothing.
 * - `in_flight`: another instance is sending it right now: answer a hook error so Supabase Auth retries later.
 * - `skipped`: the id has an unexpected shape: no shared record (send).
 * - `unavailable`: the store failed: send anyway (fail open).
 */
export type AuthHookDeliveryState = "process" | "duplicate" | "in_flight" | "skipped" | "unavailable";

export function isRecordableWebhookId(webhookId: string): boolean {
  return WEBHOOK_ID.test(webhookId);
}

export async function authHookDeliveryBegin(webhookId: string): Promise<AuthHookDeliveryState> {
  if (!isRecordableWebhookId(webhookId)) return "skipped";
  try {
    const db = getSystemDb("auth.send_email_hook");
    const { data, error } = await db.rpc("inbound_webhook_begin", { p_provider: PROVIDER, p_dedupe_key: webhookId });
    if (error) throw error;
    if (data === "process" || data === "duplicate" || data === "in_flight") return data;
    throw new Error("unexpected_begin_state");
  } catch (err) {
    log.warn({ event: "auth.email.dedupe_unavailable", module: "auth.email", code: errorTag(err) });
    return "unavailable";
  }
}

/** Records the outcome: `processed` (later retries are duplicates) or `failed` (the next retry sends). Never throws. */
export async function authHookDeliveryFinish(webhookId: string, outcome: "processed" | "failed"): Promise<void> {
  if (!isRecordableWebhookId(webhookId)) return;
  try {
    const db = getSystemDb("auth.send_email_hook");
    const { error } = await db.rpc("inbound_webhook_finish", {
      p_provider: PROVIDER,
      p_dedupe_key: webhookId,
      p_outcome: outcome,
    });
    if (error) throw error;
  } catch (err) {
    log.warn({ event: "auth.email.dedupe_unavailable", module: "auth.email", code: errorTag(err) });
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Invite acceptance (V2-05 05-07b; AUTH-06, AUTH_REDESIGN §3.2; R-30, R-44 proposed ADR-0005 amendment A4)
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Importable only from `features/auth/invite-flows.ts` (ESLint A4 zone), which calls it only after the token shape,
 * the server-side Turnstile check (R-46), the password policy and the Pwned Passwords check (FT-05).
 *
 * One function, so the Auth admin API is used only for the address the database validated for this token hash
 * (`invitation_accept_context`, migration 000089, service role + session-role rule R-38):
 *   - no account owns the invited address → `admin.createUser({ email: <that address>, password, email_confirm })`;
 *   - an UNCONFIRMED account owns it → `admin.updateUserById(id, { password, email_confirm })` (the link proved control
 *     of the mailbox; nobody could sign in to that account yet);
 *   - a CONFIRMED account owns it → `account_exists` (the invitee signs in and accepts; a password is never
 *     overwritten here);
 * then `consume_invitation_for(user, hash)` (address-bound, idempotent for the same user). The account change comes
 * first: if the redemption fails afterwards, the next attempt finds a confirmed account and the invitee accepts after
 * signing in, so no state is stuck.
 *
 * Nothing is logged but a fixed event, the step and `errorTag` (never the address, the token, its hash or a password).
 */
export type InviteRedeemOutcome =
  | { ok: true; tenantId: string; created: boolean }
  | {
      ok: false;
      code:
        | "not_found"
        | "expired"
        | "revoked"
        | "used"
        | "account_exists"
        | "email_mismatch"
        | "already_member"
        | "weak_password"
        | "failed";
    };

const TOKEN_HASH = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type AcceptContext =
  | { status: "not_found" | "expired" | "revoked" | "used" }
  | { status: "pending"; invited_address: string; user_id: string | null; email_confirmed: boolean };

function parseContext(data: unknown): AcceptContext | null {
  if (data === null || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (d.status === "not_found" || d.status === "expired" || d.status === "revoked" || d.status === "used") {
    return { status: d.status };
  }
  if (
    d.status === "pending" &&
    typeof d.invited_address === "string" &&
    d.invited_address.includes("@") &&
    (d.user_id === null || (typeof d.user_id === "string" && UUID.test(d.user_id))) &&
    typeof d.email_confirmed === "boolean"
  ) {
    return { status: "pending", invited_address: d.invited_address, user_id: d.user_id, email_confirmed: d.email_confirmed };
  }
  return null;
}

function redeemFailed(step: string, err: unknown): InviteRedeemOutcome {
  log.warn({ event: "auth.invite_accept.failed", module: "auth.invite", reason: logWord(step), code: errorTag(err) });
  return { ok: false, code: "failed" };
}

/** GoTrue's password refusals (its own policy); every other admin error is a generic failure. */
function isWeakPasswordError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === "weak_password";
}

export async function redeemInvitationWithPassword(tokenHash: string, password: string): Promise<InviteRedeemOutcome> {
  if (!TOKEN_HASH.test(tokenHash)) return { ok: false, code: "not_found" };
  const db = getSystemDb("auth.invite_accept");

  const { data, error } = await db.rpc("invitation_accept_context", { p_token_hash: tokenHash });
  if (error) return redeemFailed("context", error);
  const ctx = parseContext(data);
  if (ctx === null) return redeemFailed("context_shape", new Error("context_shape"));
  if (ctx.status !== "pending") return { ok: false, code: ctx.status };
  if (ctx.user_id !== null && ctx.email_confirmed) return { ok: false, code: "account_exists" };

  let userId: string;
  let created = false;
  if (ctx.user_id === null) {
    const { data: createdUser, error: createError } = await db.auth.admin.createUser({
      email: ctx.invited_address,
      password,
      email_confirm: true,
    });
    if (createError || !createdUser?.user) {
      if (isWeakPasswordError(createError)) return { ok: false, code: "weak_password" };
      // An account for the address appeared in between: the invitee signs in instead.
      if ((createError as { code?: unknown } | null)?.code === "email_exists") return { ok: false, code: "account_exists" };
      return redeemFailed("create_user", createError ?? new Error("no_user"));
    }
    userId = createdUser.user.id;
    created = true;
  } else {
    const { error: updateError } = await db.auth.admin.updateUserById(ctx.user_id, { password, email_confirm: true });
    if (updateError) {
      if (isWeakPasswordError(updateError)) return { ok: false, code: "weak_password" };
      return redeemFailed("complete_user", updateError);
    }
    userId = ctx.user_id;
  }

  const { data: tenantId, error: consumeError } = await db.rpc("consume_invitation_for", {
    p_user_id: userId,
    p_token_hash: tokenHash,
  });
  if (consumeError || typeof tenantId !== "string") {
    const message = typeof consumeError?.message === "string" ? consumeError.message : "";
    if (message === "INVITATION_EMAIL_MISMATCH") return { ok: false, code: "email_mismatch" };
    if (message === "ALREADY_MEMBER") return { ok: false, code: "already_member" };
    if (message === "INVITATION_REVOKED") return { ok: false, code: "revoked" };
    if (message.includes("expired")) return { ok: false, code: "expired" };
    if (message.includes("already been used")) return { ok: false, code: "used" };
    return redeemFailed("consume", consumeError ?? new Error("no_tenant"));
  }
  return { ok: true, tenantId, created };
}
