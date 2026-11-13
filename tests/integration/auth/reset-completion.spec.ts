/**
 * V2-03 03-12a forgot-password completion (AUTH-04b, FT-05, A00-5, R-5) against the local stack and Mailpit: the
 * browser verifies the recovery code (`completeReset`, PKCE client), then the real `setNewPasswordAction` sets the
 * password on that session. FT-05 runs against the loopback fake range API (PWNED_CHECK=on for this file only).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { en } from "@/messages/en";
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
    expect(await setNewPasswordAction({ newPassword: fresh })).toEqual({ ok: true, otherSessionsSignedOut: true });
    expect(await canSignIn(user.userEmail, fresh)).toBe(true);
    expect(await canSignIn(user.userEmail, seededUserPassword())).toBe(false);
    expect(await refreshRevoked(otherDevice.client)).toBe(true);
    expect((await otherDevice.client.auth.getUser()).data.user).toBeNull();
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
