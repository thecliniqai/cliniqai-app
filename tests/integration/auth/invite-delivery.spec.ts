/**
 * V2-05 05-07b (AUTH-06; roadmap acceptance 10 "one invite sends exactly one email under retry"; R-30; T-05-30).
 * The whole path on the local stack: the `inviteStaff` / `resendInvite` server actions (owner session) → `invite_staff`
 * / `resend_invitation` (000088) enqueue `email.invite` jobs → real runner passes (`runJobs`, the parallel-dispatcher
 * shape of 04-01) with the real `email.invite` handler → `getEmailSender()` → the local Mailpit (HTTP API on loopback).
 *
 *   (i)   `inviteStaff` twice for one address → one invitation and ONE job;
 *   (ii)  5 parallel runner passes → Mailpit holds exactly one `staff-invite` message for the address;
 *   (iii) a transport failure injected on the first attempt → the job retries and the total is still one, and the one
 *         delivered link works (the token minted for the failed attempt is dead);
 *   (iv)  `resendInvite` → exactly one more message; the first link's `peek` is no longer pending and it cannot be
 *         redeemed; the second link redeems.
 * Counts are of messages tagged `staff-invite` to a fresh synthetic address per case (GoTrue's own mail is never
 * counted). Residual window (send accepted, crash before `complete_job`) is documented in the 05-07b record, not hidden.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { EmailSendError, getEmailSender, type EmailSender } from "@/lib/email";
import { createEmailInviteHandler, EMAIL_INVITE_HANDLERS, EMAIL_INVITE_KIND } from "@/lib/jobs/internal/handlers/email-invite";
import { hashInviteToken } from "@/features/staff/invite";
import { publicEnv } from "@/lib/env";
import type { HandlerMap } from "@/lib/jobs/internal/types";
import { getAdminClient } from "../../helpers/supabase-admin";
import { psql } from "../../helpers/sql";
import { seedTenantWithOwner, seededUserPassword, type SeededTenant } from "../../helpers/tenants";
import { deleteMail, mailMessage, runKinds, useMailpitAlerts } from "../../jobs/alert-helpers";
import { deleteRunnerRuns, letters } from "../../jobs/helpers";
import { LOCAL_MAILPIT_API_URL } from "../../setup/test-env";
// vi.mock below is hoisted above this import: the actions resolve the session through the mocked user client.
import { inviteStaff, resendInvite } from "@/features/staff/actions";

const state = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/supabase/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/server")>();
  return { ...actual, createClient: async () => state.client };
});

const WORKER = `test:invite-delivery-${letters(6)}`;
const admin = getAdminClient();
const mailIds: string[] = [];
let owner: SeededTenant;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LINK = /\/join\?token=([0-9a-f]{64})(?![0-9a-f])/;

function uuid(v: string): string {
  if (!UUID.test(v)) throw new Error("not a uuid");
  return v;
}

function address(label: string): string {
  return `invite-${label}-${letters(8)}@example.test`;
}

interface MailSummary {
  ID: string;
  Tags: string[];
}

/** Messages to `to` tagged `staff-invite` (the only ones counted). */
async function inviteMail(to: string): Promise<MailSummary[]> {
  const query = `to:"${to}" tag:staff-invite`;
  const res = await fetch(`${LOCAL_MAILPIT_API_URL}/api/v1/search?query=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error(`Mailpit search failed (HTTP ${res.status})`);
  const found = ((await res.json()) as { messages?: MailSummary[] }).messages ?? [];
  for (const m of found) if (!mailIds.includes(m.ID)) mailIds.push(m.ID);
  return found.filter((m) => m.Tags.includes("staff-invite"));
}

/** The raw token of the one link in a message (never printed). */
async function tokenOf(messageId: string): Promise<string> {
  const msg = await mailMessage(messageId);
  const match = LINK.exec(msg.Text);
  if (!match) throw new Error("no join link in the message");
  return match[1];
}

function jobsOf(invitationId: string): Array<{ status: string; attempts: number; key: string; lastError: string | null }> {
  return psql(
    "select status || '|' || attempts || '|' || dedupe_key || '|' || coalesce(last_error, '') from ops.jobs " +
      `where kind = '${EMAIL_INVITE_KIND}' and payload ->> 'invitation_id' = '${uuid(invitationId)}' order by created_at, id`,
  ).map((line) => {
    const [status, attempts, key, lastError] = line.split("|");
    return { status, attempts: Number(attempts), key, lastError: lastError || null };
  });
}

function anon() {
  return createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function peekStatus(rawToken: string): Promise<string> {
  const { data, error } = await anon().rpc("peek_invitation", { p_token_hash: hashInviteToken(rawToken) });
  if (error) throw new Error(`peek failed: ${error.code}`);
  return String((data as { status?: unknown }).status);
}

async function invite(email: string): Promise<string> {
  state.client = owner.client;
  const result = await inviteStaff({ email, role: "nurse" });
  if (!result.success) throw new Error(`inviteStaff failed: ${result.error}`);
  return result.inviteId;
}

function pass(label: string, handlers: HandlerMap = EMAIL_INVITE_HANDLERS) {
  return runKinds([EMAIL_INVITE_KIND], handlers, `${WORKER}:${label}`);
}

beforeAll(async () => {
  owner = await seedTenantWithOwner(`Invite Delivery Clinic ${letters(6)}`);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(async () => {
  deleteRunnerRuns(WORKER);
  await deleteMail(mailIds);
});

describe("acceptance 10: one invite sends exactly one email under retry", () => {
  it("(i) inviteStaff twice for one address → one invitation, one job", async () => {
    const email = address("twice");
    const first = await invite(email);
    const second = await invite(email.toUpperCase());
    expect(second).toBe(first);
    const jobs = jobsOf(first);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ status: "pending", key: `invite:${first}:v1` });
  });

  it("(ii) 5 parallel runner passes → exactly one message in Mailpit; the job is done after one attempt", async () => {
    useMailpitAlerts();
    const email = address("parallel");
    const id = await invite(email);

    const results = await Promise.all([1, 2, 3, 4, 5].map((n) => pass(`parallel-${n}`)));
    expect(results.every((r) => r.ok)).toBe(true);

    const mail = await inviteMail(email);
    expect(mail).toHaveLength(1);
    expect(jobsOf(id)).toEqual([{ status: "done", attempts: 1, key: `invite:${id}:v1`, lastError: null }]);
    const [row] = psql(`select send_count || '|' || (token_hash is not null) from public.invitations where id = '${uuid(id)}'`);
    expect(row).toBe("1|true");
    // The delivered link is the live one.
    expect(await peekStatus(await tokenOf(mail[0].ID))).toBe("pending");

    // Later passes send nothing more for this invitation.
    await pass("parallel-after");
    expect(await inviteMail(email)).toHaveLength(1);
  });

  it("(iii) a transport failure on the first attempt → retried, still exactly one message, and its link works", async () => {
    useMailpitAlerts();
    const email = address("retry");
    const id = await invite(email);

    let failures = 0;
    const flaky: HandlerMap = {
      [EMAIL_INVITE_KIND]: createEmailInviteHandler({
        sender: (env): EmailSender => {
          const real = getEmailSender(env);
          return {
            provider: real.provider,
            async send(message, options) {
              if (message.to === email && failures === 0) {
                failures += 1;
                throw new EmailSendError("synthetic_503");
              }
              return real.send(message, options);
            },
          };
        },
      }) as HandlerMap[string],
    };

    const first = await pass("retry-1", flaky);
    expect(first.retried).toBeGreaterThanOrEqual(1);
    expect(jobsOf(id)).toEqual([{ status: "pending", attempts: 1, key: `invite:${id}:v1`, lastError: "synthetic_503" }]);
    expect(await inviteMail(email)).toHaveLength(0);

    // The retry is due now (instead of after the backoff).
    psql(`update ops.jobs set run_at = now() where kind = '${EMAIL_INVITE_KIND}' and payload ->> 'invitation_id' = '${uuid(id)}'`);
    await pass("retry-2", flaky);

    const mail = await inviteMail(email);
    expect(mail).toHaveLength(1);
    expect(failures).toBe(1);
    expect(jobsOf(id)).toEqual([{ status: "done", attempts: 2, key: `invite:${id}:v1`, lastError: "synthetic_503" }]);
    // Two tokens were minted (one per attempt); only the delivered one is live.
    const [row] = psql(`select send_count from public.invitations where id = '${uuid(id)}'`);
    expect(row).toBe("2");
    expect(await peekStatus(await tokenOf(mail[0].ID))).toBe("pending");
  });

  it("(iv) resendInvite → exactly one more message; the first link is dead, the second redeems", async () => {
    useMailpitAlerts();
    const email = address("resend");
    const id = await invite(email);
    await pass("resend-1");
    const firstMail = await inviteMail(email);
    expect(firstMail).toHaveLength(1);
    const firstToken = await tokenOf(firstMail[0].ID);

    state.client = owner.client;
    const resent = await resendInvite({ invitationId: id });
    expect(resent).toMatchObject({ success: true, invitationId: id });
    expect(jobsOf(id).map((j) => j.key)).toEqual([`invite:${id}:v1`, `invite:${id}:v2`]);
    // The old link is dead at once (before the new email is even sent).
    expect(await peekStatus(firstToken)).toBe("not_found");

    await Promise.all([1, 2, 3].map((n) => pass(`resend-2-${n}`)));
    const allMail = await inviteMail(email);
    expect(allMail).toHaveLength(2);
    const secondId = allMail.map((m) => m.ID).find((m) => m !== firstMail[0].ID);
    const secondToken = await tokenOf(secondId as string);
    expect(secondToken).not.toBe(firstToken);
    expect(await peekStatus(secondToken)).toBe("pending");

    // The invitee (a confirmed account for the address) redeems: the first link fails, the second succeeds.
    const { data: created, error } = await admin.auth.admin.createUser({ email, password: seededUserPassword(), email_confirm: true });
    if (error || !created.user) throw new Error(`invitee account failed: ${error?.code}`);
    const invitee = anon();
    const signIn = await invitee.auth.signInWithPassword({ email, password: seededUserPassword() });
    expect(signIn.error).toBeNull();
    const stale = await invitee.rpc("consume_invitation", { p_token_hash: hashInviteToken(firstToken) });
    expect(stale.error?.message).toBe("Invalid invitation token");
    const redeemed = await invitee.rpc("consume_invitation", { p_token_hash: hashInviteToken(secondToken) });
    expect(redeemed.error).toBeNull();
    expect(redeemed.data).toBe(owner.tenantId);
    const { data: membership } = await admin
      .from("memberships")
      .select("role, status")
      .eq("tenant_id", owner.tenantId)
      .eq("user_id", created.user.id)
      .single();
    expect(membership).toEqual({ role: "nurse", status: "active" });

    // Nothing more is sent for the consumed invitation.
    await pass("resend-after");
    expect(await inviteMail(email)).toHaveLength(2);
  });

  it("each message is link-only: the clinic, the role, the /join link and the expiry; no other address", async () => {
    useMailpitAlerts();
    const email = address("content");
    await invite(email);
    await pass("content");
    const [mail] = await inviteMail(email);
    const msg = await mailMessage(mail.ID);
    expect(msg.Subject).toBe(`You're invited to join ${owner.tenantName} on ClinicOS`);
    expect(msg.To.map((t) => t.Address)).toEqual([email]);
    expect(msg.Text).toContain(`You have been invited to join ${owner.tenantName} on ClinicOS as Nurse.`);
    expect(msg.Text).toMatch(/expires on \d{1,2} [A-Z][a-z]+ \d{4}(,| at) \d{2}:\d{2} IST/);
    expect(msg.Text).not.toContain(owner.userEmail);
    expect(msg.Text).not.toMatch(/storage\/v1|supabase/i);
    expect(msg.HTML).not.toContain(owner.userEmail);
    expect(msg.Tags).toEqual(["staff-invite"]);
  });
});
