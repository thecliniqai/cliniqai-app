/**
 * AUTH-01 + AUTH-04a integration tests (01-06) against the local stack and Mailpit.
 *
 * - Seeded users sign in by password through the app's `signIn` flow; a normal login sends 0 emails.
 * - Forgot password: one code-only email per request, `verifyOtp` type `recovery` in the browser-like client, then the
 *   reset server action's service (`setNewPassword`, 03-12a) on that client's session: `updateUser`, then
 *   `signOut({ scope: 'others' })`. All reset calls use a PKCE client, as the app's `@supabase/ssr` browser client does.
 * - Self-service signup is off until AUTH-07 (01-06 ruling R1).
 *
 * Codes and passwords are never printed: assertions on them use booleans only.
 */
import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import { Database } from "@/lib/db/types";
import { AUTH_MESSAGES, completeReset, requestReset, signIn } from "@/features/auth/password-flows";
import { setNewPassword } from "@/features/auth/service";
import { addMemberToTenant, seedTenantWithOwner, seededUserPassword, type SeededTenant } from "../../helpers/tenants";
import { getAdminClient } from "../../helpers/supabase-admin";

const MAILPIT = "http://127.0.0.1:54324";
const INGEST_WAIT_MS = 1_500;

// ---------------------------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------------------------

/** A client configured like the browser client: PKCE flow, persisted session in (memory) storage. */
function browserLikeClient() {
  const store = new Map<string, string>();
  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  const client = createClient<Database>(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { flowType: "pkce", persistSession: true, autoRefreshToken: false, detectSessionInUrl: false, storage },
  });
  return { client, store };
}

function jwtClaims(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
}

function amrMethods(token: string): string[] {
  const amr = jwtClaims(token).amr as Array<{ method: string }> | undefined;
  return (amr ?? []).map((a) => a.method);
}

function newPassword(): string {
  return `N-${randomBytes(15).toString("base64url")}`;
}

function syntheticAddress(label: string): string {
  return `auth-${label}-${Date.now()}-${randomBytes(3).toString("hex")}@example.com`;
}

interface MailpitSummary {
  ID: string;
  Subject: string;
}

async function mailFor(address: string): Promise<MailpitSummary[]> {
  const query = encodeURIComponent(`to:"${address}"`);
  const res = await fetch(`${MAILPIT}/api/v1/search?query=${query}`);
  if (!res.ok) throw new Error(`Mailpit search failed (HTTP ${res.status})`);
  const body = (await res.json()) as { messages?: MailpitSummary[] };
  return body.messages ?? [];
}

async function mailCount(address: string): Promise<number> {
  return (await mailFor(address)).length;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Waits until `address` has more than `previous` messages; returns the newest message's text. */
async function waitForNewMail(address: string, previous: number, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const messages = await mailFor(address);
    if (messages.length > previous) {
      const res = await fetch(`${MAILPIT}/api/v1/message/${messages[0].ID}`);
      const msg = (await res.json()) as { Subject: string; Text: string; HTML: string };
      return { count: messages.length, subject: msg.Subject, text: msg.Text ?? "", html: msg.HTML ?? "" };
    }
    await sleep(250);
  }
  throw new Error("No new email arrived in Mailpit in time");
}

function extractCode(text: string): string | null {
  return /\b(\d{8})\b/.exec(text)?.[1] ?? null;
}

/** Requests a reset for `email` and returns the emailed code (never printed). */
async function requestCode(email: string): Promise<string> {
  const before = await mailCount(email);
  const { client } = browserLikeClient();
  expect(await requestReset(client, { email })).toEqual({ ok: true });
  const mail = await waitForNewMail(email, before);
  const code = extractCode(mail.text);
  expect(code !== null).toBe(true);
  return code as string;
}

/** The reset server action's service, bound to `client`'s session (what `setNewPasswordAction` does per request). */
function viaAction(client: ReturnType<typeof browserLikeClient>["client"]) {
  return (input: { newPassword: string }) => setNewPassword(input, { db: client });
}

function otherCode(code: string): string {
  return String((Number(code) + 1) % 100_000_000).padStart(8, "0");
}

async function canSignIn(email: string, password: string) {
  const { client } = browserLikeClient();
  return signIn(client, { email, password });
}

