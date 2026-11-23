/**
 * V2-09d 09D-01a: the session read from the verified JWT claims (`getSessionClaims`, `lib/auth/tenant.ts`) and the dashboard
 * layout's answer when it fails.
 *
 * - S-6: auth-js verifies the token's signature and expiry; a session token must also carry `iss` = this project's Auth URL
 *   (`<NEXT_PUBLIC_SUPABASE_URL>/auth/v1`), `aud` `authenticated` (string or array) and `role` `authenticated`. Anything
 *   else is not a session (UnauthenticatedError), and the refusal is logged by the claim's name only, never its value.
 * - A-7: the layout sends only a missing or unverifiable session to /login; an Auth outage and any unexpected failure reach
 *   the error boundary (thrown), never a silent redirect.
 * The Supabase client is a fake: these pin the claim rules and the layout's mapping. A real local session passing them is
 * every DB spec's precondition (tests/auth/session-context-db.spec.ts and the rest of the suite).
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

const slot = vi.hoisted(() => ({ getClaims: null as null | (() => Promise<unknown>) }));

vi.mock("@/lib/supabase/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/server")>();
  return { ...actual, createClient: async () => ({ auth: { getClaims: () => slot.getClaims!() } }) };
});

import { AuthUnavailableError, getSessionClaims, UnauthenticatedError } from "@/lib/auth/tenant";
import { publicEnv } from "@/lib/env";
import DashboardLayout from "@/app/(dashboard)/layout";

const USER = "00000000-0000-4000-8000-0000000000d1";
const SESSION = "00000000-0000-4000-8000-0000000000d2";
const ISS = `${publicEnv.NEXT_PUBLIC_SUPABASE_URL.replace(/\/+$/, "")}/auth/v1`;
const GOOD = { sub: USER, session_id: SESSION, iss: ISS, aud: "authenticated", role: "authenticated", email: "synthetic@example.com" };

const claims = (over: Record<string, unknown>) => () => Promise.resolve({ data: { claims: { ...GOOD, ...over } }, error: null });

let stdout: MockInstance;
let stderr: MockInstance;
const logs = () => [...stdout.mock.calls, ...stderr.mock.calls].map((c) => String(c[0])).join("");

beforeEach(() => {
  stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("S-6: the claims a session token must carry", () => {
  it("control: this project's issuer, aud authenticated (string or array), role authenticated → the session", async () => {
    slot.getClaims = claims({});
    await expect(getSessionClaims()).resolves.toMatchObject({ userId: USER, sessionId: SESSION });
    slot.getClaims = claims({ aud: ["authenticated", "other"], iss: `${ISS}/` });
    await expect(getSessionClaims()).resolves.toMatchObject({ userId: USER });
  });

  it.each([
    ["another project's issuer", { iss: "https://otherproject.supabase.co/auth/v1" }, "claim_iss"],
    ["no issuer", { iss: undefined }, "claim_iss"],
    ["the bare project URL as issuer", { iss: publicEnv.NEXT_PUBLIC_SUPABASE_URL }, "claim_iss"],
    ["another audience", { aud: "service" }, "claim_aud"],
    ["an audience list without authenticated", { aud: ["anon"] }, "claim_aud"],
    ["no audience", { aud: undefined }, "claim_aud"],
    ["the anon role", { role: "anon" }, "claim_role"],
    ["the service role", { role: "service_role" }, "claim_role"],
  ])("%s → UnauthenticatedError, logged by the claim's name only", async (_case, over, reason) => {
    slot.getClaims = claims(over);
    await expect(getSessionClaims()).rejects.toBeInstanceOf(UnauthenticatedError);
    expect(logs()).toContain('"event":"auth.claims.refused"');
    expect(logs()).toContain(`"reason":"${reason}"`);
    expect(logs()).not.toContain("otherproject");
    expect(logs()).not.toContain(USER);
  });
});

/** Next's redirect is a thrown control-flow error whose digest names the target. */
function redirectTarget(err: unknown): string | null {
  const digest = (err as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT;") ? (digest.split(";")[2] ?? null) : null;
}

describe("A-7: the dashboard layout redirects to /login only when the session is missing or does not verify", () => {
  const layout = () => DashboardLayout({ children: null }).then(() => null, (err: unknown) => err);

  it("no session (a definitive answer) → redirect('/login')", async () => {
    slot.getClaims = () => Promise.resolve({ data: null, error: null });
    expect(redirectTarget(await layout())).toBe("/login");
    slot.getClaims = claims({ role: "anon" });
    expect(redirectTarget(await layout())).toBe("/login");
  });

  it("an Auth outage → AuthUnavailableError (the error boundary's Retry), not /login", async () => {
    slot.getClaims = () => Promise.resolve({ data: null, error: Object.assign(new Error("fetch failed"), { name: "AuthRetryableFetchError", status: 0 }) });
    const err = await layout();
    expect(err).toBeInstanceOf(AuthUnavailableError);
    expect(redirectTarget(err)).toBeNull();
  });

  it("an unexpected failure (a bug, a broken client) is rethrown, never a silent trip to /login", async () => {
    const bug = new TypeError("synthetic claims parsing bug");
    slot.getClaims = () => Promise.reject(bug);
    const err = await layout();
    expect(err).toBe(bug);
    expect(redirectTarget(err)).toBeNull();
  });
});
