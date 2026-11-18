/**
 * Job kind `email.invite` (V2-05 05-07b; AUTH-06, AUTH_REDESIGN §3.2; R-30; acceptance 10 "one invite sends exactly
 * one email under retry"; T-05-28, T-05-30). One job per invitation token version, enqueued by `invite_staff` /
 * `resend_invitation` (migration 000088) in the same transaction as the invitation, payload
 * `{ invitation_id, token_version }`, dedupe key `invite:<id>:v<n>`, at most 5 attempts.
 *
 * 1. Read the invitation (service role): its clinic's name, the role, the address and the expiry. Missing → done (a
 *    deleted clinic sends nothing); consumed, revoked, expired or on another version → done, nothing sent.
 * 2. `invitation_issue_token(id, version)` mints the raw token now (only its SHA-256 is stored) and returns it once, or
 *    NULL when the invitation stopped being sendable in between → done, nothing sent. Each call mints a NEW token, so a
 *    retry after a transport failure invalidates the token of the message that was not delivered.
 * 3. `getEmailSender().send({ to, subject, html, text, tag: "staff-invite" }, { signal })` with the link
 *    `<NEXT_PUBLIC_APP_URL>/join?token=<raw>`. `EmailSendError` → retry with its safe code; `EmailDisabledError` →
 *    dead `email_disabled`; a configuration error → dead with its code.
 *
 * Exactly one email: the runner claims a job once (`claim_jobs` + lease fencing), the dedupe key makes one job per
 * version, a stale version mints nothing, and a failed send is retried by the same job. The residual window (the
 * provider accepted the message, then the process died before `complete_job`) re-sends after the lease expires, with a
 * new token that makes the first link dead (research Pitfall 16; documented in the 05-07b record). No idempotency key
 * is passed: each attempt carries a different token, and a provider that replays a key would deliver a dead link.
 *
 * Nothing about the invitation is logged: the runner logs counts only, and every outcome code here is fixed.
 */
import { z } from "zod";
import {
  EmailConfigError,
  EmailDisabledError,
  EmailSendError,
  getEmailSender,
  safeCode,
  type EmailMessage,
  type EmailSender,
} from "@/lib/email";
import { renderInviteEmail } from "@/lib/email/templates/invite";
import type { Env } from "@/lib/env";
import { serverEnv } from "@/lib/env-server";
import { errorTag } from "@/lib/log";
import type { HandlerResult, JobHandler, JobsDb } from "../types";

export const EMAIL_INVITE_KIND = "email.invite";

const PAYLOAD = z
  .object({ invitation_id: z.string().uuid(), token_version: z.number().int().min(1).max(1_000_000) })
  .strict();
type Payload = z.infer<typeof PAYLOAD>;

const RAW_TOKEN = /^[0-9a-f]{64}$/;

const INVITATION = z.object({
  id: z.string().uuid(),
  role: z.string(),
  invited_address: z.string().email(),
  expires_at: z.string(),
  token_version: z.number().int(),
  consumed_at: z.string().nullable(),
  revoked_at: z.string().nullable(),
  tenants: z.object({ name: z.string() }).nullable(),
});

export interface EmailInviteOptions {
  /** The parsed environment (default: `serverEnv()`). */
  env?: () => Env;
  /** The sender for an environment (default: `getEmailSender`). */
  sender?: (env: Env) => EmailSender;
}

function code(prefix: string, err: unknown): string {
  return `${prefix}:${errorTag(err)}`.slice(0, 64);
}

/** The absolute `/join` link for a raw token (the token is the only query parameter; no address in the URL). */
export function joinUrl(appUrl: string, rawToken: string): string {
  const url = new URL("/join", appUrl);
  url.searchParams.set("token", rawToken);
  return url.toString();
}

async function loadInvitation(db: JobsDb, id: string) {
  return db
    .from("invitations")
    .select("id, role, invited_address, expires_at, token_version, consumed_at, revoked_at, tenants(name)")
    .eq("id", id)
    .maybeSingle();
}

export function createEmailInviteHandler(options: EmailInviteOptions = {}): JobHandler<Payload> {
  const envFor = options.env ?? serverEnv;
  const senderFor = options.sender ?? ((env: Env) => getEmailSender(env));
  return {
    schema: PAYLOAD,
    // Providers bound their own calls (Resend 3 s, SES/Mailpit their clients) and abort on this signal.
    maxDurationMs: 10_000,
    async run(_job, payload, ctx): Promise<HandlerResult> {
      let env: Env;
      try {
        env = envFor();
      } catch (err) {
        return { outcome: "retry", code: code("env", err) };
      }
      if (env.EMAIL_PROVIDER === "disabled") return { outcome: "dead", code: "email_disabled" };

      const { data, error } = await loadInvitation(ctx.db, payload.invitation_id);
      if (error) return { outcome: "retry", code: "invitation_read_failed" };
      if (data === null) return { outcome: "done" };
      const parsed = INVITATION.safeParse(data);
      if (!parsed.success) return { outcome: "dead", code: "invitation_invalid" };
      const invitation = parsed.data;
      // A stale or dead job: nothing to send (the token would not be minted anyway).
      if (
        invitation.token_version !== payload.token_version ||
        invitation.consumed_at !== null ||
        invitation.revoked_at !== null ||
        Date.parse(invitation.expires_at) <= ctx.now().getTime()
      ) {
        return { outcome: "done" };
      }

      let sender: EmailSender;
      try {
        sender = senderFor(env);
      } catch (err) {
        return { outcome: "dead", code: err instanceof EmailConfigError ? safeCode(err.code, "email_config") : code("sender", err) };
      }

      const { data: token, error: tokenError } = await ctx.db.rpc("invitation_issue_token", {
        p_invitation_id: invitation.id,
        p_token_version: payload.token_version,
      });
      if (tokenError) return { outcome: "retry", code: "issue_token_failed" };
      if (token === null) return { outcome: "done" };
      if (typeof token !== "string" || !RAW_TOKEN.test(token)) return { outcome: "dead", code: "issue_token_invalid" };

      const rendered = renderInviteEmail({
        clinicName: invitation.tenants?.name ?? "",
        role: invitation.role,
        joinUrl: joinUrl(env.NEXT_PUBLIC_APP_URL, token),
        expiresAt: invitation.expires_at,
      });
      const message: EmailMessage = {
        to: invitation.invited_address,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
        tag: rendered.tag,
      };
      try {
        await sender.send(message, { signal: ctx.signal });
      } catch (err) {
        if (err instanceof EmailDisabledError) return { outcome: "dead", code: "email_disabled" };
        if (err instanceof EmailConfigError) return { outcome: "dead", code: safeCode(err.code, "email_config") };
        if (err instanceof EmailSendError) return { outcome: "retry", code: safeCode(err.code, "email_send_failed") };
        return { outcome: "retry", code: code("email_threw", err) };
      }
      return { outcome: "done" };
    },
  };
}

export const EMAIL_INVITE_HANDLERS = {
  [EMAIL_INVITE_KIND]: createEmailInviteHandler() as JobHandler<unknown>,
};