// ---------------------------------------------------------------------------------------------------------------

describe("AUTH-04a password sign-in (local stack)", () => {
  let owner: SeededTenant;
  let doctor: SeededTenant;
  let receptionist: SeededTenant;

  beforeAll(async () => {
    owner = await seedTenantWithOwner(`Auth Clinic ${Date.now()}`);
    doctor = await addMemberToTenant(owner.tenantId, "doctor");
    receptionist = await addMemberToTenant(owner.tenantId, "receptionist");
  });

  it.each(["owner", "doctor", "receptionist"] as const)(
    "a seeded %s signs in by password and can read their membership through RLS",
    async (which) => {
      const user = { owner, doctor, receptionist }[which];
      const { client } = browserLikeClient();

      expect(await signIn(client, { email: user.userEmail, password: seededUserPassword() })).toEqual({ ok: true });

      const { data } = await client.auth.getSession();
      expect(data.session).not.toBeNull();
      expect(amrMethods(data.session!.access_token)).toEqual(["password"]);

      const { data: rows, error } = await client.from("memberships").select("tenant_id, role").eq("user_id", user.userId);
      expect(error).toBeNull();
      expect(rows).toEqual([{ tenant_id: owner.tenantId, role: which }]);
    },
  );

  it("normalises the email (case and whitespace) before signing in", async () => {
    const result = await canSignIn(`  ${doctor.userEmail.toUpperCase()} `, seededUserPassword());
    expect(result).toEqual({ ok: true });
  });

  it("a wrong password and an unknown email get the same fixed error", async () => {
    const wrong = await canSignIn(doctor.userEmail, "definitely-not-the-password");
    const unknown = await canSignIn(syntheticAddress("unknown"), "definitely-not-the-password");
    const expected = { ok: false, code: "invalid_credentials", message: AUTH_MESSAGES.invalid_credentials };
    expect(wrong).toEqual(expected);
    expect(unknown).toEqual(expected);
  });

  it("a normal login, and a failed one, send 0 emails (Mailpit)", async () => {
    const before = await mailCount(receptionist.userEmail);

    expect(await canSignIn(receptionist.userEmail, seededUserPassword())).toEqual({ ok: true });
    expect((await canSignIn(receptionist.userEmail, "wrong-password-123")).ok).toBe(false);

    await sleep(INGEST_WAIT_MS);
    expect(await mailCount(receptionist.userEmail)).toBe(before);
  });

  it("self-service signup is disabled: no user is created and no email is sent", async () => {
    const address = syntheticAddress("signup");
    const { client } = browserLikeClient();

    const { data, error } = await client.auth.signUp({ email: address, password: newPassword() });

    expect(error?.code).toBe("signup_disabled");
    expect(data.user).toBeNull();
    const { data: users } = await getAdminClient().auth.admin.listUsers({ perPage: 1000 });
    expect(users.users.some((u) => u.email === address)).toBe(false);
    await sleep(INGEST_WAIT_MS);
    expect(await mailCount(address)).toBe(0);
  });
});

