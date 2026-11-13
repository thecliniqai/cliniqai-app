/**
 * V2-03 03-12a change password (AUTH-04b, FT-05, A00-5) against the local stack: the real `changePasswordAction`
 * (`"use server"` module), real local GoTrue, and the loopback fake range API (PWNED_CHECK=on for this file only, via
 * `vi.stubEnv`; no public network). `createClient()` from `@/lib/supabase/server` returns the spec's signed-in client,
 * as the request's cookie client would.
 *
 * Not provable on the CLI stack (R-34): "require current password" has no config key, so local GoTrue ignores a wrong
 * `current_password`. Here the action is shown to send it; the refusal mapping is a unit (tests/auth/password-service
 * .spec.ts) and the hosted behaviour is AUTH-00 re-check item 3 (PO E3).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { en } from "@/messages/en";
import { addMemberToTenant, seedTenantWithOwner, seededUserPassword, type SeededTenant } from "../../helpers/tenants";
import {
  browserLikeClient,
  canSignIn,
  recoverySession,
  refreshRevoked,
  signedInClient,
  syntheticPassword,
} from "../../helpers/auth-flows";
import { BREACHED_FIXTURE_PASSWORDS, startPwnedRangeServer, type PwnedRangeServer } from "../../e2e/support/pwned-range-server";

const slot = vi.hoisted((): { client: unknown } => ({ client: null }));
vi.mock("@/lib/supabase/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/server")>();
  return { ...actual, createClient: async () => slot.client };
});

const { changePasswordAction } = await import("@/features/auth/actions");

const BREACHED = BREACHED_FIXTURE_PASSWORDS[0];
let range: PwnedRangeServer;
let owner: SeededTenant;

beforeAll(async () => {
  range = await startPwnedRangeServer();
  owner = await seedTenantWithOwner(`Change Password Clinic ${Date.now()}`);
});
afterAll(async () => {
  await range.close();
});

function checkOn() {
  vi.stubEnv("PWNED_CHECK", "on");
  vi.stubEnv("PWNED_API_BASE_URL", range.url);
}

afterEach(() => {
  slot.client = null;
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function freshUser(role: "doctor" | "nurse" | "receptionist" | "admin" = "doctor") {
  return addMemberToTenant(owner.tenantId, role);
}

describe("changePasswordAction (local stack, FT-05 on against the loopback fake range API)", () => {
  it("a breached new password is refused with the catalogue copy and the password is unchanged", async () => {
    checkOn();
    const user = await freshUser();
    const { client, result } = await signedInClient(user.userEmail, seededUserPassword());
    expect(result.ok).toBe(true);
    slot.client = client;
    const before = range.requests.length;

    const outcome = await changePasswordAction({ currentPassword: seededUserPassword(), newPassword: BREACHED });

    expect(outcome).toEqual({ ok: false, code: "pwned_password", message: en.auth.errors.pwned_password });
    // k-anonymity: one lookup, 5-character prefix only, padding requested.
    const sent = range.requests.slice(before);
    expect(sent).toHaveLength(1);
    expect(sent[0].prefix).toMatch(/^[0-9A-F]{5}$/);
    expect(sent[0].padding).toBe(true);
    expect(await canSignIn(user.userEmail, seededUserPassword())).toBe(true);
    expect(await canSignIn(user.userEmail, BREACHED)).toBe(false);
  });

  it("a valid change: the new password signs in, the old one fails, another session's refresh fails, this one stays", async () => {
    checkOn();
    const user = await freshUser("nurse");
    const other = await signedInClient(user.userEmail, seededUserPassword());
    const acting = await signedInClient(user.userEmail, seededUserPassword());
    expect(other.result.ok && acting.result.ok).toBe(true);
    slot.client = acting.client;
    const updateUser = vi.spyOn(acting.client.auth, "updateUser");
    const fresh = syntheticPassword();

    expect(await changePasswordAction({ currentPassword: seededUserPassword(), newPassword: fresh })).toEqual({
      ok: true,
      otherSessionsSignedOut: true,
    });

    // A00-5 / R-34: the current password is always sent (hosted Auth checks it on password sessions).
    expect(updateUser).toHaveBeenCalledWith({ password: fresh, current_password: seededUserPassword() });
    expect(await canSignIn(user.userEmail, fresh)).toBe(true);
    expect(await canSignIn(user.userEmail, seededUserPassword())).toBe(false);
    // The other device is signed out: its access token no longer resolves a user and its refresh token is gone. (Local
    // GoTrue also ends other sessions on a password change by itself, so the action's explicit
    // `signOut({ scope: "others" })` is pinned by tests/auth/password-service.spec.ts, not by this leg.)
    // (Refresh first: a failed getUser() clears the client's stored session.)
    expect(await refreshRevoked(other.client)).toBe(true);
    expect((await other.client.auth.getUser()).data.user).toBeNull();
    const { data, error } = await acting.client.auth.getUser();
    expect(error).toBeNull();
    expect(data.user?.id).toBe(user.userId);
  });

  it("A00-5: a recovery session older than 10 minutes must sign in again; the password is unchanged", async () => {
    checkOn();
    const user = await freshUser("receptionist");
    const client = await recoverySession(user.userEmail);
    slot.client = client;
    // Only Date moves: the session's amr timestamp is now 11 minutes old (its access token, 15 min, is still valid).
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 11 * 60_000 });
    const before = range.requests.length;

    expect(await changePasswordAction({ currentPassword: "anything-at-all", newPassword: syntheticPassword() })).toEqual({
      ok: false,
      code: "reauth_required",
      message: en.auth.errors.reauth_required,
    });

    expect(range.requests.length).toBe(before);
    vi.useRealTimers();
    expect(await canSignIn(user.userEmail, seededUserPassword())).toBe(true);
  });

  it("a fresh recovery session (within 10 minutes) may change the password", async () => {
    checkOn();
    const user = await freshUser("admin");
    slot.client = await recoverySession(user.userEmail);
    const fresh = syntheticPassword();
    expect(await changePasswordAction({ currentPassword: "not-checked-for-otp-sessions", newPassword: fresh })).toMatchObject({ ok: true });
    expect(await canSignIn(user.userEmail, fresh)).toBe(true);
  });

  it("unauthenticated: refused with the sign-in-again copy, no range lookup", async () => {
    checkOn();
    slot.client = browserLikeClient().client;
    const before = range.requests.length;
    expect(await changePasswordAction({ currentPassword: "x", newPassword: syntheticPassword() })).toEqual({
      ok: false,
      code: "session_not_found",
      message: en.auth.errors.session_not_found,
    });
    expect(range.requests.length).toBe(before);
  });

  it("with the check off (the lane default) a fixture password is not looked up", async () => {
    const user = await freshUser();
    const { client } = await signedInClient(user.userEmail, seededUserPassword());
    slot.client = client;
    const before = range.requests.length;
    expect(await changePasswordAction({ currentPassword: seededUserPassword(), newPassword: BREACHED })).toMatchObject({ ok: true });
    expect(range.requests.length).toBe(before);
  });
});
