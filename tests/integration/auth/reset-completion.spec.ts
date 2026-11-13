/**
 * V2-03 03-12a forgot-password completion (AUTH-04b, FT-05, A00-5, R-5) against the local stack and Mailpit: the
 * browser verifies the recovery code (`completeReset`, PKCE client), then the real `setNewPasswordAction` sets the
 * password on that session. FT-05 runs against the loopback fake range API (PWNED_CHECK=on for this file only).
 * 03-13a (ruling R-35, H-AUTH): a completed reset ends every session of the user, the recovery session included, so
 * its tokens cannot be kept and used straight against GoTrue afterwards.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { en } from "@/messages/en";
import { publicEnv } from "@/lib/env";
import { completeReset } from "@/features/auth/password-flows";
import { addMemberToTenant, seedTenantWithOwner, seededUserPassword, type SeededTenant } from "../../helpers/tenants";
import {
  browserLikeClient,
  canSignIn,
  recoverySession,
  refreshRevoked,
  requestRecoveryCode,
  signedInClient,
  syntheticPassword,
} from "../../helpers/auth-flows";
import { BREACHED_FIXTURE_PASSWORDS, startPwnedRangeServer, type PwnedRangeServer } from "../../e2e/support/pwned-range-server";

const slot = vi.hoisted((): { client: unknown } => ({ client: null }));
vi.mock("@/lib/supabase/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/server")>();
  return { ...actual, createClient: async () => slot.client };
});

const { setNewPasswordAction } = await import("@/features/auth/actions");

const held = { access: "", refresh: "" };

/** `PUT /auth/v1/user {password}` straight at GoTrue with `accessToken` (the H-AUTH bypass of the app's checks). */
async function directPasswordChange(accessToken: string): Promise<{ status: number }> {
  const res = await fetch(`${publicEnv.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/user`, {
    method: "PUT",
    headers: {
      apikey: publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ password: syntheticPassword() }),
  });
  await res.body?.cancel();
  return { status: res.status };
}

let range: PwnedRangeServer;
let owner: SeededTenant;

beforeAll(async () => {
  range = await startPwnedRangeServer();
  owner = await seedTenantWithOwner(`Reset Completion Clinic ${Date.now()}`);
});
afterAll(async () => {
  await range.close();
});
afterEach(() => {
  slot.client = null;
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

function checkOn() {
  vi.stubEnv("PWNED_CHECK", "on");
  vi.stubEnv("PWNED_API_BASE_URL", range.url);
}

describe("setNewPasswordAction after a recovery code (local stack + Mailpit)", () => {
  it("a breached password is refused (code already used, retry on the same session); a clear one signs out other sessions", async () => {
    checkOn();
    const user = await addMemberToTenant(owner.tenantId, "doctor");
    const otherDevice = await signedInClient(user.userEmail, seededUserPassword());
    expect(otherDevice.result.ok).toBe(true);

    const code = await requestRecoveryCode(user.userEmail);
    const { client } = browserLikeClient();
    slot.client = client;

    const refused = await completeReset(
      client,
      { email: user.userEmail, code, newPassword: BREACHED_FIXTURE_PASSWORDS[1] },
      setNewPasswordAction,
    );
    expect(refused).toEqual({ ok: false, code: "pwned_password", message: en.auth.errors.pwned_password, stage: "update" });
    expect(await canSignIn(user.userEmail, seededUserPassword())).toBe(true);
    expect(await canSignIn(user.userEmail, BREACHED_FIXTURE_PASSWORDS[1])).toBe(false);

    // The forgot-password page retries the server action alone on the recovery session.
    const fresh = syntheticPassword();
    expect(await setNewPasswordAction({ newPassword: fresh })).toEqual({ ok: true, otherSessionsSignedOut: true, signedOut: true });
    expect(await canSignIn(user.userEmail, fresh)).toBe(true);
    expect(await canSignIn(user.userEmail, seededUserPassword())).toBe(false);
    expect(await refreshRevoked(otherDevice.client)).toBe(true);
    expect((await otherDevice.client.auth.getUser()).data.user).toBeNull();
  });

  it("R-35 / H-AUTH: reset completion revokes the recovery session; its tokens then fail on a direct GoTrue PUT /auth/v1/user", async () => {
    checkOn();
    const user = await addMemberToTenant(owner.tenantId, "doctor");
    const code = await requestRecoveryCode(user.userEmail);
    const { client } = browserLikeClient();
    slot.client = client;

    const fresh = syntheticPassword();
    const done = await completeReset(client, { email: user.userEmail, code, newPassword: fresh }, async (input) => {
      // The recovery session's tokens as the browser holds them right before the server action runs.
      const { data } = await client.auth.getSession();
      held.access = data.session?.access_token ?? "";
      held.refresh = data.session?.refresh_token ?? "";
      return setNewPasswordAction(input);
    });
    expect(done.ok).toBe(true);
    expect(held.access).not.toBe("");

    // The direct call an attacker holding the recovery tokens would make, skipping the app: refused.
    const direct = await directPasswordChange(held.access);
    expect(direct.status, "GoTrue refuses the recovery session's access token after the reset").not.toBe(200);
    expect([401, 403]).toContain(direct.status);
    const { data: refreshed, error } = await browserLikeClient().client.auth.refreshSession({ refresh_token: held.refresh });
    expect(refreshed.session).toBeNull();
    expect(error?.code).toBe("refresh_token_not_found");
    // The client that ran the reset holds no session any more (signed out, R-35).
    expect((await client.auth.getSession()).data.session).toBeNull();
    // The user signs in with the new password.
    expect(await canSignIn(user.userEmail, fresh)).toBe(true);
    expect(done).toEqual({ ok: true, otherSessionsSignedOut: true, signedOut: true });
  });

  it("called from a plain password session it is refused and the password is unchanged", async () => {
    checkOn();
    const user = await addMemberToTenant(owner.tenantId, "nurse");
    const { client, result } = await signedInClient(user.userEmail, seededUserPassword());
    expect(result.ok).toBe(true);
    slot.client = client;

    expect(await setNewPasswordAction({ newPassword: syntheticPassword() })).toEqual({
      ok: false,
      code: "reauth_required",
      message: en.auth.flows.reset_session_stale,
    });
    expect(await canSignIn(user.userEmail, seededUserPassword())).toBe(true);
  });

  it("A00-5: a recovery session older than 10 minutes is refused", async () => {
    checkOn();
    const user = await addMemberToTenant(owner.tenantId, "receptionist");
    slot.client = await recoverySession(user.userEmail);
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 11 * 60_000 });

    expect(await setNewPasswordAction({ newPassword: syntheticPassword() })).toMatchObject({ ok: false, code: "reauth_required" });
    vi.useRealTimers();
    expect(await canSignIn(user.userEmail, seededUserPassword())).toBe(true);
  });

  it("unauthenticated is refused", async () => {
    slot.client = browserLikeClient().client;
    expect(await setNewPasswordAction({ newPassword: syntheticPassword() })).toMatchObject({ ok: false, code: "session_not_found" });
  });
});
