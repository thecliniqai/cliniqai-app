/**
 * V2-05 05-07b: the `email.invite` job handler (lib/jobs/internal/handlers/email-invite.ts) through the real runner on
 * the local queue, with a recording sender (no transport). R-30, T-05-28, T-05-30.
 *
 *   - a stale `token_version` (the invitation was resent) → no token minted, nothing sent, the job completes;
 *   - a revoked, a consumed and an expired invitation → nothing sent, done; the handler is registered in production;
 *   - a current job → one message: to the invited address, tag `staff-invite`, the `/join?token=` link whose SHA-256
 *     is the stored hash, the clinic name and the role; no patient data (a synthetic patient of the same clinic) and no
 *     storage URL; the job payload never carries the token;
 *   - `EMAIL_PROVIDER=disabled` → dead `email_disabled`; a transport failure → retry with the sender's safe code.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { EmailSendError, type EmailMessage, type EmailSender } from "@/lib/email";
import { createEmailInviteHandler, EMAIL_INVITE_KIND } from "@/lib/jobs/internal/handlers/email-invite";
import { getJobHandlers } from "@/lib/jobs/internal/registry";
import type { HandlerMap } from "@/lib/jobs/internal/types";
import { hashInviteToken } from "@/features/staff/invite";
import { psql } from "../helpers/sql";
import { seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { runKinds, useMailpitAlerts } from "./alert-helpers";
import { deleteRunnerRuns, letters } from "./helpers";
import { seedPatient } from "./message-helpers";

const WORKER = `test:email-invite-${letters(6)}`;
let owner: SeededTenant;
let patientName: string;
let patientPhone: string;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function uuid(v: string): string {
  if (!UUID.test(v)) throw new Error("not a uuid");
  return v;
}

function recording(fail?: (m: EmailMessage) => Error | null) {
  const sent: EmailMessage[] = [];
  const handlers: HandlerMap = {
    [EMAIL_INVITE_KIND]: createEmailInviteHandler({
      sender: (): EmailSender => ({
        provider: "mailpit",
        async send(message) {
          const err = fail?.(message) ?? null;
          if (err) throw err;
          sent.push(message);
          return { providerMessageId: `rec-${sent.length}` };
        },
      }),
    }) as HandlerMap[string],
  };
  return { sent, handlers };
}

async function invite(email: string): Promise<string> {
  const { data, error } = await owner.client.rpc("invite_staff", { p_tenant: owner.tenantId, p_email: email, p_role: "doctor" });
  if (error) throw new Error(`invite_staff failed: ${error.code}`);
  return (data as { id: string }).id;
}

function job(id: string, version = 1): { status: string; lastError: string | null; payload: string } {
  const [line] = psql(
    "select status || '|' || coalesce(last_error, '') || '|' || payload::text from ops.jobs " +
      `where kind = '${EMAIL_INVITE_KIND}' and dedupe_key = 'invite:${uuid(id)}:v${version}'`,
  );
  const [status, lastError, ...rest] = line.split("|");
  return { status, lastError: lastError || null, payload: rest.join("|") };
}

function due(id: string): void {
  psql(`update ops.jobs set run_at = now() where kind = '${EMAIL_INVITE_KIND}' and payload ->> 'invitation_id' = '${uuid(id)}'`);
}

beforeAll(async () => {
  owner = await seedTenantWithOwner(`Invite Handler Clinic ${letters(6)}`);
  const patient = await seedPatient(owner.tenantId, owner.userId);
  [patientName, patientPhone] = psql(`select full_name || '|' || phone from public.patients where id = '${uuid(patient.patientId)}'`)[0].split("|");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(() => {
  deleteRunnerRuns(WORKER);
});

describe("email.invite handler", () => {
  it("is registered with the production handlers (the runner claims the kind)", () => {
    expect(Object.keys(getJobHandlers())).toContain(EMAIL_INVITE_KIND);
  });

  it("a current job sends one link-only message whose token hashes to the stored hash; no PHI, no storage URL", async () => {
    useMailpitAlerts();
    const email = `handler-ok-${letters(8)}@example.test`;
    const id = await invite(email);
    const { sent, handlers } = recording();
    const result = await runKinds([EMAIL_INVITE_KIND], handlers, `${WORKER}:ok`);
    expect(result.ok).toBe(true);

    const mine = sent.filter((m) => m.to === email);
    expect(mine).toHaveLength(1);
    const [msg] = mine;
    expect(msg.tag).toBe("staff-invite");
    expect(msg.subject).toBe(`You're invited to join ${owner.tenantName} on ClinicOS`);
    const token = /\/join\?token=([0-9a-f]{64})/.exec(msg.text)?.[1];
    expect(token).toBeDefined();
    expect(msg.html).toContain(`/join?token=${token}`);
    const [stored] = psql(`select token_hash from public.invitations where id = '${uuid(id)}'`);
    expect(stored).toBe(hashInviteToken(token as string));
    for (const part of [msg.subject, msg.text, msg.html]) {
      expect(part).not.toContain(patientName);
      expect(part).not.toContain(patientPhone);
      expect(part).not.toContain(owner.userEmail);
      expect(part).not.toMatch(/storage\/v1|\/object\/|supabase\.co|127\.0\.0\.1:54321/);
    }
    // Only the invited address and the link's token; the job never carried the token.
    expect(job(id)).toMatchObject({ status: "done", lastError: null });
    expect(job(id).payload).not.toContain(token as string);
  });

  it("a stale token_version (the invitation was resent) mints nothing, sends nothing, completes", async () => {
    useMailpitAlerts();
    const email = `handler-stale-${letters(8)}@example.test`;
    const id = await invite(email);
    const resent = await owner.client.rpc("resend_invitation", { p_invitation_id: id });
    expect(resent.error).toBeNull();
    // Run only the v1 job: push v2 into the future.
    psql(`update ops.jobs set run_at = now() + interval '1 day' where dedupe_key = 'invite:${uuid(id)}:v2'`);
    const { sent, handlers } = recording();
    await runKinds([EMAIL_INVITE_KIND], handlers, `${WORKER}:stale`);

    expect(sent.filter((m) => m.to === email)).toHaveLength(0);
    expect(job(id, 1)).toMatchObject({ status: "done", lastError: null });
    expect(psql(`select send_count || '|' || (token_hash is null) from public.invitations where id = '${uuid(id)}'`)[0]).toBe("0|true");

    // The current (v2) job sends exactly one.
    due(id);
    await runKinds([EMAIL_INVITE_KIND], handlers, `${WORKER}:stale-v2`);
    expect(sent.filter((m) => m.to === email)).toHaveLength(1);
    expect(job(id, 2)).toMatchObject({ status: "done" });
  });

  it("a revoked, a consumed and an expired invitation send nothing and complete", async () => {
    useMailpitAlerts();
    const revoked = await invite(`handler-revoked-${letters(8)}@example.test`);
    expect((await owner.client.rpc("revoke_invitation", { p_invitation_id: revoked })).error).toBeNull();
    const expired = await invite(`handler-expired-${letters(8)}@example.test`);
    psql(`update public.invitations set expires_at = now() - interval '1 minute' where id = '${uuid(expired)}'`);
    const consumed = await invite(`handler-consumed-${letters(8)}@example.test`);
    psql(`update public.invitations set consumed_at = now(), consumed_by = '${uuid(owner.userId)}' where id = '${uuid(consumed)}'`);

    const { sent, handlers } = recording();
    await runKinds([EMAIL_INVITE_KIND], handlers, `${WORKER}:dead`);
    const addresses = psql(
      `select invited_address from public.invitations where id in ('${revoked}', '${expired}', '${consumed}')`,
    );
    expect(sent.filter((m) => addresses.includes(m.to))).toHaveLength(0);
    for (const id of [revoked, expired, consumed]) expect(job(id)).toMatchObject({ status: "done", lastError: null });
  });

  it("EMAIL_PROVIDER=disabled → dead email_disabled; a transport failure → retry with the safe code", async () => {
    vi.stubEnv("EMAIL_PROVIDER", "disabled");
    const disabled = await invite(`handler-disabled-${letters(8)}@example.test`);
    await runKinds([EMAIL_INVITE_KIND], recording().handlers, `${WORKER}:disabled`);
    expect(job(disabled)).toMatchObject({ status: "dead", lastError: "email_disabled" });
    expect(psql(`select send_count from public.invitations where id = '${uuid(disabled)}'`)[0]).toBe("0");

    useMailpitAlerts();
    const email = `handler-transport-${letters(8)}@example.test`;
    const failing = await invite(email);
    const { sent, handlers } = recording((m) => (m.to === email ? new EmailSendError("synthetic_503") : null));
    await runKinds([EMAIL_INVITE_KIND], handlers, `${WORKER}:transport`);
    expect(sent.filter((m) => m.to === email)).toHaveLength(0);
    expect(job(failing)).toMatchObject({ status: "pending", lastError: "synthetic_503" });
  });
});
