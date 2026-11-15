/**
 * V2-05 05-07b (AUTH-06, AUTH_REDESIGN §3.2; R-44 proposed ADR-0005 A4, R-46; T-05-27, T-05-29). Invite acceptance on
 * the local stack: the public action `acceptInviteWithPasswordAction` (server-side Turnstile against the loopback fake
 * siteverify, the password policy, FT-05 against the loopback fake range API, then the system path:
 * `invitation_accept_context` + the Auth admin API + `consume_invitation_for`), and the signed-in `acceptInvite`.
 *
 *   - a new invitee sets a password → the account exists (confirmed), the membership exists, sign-in works;
 *   - an UNCONFIRMED existing account → its password is replaced, it is confirmed, the membership exists;
 *   - a CONFIRMED account → the password path refuses ("sign in to accept") and changes nothing; signed in,
 *     `acceptInvite` redeems;
 *   - a different signed-in account → refused (the invitation is bound to the invited address);
 *   - a Pwned-corpus password → refused before any account change;
 *   - a Turnstile token the fake siteverify rejects → refused before any account change; with TURNSTILE_SECRET_KEY unset
 *     (staging before 05-P7) → refused, never skipped, and no siteverify request is made;
 *   - a forged, used or revoked token → refused with a fixed text.
 * Passwords are built at run time (gitleaks rule) and never printed.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import { en } from "@/messages/en";
import { AUTH_ERROR_MESSAGES } from "@/features/auth/errors";
import { getAdminClient } from "../../helpers/supabase-admin";
import { psql } from "../../helpers/sql";
import { seedTenantWithOwner, type SeededTenant } from "../../helpers/tenants";
import { canSignIn } from "../../helpers/auth-flows";
import { letters } from "../../jobs/helpers";
import { startPwnedRangeServer, BREACHED_FIXTURE_PASSWORDS, type PwnedRangeServer } from "../../e2e/support/pwned-range-server";
import { startTurnstileVerifyServer, type TurnstileVerifyServer } from "../../e2e/support/turnstile-verify-server";
import { TURNSTILE_PASS_SECRET_KEY } from "../../setup/test-env";
// vi.mock below is hoisted above these imports: the signed-in path resolves the session through the mocked client.
import { acceptInviteWithPasswordAction } from "@/features/auth/actions";
import { acceptInvite } from "@/features/staff/actions";

const state = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/supabase/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/server")>();
  return { ...actual, createClient: async () => state.client };
});

const admin = getAdminClient();
const M = en.auth.invite;
const WIDGET_TOKEN = ["XXXX", "DUMMY", "TOKEN", letters(8)].join(".");
let owner: SeededTenant;
let siteverify: TurnstileVerifyServer;
let range: PwnedRangeServer;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function uuid(v: string): string {
  if (!UUID.test(v)) throw new Error("not a uuid");
  return v;
}

/** A password that meets the policy, built at run time. */
function strongPassword(): string {
  return `Inv-${randomBytes(12).toString("base64url")}`;
}

function address(label: string): string {
  return `accept-${label}-${letters(8)}@example.test`;
}

