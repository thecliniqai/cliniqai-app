/**
 * AUTH-02 auth config applied (V2-03 03-11a): proves the real local GoTrue runs the settings that
 * supabase/auth-policy.json requires and supabase/config.toml encodes (checked statically by
 * scripts/ci/check-auth-config.mjs), so the policy is not just a file that matches another file.
 *
 * DB lane: local stack + Mailpit. Synthetic users only; codes and passwords are never printed.
 */
import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import { Database } from "@/lib/db/types";
import { addMemberToTenant, seedTenantWithOwner, seededUserPassword, type SeededTenant } from "../../helpers/tenants";

const MAILPIT = "http://127.0.0.1:54324";
const SUPABASE_URL = publicEnv.NEXT_PUBLIC_SUPABASE_URL;
const PUBLISHABLE_KEY = publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

function client() {
  return createClient<Database>(SUPABASE_URL, PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function syntheticAddress(label: string): string {
  return `authcfg-${label}-${Date.now()}-${randomBytes(3).toString("hex")}@example.com`;
}

interface MailpitSummary {
  ID: string;
  Subject: string;
}

async function mailFor(address: string): Promise<MailpitSummary[]> {
  const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`);
  if (!res.ok) throw new Error(`Mailpit search failed (HTTP ${res.status})`);
  return ((await res.json()) as { messages?: MailpitSummary[] }).messages ?? [];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForMail(address: string, subject: string, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hit = (await mailFor(address)).find((m) => m.Subject === subject);
    if (hit) {
      const res = await fetch(`${MAILPIT}/api/v1/message/${hit.ID}`);
      return (await res.json()) as { Subject: string; Text: string; HTML: string };
    }
    await sleep(250);
  }
  throw new Error(`No "${subject}" email arrived in Mailpit in time`);
}

describe("AUTH-02: the local GoTrue runs the auth policy (local column)", () => {
  let owner: SeededTenant;

  beforeAll(async () => {
    owner = await seedTenantWithOwner(`Auth Config Clinic ${Date.now()}`);
  });

  it("public settings: signups disabled, email confirmations on (no autoconfirm), email provider on, phone off", async () => {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: PUBLISHABLE_KEY } });
    expect(res.status).toBe(200);
    const settings = (await res.json()) as {
      disable_signup: boolean;
      mailer_autoconfirm: boolean;
      external: Record<string, boolean>;
    };
    expect(settings.disable_signup).toBe(true);
    expect(settings.mailer_autoconfirm).toBe(false);
    expect(settings.external.email).toBe(true);
    expect(settings.external.phone).toBe(false);
    expect(settings.external.anonymous_users).toBe(false);
  });

  it("a password sign-in issues a 15-minute access token (jwt_expiry 900)", async () => {
    const c = client();
    const { data, error } = await c.auth.signInWithPassword({ email: owner.userEmail, password: seededUserPassword() });
    expect(error).toBeNull();
    expect(data.session?.expires_in).toBe(900);
    const claims = JSON.parse(Buffer.from(data.session!.access_token.split(".")[1], "base64url").toString("utf8"));
    expect(claims.exp - claims.iat).toBe(900);
  });

  it("signUp is refused with signup_disabled (A00-1)", async () => {
    const { data, error } = await client().auth.signUp({ email: syntheticAddress("signup"), password: `S-${randomBytes(12).toString("base64url")}` });
    expect(error?.code).toBe("signup_disabled");
    expect(data.user).toBeNull();
  });

  it("a second recovery request for the same address within 60 s is refused with over_email_send_rate_limit", async () => {
    const user = await addMemberToTenant(owner.tenantId, "nurse");
    const first = await client().auth.resetPasswordForEmail(user.userEmail);
    expect(first.error).toBeNull();
    await waitForMail(user.userEmail, "Your ClinicOS password reset code");

    const second = await client().auth.resetPasswordForEmail(user.userEmail);
    expect(second.error?.code).toBe("over_email_send_rate_limit");
    expect(second.error?.status).toBe(429);
    await sleep(1_500);
    expect((await mailFor(user.userEmail)).length).toBe(1);
  });

  it("a password change sends the code-free 'password changed' security notification", async () => {
    const user = await addMemberToTenant(owner.tenantId, "receptionist");
    const c = client();
    const { error: signInError } = await c.auth.signInWithPassword({ email: user.userEmail, password: seededUserPassword() });
    expect(signInError).toBeNull();
    const { error } = await c.auth.updateUser({ password: `P-${randomBytes(15).toString("base64url")}` });
    expect(error).toBeNull();

    const mail = await waitForMail(user.userEmail, "Your ClinicOS password was changed");
    expect(/\b\d{6}\b/.test(mail.Text)).toBe(false);
    expect(/https?:\/\//.test(mail.Text) || /href=/i.test(mail.HTML)).toBe(false);
  });

  it("TOTP MFA enrolment is enabled", async () => {
    const user = await addMemberToTenant(owner.tenantId, "doctor");
    const c = client();
    const { error: signInError } = await c.auth.signInWithPassword({ email: user.userEmail, password: seededUserPassword() });
    expect(signInError).toBeNull();
    const { data, error } = await c.auth.mfa.enroll({ factorType: "totp", friendlyName: "authcfg" });
    expect(error).toBeNull();
    expect(data?.type).toBe("totp");
    const { error: unenrollError } = await c.auth.mfa.unenroll({ factorId: data!.id });
    expect(unenrollError).toBeNull();
  });
});