describe("AUTH-04a forgot password with a recovery code (PKCE client, local stack + Mailpit)", () => {
  let owner: SeededTenant;

  beforeAll(async () => {
    owner = await seedTenantWithOwner(`Reset Clinic ${Date.now()}`);
  });

  it("sends exactly one code-only email for an existing account and none for an unknown one", async () => {
    const user = await addMemberToTenant(owner.tenantId, "nurse");
    const before = await mailCount(user.userEmail);
    const { client, store } = browserLikeClient();

    expect(await requestReset(client, { email: user.userEmail })).toEqual({ ok: true });
    // The PKCE flow stored a code verifier, as the browser client does.
    expect([...store.keys()].some((k) => k.endsWith("-code-verifier"))).toBe(true);

    const mail = await waitForNewMail(user.userEmail, before);
    expect(mail.count).toBe(before + 1);
    expect(mail.subject).toBe("Your ClinicOS password reset code");
    expect(extractCode(mail.text) !== null).toBe(true);
    expect(/https?:\/\//.test(mail.text) || /href=/i.test(mail.html)).toBe(false);

    await sleep(INGEST_WAIT_MS);
    expect(await mailCount(user.userEmail)).toBe(before + 1);

    const unknown = syntheticAddress("nobody");
    const { client: other } = browserLikeClient();
    expect(await requestReset(other, { email: unknown })).toEqual({ ok: true });
    await sleep(INGEST_WAIT_MS);
    expect(await mailCount(unknown)).toBe(0);
  });

  it("a recovery code sets a new password, is single-use, and signs out other sessions", async () => {
    const user = await addMemberToTenant(owner.tenantId, "doctor");
    const oldPassword = seededUserPassword();
    const fresh = newPassword();

    // Another device signed in before the reset.
    const { client: otherDevice } = browserLikeClient();
    expect(await signIn(otherDevice, { email: user.userEmail, password: oldPassword })).toEqual({ ok: true });

    const code = await requestCode(user.userEmail);
    const { client } = browserLikeClient();
    const result = await completeReset(client, { email: user.userEmail, code, newPassword: fresh }, viaAction(client));
    expect(result).toEqual({ ok: true, otherSessionsSignedOut: true });

    // This device holds the recovery session.
    const { data } = await client.auth.getSession();
    expect(data.session).not.toBeNull();
    expect(amrMethods(data.session!.access_token)).toContain("otp");

    // Old password no longer works; the new one does.
    expect(await canSignIn(user.userEmail, oldPassword)).toMatchObject({ ok: false, code: "invalid_credentials" });
    expect(await canSignIn(user.userEmail, fresh)).toEqual({ ok: true });

    // The code is single-use.
    const { client: replay } = browserLikeClient();
    expect(await completeReset(replay, { email: user.userEmail, code, newPassword: newPassword() }, viaAction(replay))).toEqual({
      ok: false,
      code: "code_invalid",
      message: AUTH_MESSAGES.code_invalid,
      stage: "verify",
    });

    // The other device's refresh token was revoked.
    const { error: refreshError } = await otherDevice.auth.refreshSession();
    expect(refreshError?.code).toBe("refresh_token_not_found");
  });

  it("a wrong code is rejected and the password stays unchanged", async () => {
    const user = await addMemberToTenant(owner.tenantId, "receptionist");
    const code = await requestCode(user.userEmail);

    const { client } = browserLikeClient();
    const result = await completeReset(
      client,
      { email: user.userEmail, code: otherCode(code), newPassword: newPassword() },
      viaAction(client),
    );

    expect(result).toEqual({ ok: false, code: "code_invalid", message: AUTH_MESSAGES.code_invalid, stage: "verify" });
    expect((await client.auth.getSession()).data.session).toBeNull();
    expect(await canSignIn(user.userEmail, seededUserPassword())).toEqual({ ok: true });
  });

  it("a password the policy rejects does not use up the code", async () => {
    const user = await addMemberToTenant(owner.tenantId, "nurse");
    const code = await requestCode(user.userEmail);
    const { client } = browserLikeClient();

    for (const rejected of ["short-pw", "a".repeat(73)]) {
      const result = await completeReset(client, { email: user.userEmail, code, newPassword: rejected }, viaAction(client));
      expect(result).toMatchObject({ ok: false, code: "invalid_input", stage: "verify" });
    }
    expect((await client.auth.getSession()).data.session).toBeNull();

    const fresh = newPassword();
    expect(await completeReset(client, { email: user.userEmail, code, newPassword: fresh }, viaAction(client))).toEqual({
      ok: true,
      otherSessionsSignedOut: true,
    });
    expect(await canSignIn(user.userEmail, fresh)).toEqual({ ok: true });
  });

  it("reusing the current password is mapped, and the update can be retried on the recovery session", async () => {
    const user = await addMemberToTenant(owner.tenantId, "admin");
    const code = await requestCode(user.userEmail);
    const { client } = browserLikeClient();

    const same = await completeReset(client, { email: user.userEmail, code, newPassword: seededUserPassword() }, viaAction(client));
    expect(same).toEqual({ ok: false, code: "same_password", message: AUTH_MESSAGES.same_password, stage: "update" });

    const fresh = newPassword();
    expect(await setNewPassword({ newPassword: fresh }, { db: client })).toEqual({ ok: true, otherSessionsSignedOut: true });
    expect(await canSignIn(user.userEmail, fresh)).toEqual({ ok: true });
  });
});