function anon() {
  return createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** An invitation to `email` created by the owner (invite_staff) and its raw token minted as the handler does. */
async function invitation(email: string, role = "doctor"): Promise<{ id: string; token: string }> {
  const { data, error } = await owner.client.rpc("invite_staff", { p_tenant: owner.tenantId, p_email: email, p_role: role });
  if (error) throw new Error(`invite_staff failed: ${error.code}`);
  const id = (data as { id: string }).id;
  const minted = await admin.rpc("invitation_issue_token", { p_invitation_id: id, p_token_version: 1 });
  if (minted.error || typeof minted.data !== "string") throw new Error(`issue token failed: ${minted.error?.code}`);
  return { id, token: minted.data };
}

async function userIdFor(email: string): Promise<string | null> {
  const rows = psql(`select id from auth.users where lower(email) = lower('${email.replace(/'/g, "''")}')`);
  return rows[0] ?? null;
}

function membershipOf(userId: string): string | null {
  const rows = psql(
    `select role || '|' || status from public.memberships where tenant_id = '${uuid(owner.tenantId)}' and user_id = '${uuid(userId)}'`,
  );
  return rows[0] ?? null;
}

function invitationState(id: string): string {
  return psql(`select (consumed_at is not null) || '|' || (revoked_at is not null) from public.invitations where id = '${uuid(id)}'`)[0];
}

function accept(token: string, password: string, widget = WIDGET_TOKEN) {
  return acceptInviteWithPasswordAction({ token, password, turnstileToken: widget });
}

beforeAll(async () => {
  owner = await seedTenantWithOwner(`Invite Accept Clinic ${letters(6)}`);
  siteverify = await startTurnstileVerifyServer({ hostname: "localhost" });
  range = await startPwnedRangeServer();
});

beforeEach(() => {
  vi.stubEnv("TURNSTILE_SECRET_KEY", TURNSTILE_PASS_SECRET_KEY);
  vi.stubEnv("TURNSTILE_VERIFY_URL", siteverify.url);
  vi.stubEnv("PWNED_CHECK", "on");
  vi.stubEnv("PWNED_API_BASE_URL", range.url);
  state.client = anon();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await siteverify.close();
  await range.close();
});

describe("acceptInviteWithPasswordAction (new invitee, public, token-gated)", () => {
  it("a new invitee sets a password: account created and confirmed, membership exists, sign-in works", async () => {
    const email = address("new");
    const { id, token } = await invitation(email, "doctor");
    const password = strongPassword();
    const before = siteverify.requests.length;

    expect(await accept(token, password)).toEqual({ ok: true });
    expect(siteverify.requests.length).toBe(before + 1);

    const userId = await userIdFor(email);
    expect(userId).not.toBeNull();
    expect(psql(`select email_confirmed_at is not null from auth.users where id = '${uuid(userId as string)}'`)[0]).toBe("t");
    expect(membershipOf(userId as string)).toBe("doctor|active");
    expect(invitationState(id)).toBe("true|false");
    expect(await canSignIn(email, password)).toBe(true);

    // The link is single-use: a second attempt changes nothing.
    expect(await accept(token, strongPassword())).toEqual({ ok: false, message: M.used });
    expect(await canSignIn(email, password)).toBe(true);
  });

  it("an unconfirmed existing account: its password is replaced, it is confirmed, the membership exists", async () => {
    const email = address("unconfirmed");
    const { data: created, error } = await admin.auth.admin.createUser({ email, password: strongPassword(), email_confirm: false });
    if (error || !created.user) throw new Error(`unconfirmed account failed: ${error?.code}`);
    const { token } = await invitation(email, "nurse");
    const password = strongPassword();

    expect(await accept(token, password)).toEqual({ ok: true });
    expect(await userIdFor(email)).toBe(created.user.id);
    expect(psql(`select email_confirmed_at is not null from auth.users where id = '${uuid(created.user.id)}'`)[0]).toBe("t");
    expect(membershipOf(created.user.id)).toBe("nurse|active");
    expect(await canSignIn(email, password)).toBe(true);
  });

  it("a confirmed account: the password path refuses and changes nothing; signed in, acceptInvite redeems", async () => {
    const email = address("confirmed");
    const original = strongPassword();
    const { data: created, error } = await admin.auth.admin.createUser({ email, password: original, email_confirm: true });
    if (error || !created.user) throw new Error(`confirmed account failed: ${error?.code}`);
    const { id, token } = await invitation(email, "receptionist");

    expect(await accept(token, strongPassword())).toEqual({ ok: false, message: M.account_exists });
    expect(await canSignIn(email, original)).toBe(true);
    expect(membershipOf(created.user.id)).toBeNull();
    expect(invitationState(id)).toBe("false|false");

    const session = anon();
    expect((await session.auth.signInWithPassword({ email, password: original })).error).toBeNull();
    state.client = session;
    expect(await acceptInvite(token)).toEqual({ success: true, tenantId: owner.tenantId });
    expect(membershipOf(created.user.id)).toBe("receptionist|active");
  });

  it("a different signed-in account cannot accept someone else's invitation", async () => {
    const email = address("intended");
    const { id, token } = await invitation(email, "doctor");
    const otherEmail = address("other");
    const otherPassword = strongPassword();
    const { data: other, error } = await admin.auth.admin.createUser({ email: otherEmail, password: otherPassword, email_confirm: true });
    if (error || !other.user) throw new Error(`other account failed: ${error?.code}`);
    const session = anon();
    expect((await session.auth.signInWithPassword({ email: otherEmail, password: otherPassword })).error).toBeNull();
    state.client = session;

    expect(await acceptInvite(token)).toEqual({ success: false, error: M.email_mismatch });
    expect(membershipOf(other.user.id)).toBeNull();
    expect(invitationState(id)).toBe("false|false");
  });

  it("a Pwned-corpus password is refused before any account change", async () => {
    const email = address("pwned");
    const { id, token } = await invitation(email);
    const before = range.requests.length;

    expect(await accept(token, BREACHED_FIXTURE_PASSWORDS[0])).toEqual({ ok: false, message: AUTH_ERROR_MESSAGES.pwned_password });
    expect(range.requests.length).toBe(before + 1);
    expect(await userIdFor(email)).toBeNull();
    expect(invitationState(id)).toBe("false|false");
  });

  it("a password under the policy is refused before any account change", async () => {
    const email = address("short");
    const { id, token } = await invitation(email);
    const result = await accept(token, "short");
    expect(result.ok).toBe(false);
    expect(await userIdFor(email)).toBeNull();
    expect(invitationState(id)).toBe("false|false");
  });

  it("a Turnstile token the siteverify rejects is refused before any account change", async () => {
    const email = address("captcha");
    const { id, token } = await invitation(email);
    const before = range.requests.length;

    expect(await accept(token, strongPassword(), `fail.${WIDGET_TOKEN}`)).toEqual({ ok: false, message: en.auth.captcha.failed });
    expect(await accept(token, strongPassword(), "")).toEqual({ ok: false, message: en.auth.captcha.failed });
    expect(range.requests.length).toBe(before); // nothing after the CAPTCHA ran
    expect(await userIdFor(email)).toBeNull();
    expect(invitationState(id)).toBe("false|false");
  });

  it("TURNSTILE_SECRET_KEY unset (staging before 05-P7): refused, never skipped, no siteverify request", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    const email = address("nosecret");
    const { id, token } = await invitation(email);
    const before = siteverify.requests.length;

    expect(await accept(token, strongPassword())).toEqual({ ok: false, message: M.captcha_unconfigured });
    expect(siteverify.requests.length).toBe(before);
    expect(await userIdFor(email)).toBeNull();
    expect(invitationState(id)).toBe("false|false");
  });

  it("forged, revoked and malformed tokens are refused with fixed texts", async () => {
    expect(await accept(randomBytes(32).toString("hex"), strongPassword())).toEqual({ ok: false, message: M.not_found });
    expect(await accept("not-a-token", strongPassword())).toEqual({ ok: false, message: M.not_found });

    const email = address("revoked");
    const { id, token } = await invitation(email);
    const revoked = await owner.client.rpc("revoke_invitation", { p_invitation_id: id });
    expect(revoked.error).toBeNull();
    // revoke clears the hash, so the link is unknown now.
    expect(await accept(token, strongPassword())).toEqual({ ok: false, message: M.not_found });
    expect(await userIdFor(email)).toBeNull();
  });
});
