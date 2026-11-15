/**
 * V2-05 05-07b (R-46; AUTH_REDESIGN §3.2 "verify Turnstile server-side"): `verifyTurnstile` against the loopback fake
 * siteverify (tests/e2e/support/turnstile-verify-server.ts). No test reaches Cloudflare.
 *
 * Fail closed in every case but a verified token for this site: an unset secret refuses (never skips), a missing
 * token, a rejected token, a hostname mismatch, a 500, an unreachable server and a timeout (the fake answers after the
 * 3 s bound) all refuse. The secret and the widget token never appear in a log line or in the result. Secrets are built
 * at run time (gitleaks rule).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { TURNSTILE_ACTIONS, verifyTurnstile } from "@/lib/auth/turnstile";
import { acceptInviteWithPassword } from "@/features/auth/invite-flows";
import { en } from "@/messages/en";
import { startTurnstileVerifyServer, type TurnstileVerifyServer } from "../e2e/support/turnstile-verify-server";
import { TURNSTILE_PASS_SECRET_KEY } from "../setup/test-env";

/** A real-shaped (non-test) secret: the hostname check applies to it. */
const REAL_SHAPED_SECRET = ["0x", "4AAA", "SyntheticSecretForTests", "0000"].join("");
const HOST = "app.synthetic-clinic.example.org";
const TOKEN = ["XXXX", "DUMMY", "TOKEN", "pass", "0123456789"].join(".");

// The invite-flow leg (05-12) runs the real check against the fake with a real-shaped secret; the env schema allows
// only Cloudflare's test secrets in the test tier (and those skip the hostname/action checks), so while `inject` is
// set the flow's call gets the fake's URL, secret and hostname merged under its own options (which it records).
const tsState = vi.hoisted(() => ({ inject: null as null | Record<string, unknown>, seen: [] as unknown[] }));
vi.mock("@/lib/auth/turnstile", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/turnstile")>();
  return {
    ...actual,
    verifyTurnstile: (token: string | null | undefined, options: Parameters<typeof actual.verifyTurnstile>[1] = {}) => {
      if (!tsState.inject) return actual.verifyTurnstile(token, options);
      tsState.seen.push(options);
      return actual.verifyTurnstile(token, { ...tsState.inject, ...options });
    },
  };
});

let server: TurnstileVerifyServer;
let out: MockInstance;
let err: MockInstance;
const written = () => [...out.mock.calls, ...err.mock.calls].map((c) => String(c[0])).join("");

beforeAll(async () => {
  server = await startTurnstileVerifyServer({ hostname: HOST, slowMs: 4500 });
});
afterAll(async () => {
  await server.close();
});
beforeEach(() => {
  out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});
afterEach(() => {
  tsState.inject = null;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function verify(token: string, secret: string | undefined = REAL_SHAPED_SECRET, extra: { timeoutMs?: number } = {}) {
  return verifyTurnstile(token, { secret, verifyUrl: server.url, expectedHostname: HOST, ...extra });
}

function expectNothingSecretLogged(token: string, secret: string) {
  const text = written();
  expect(text).not.toContain(token);
  expect(text).not.toContain(secret);
}

describe("verifyTurnstile (fake siteverify)", () => {
  it("a token Cloudflare accepts for this site passes; the secret and the token are posted, never logged", async () => {
    const before = server.requests.length;
    expect(await verify(TOKEN)).toEqual({ ok: true });
    expect(server.requests.slice(before)).toEqual([{ hadSecret: true, hadToken: true, tokenLength: TOKEN.length }]);
    expectNothingSecretLogged(TOKEN, REAL_SHAPED_SECRET);
  });

  it("a rejected token fails closed (reason rejected; Cloudflare's error code only in the log)", async () => {
    const token = `fail.${TOKEN}`;
    expect(await verify(token)).toEqual({ ok: false, reason: "rejected" });
    const line = JSON.parse(written().trim().split("\n").pop() ?? "{}") as Record<string, unknown>;
    expect(line).toMatchObject({ event: "auth.turnstile.failed", reason: "rejected", code: "invalid-input-response" });
    expectNothingSecretLogged(token, REAL_SHAPED_SECRET);
  });

  it("a token solved on another site fails closed (hostname mismatch)", async () => {
    const token = `wronghost.${TOKEN}`;
    expect(await verify(token)).toEqual({ ok: false, reason: "hostname_mismatch" });
    expectNothingSecretLogged(token, REAL_SHAPED_SECRET);
  });

  // V2-05 05-12 (IND I-6): the widget's declared action is part of the check when the flow names one.
  it("a token from another form's widget fails closed (action mismatch); the expected action passes", async () => {
    const token = `wrongaction.${TOKEN}`;
    const opts = { secret: REAL_SHAPED_SECRET, verifyUrl: server.url, expectedHostname: HOST, expectedAction: TURNSTILE_ACTIONS.inviteAccept };
    expect(await verifyTurnstile(token, opts)).toEqual({ ok: false, reason: "action_mismatch" });
    expect(await verifyTurnstile(TOKEN, opts)).toEqual({ ok: true });
    expectNothingSecretLogged(token, REAL_SHAPED_SECRET);
  });

  it("invite acceptance names its action: a token from another widget is refused before any account change", async () => {
    tsState.inject = { secret: REAL_SHAPED_SECRET, verifyUrl: server.url, expectedHostname: HOST };
    tsState.seen = [];
    const checkPwned = vi.fn(async () => "clear" as const);
    const redeem = vi.fn(async () => ({ ok: true as const, tenantId: "unused", created: true }));
    const input = { token: "a".repeat(64), password: ["Synthetic", "Passphrase", "For", "Tests", "0512"].join("-") };
    expect(await acceptInviteWithPassword({ ...input, turnstileToken: `wrongaction.${TOKEN}` }, { checkPwned, redeem })).toEqual({
      ok: false,
      message: en.auth.captcha.failed,
    });
    expect(checkPwned).not.toHaveBeenCalled();
    expect(redeem).not.toHaveBeenCalled();
    // Control: the same flow with the invite widget's token reaches the password and redemption steps.
    expect(await acceptInviteWithPassword({ ...input, turnstileToken: TOKEN }, { checkPwned, redeem })).toEqual({ ok: true });
    expect(redeem).toHaveBeenCalledTimes(1);
    expect(tsState.seen).toEqual([{ expectedAction: "invite-accept" }, { expectedAction: "invite-accept" }]);
    tsState.inject = null;
  });

  it("a timeout fails closed: the fake answers after the bound, the check does not wait for it", async () => {
    const token = `slow.${TOKEN}`;
    const started = Date.now();
    expect(await verify(token, REAL_SHAPED_SECRET, { timeoutMs: 300 })).toEqual({ ok: false, reason: "timeout" });
    expect(Date.now() - started).toBeLessThan(2000);
    expectNothingSecretLogged(token, REAL_SHAPED_SECRET);
  });

  it("the default bound is 3 s: an answer after 4.5 s is a timeout", async () => {
    const token = `slow.${TOKEN}`;
    const started = Date.now();
    expect(await verify(token)).toEqual({ ok: false, reason: "timeout" });
    const took = Date.now() - started;
    expect(took).toBeGreaterThanOrEqual(2900);
    expect(took).toBeLessThan(4400);
  }, 10_000);

  it("an HTTP 500 and an unreachable server fail closed (unavailable)", async () => {
    expect(await verify(`http500.${TOKEN}`)).toEqual({ ok: false, reason: "unavailable" });
    const unreachable = await verifyTurnstile(TOKEN, {
      secret: REAL_SHAPED_SECRET,
      verifyUrl: "http://127.0.0.1:9/turnstile/v0/siteverify",
      expectedHostname: HOST,
    });
    expect(unreachable).toEqual({ ok: false, reason: "unavailable" });
    expectNothingSecretLogged(TOKEN, REAL_SHAPED_SECRET);
  });

  it("no widget token fails closed before any request", async () => {
    const before = server.requests.length;
    expect(await verify("")).toEqual({ ok: false, reason: "missing_token" });
    expect(await verify("x".repeat(2049))).toEqual({ ok: false, reason: "missing_token" });
    expect(server.requests.length).toBe(before);
  });

  it("an unset secret refuses, never skips: no request is made (staging without 05-P7)", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    const before = server.requests.length;
    expect(await verifyTurnstile(TOKEN, { verifyUrl: server.url, expectedHostname: HOST })).toEqual({
      ok: false,
      reason: "unconfigured",
    });
    expect(await verifyTurnstile(TOKEN, { secret: "", verifyUrl: server.url, expectedHostname: HOST })).toEqual({
      ok: false,
      reason: "unconfigured",
    });
    expect(server.requests.length).toBe(before);
  });

  it("with a Cloudflare test secret the hostname is not checked (dummy answers; local tiers only)", async () => {
    expect(await verify(`wronghost.${TOKEN}`, TURNSTILE_PASS_SECRET_KEY)).toEqual({ ok: true });
    expect(await verify(`fail.${TOKEN}`, TURNSTILE_PASS_SECRET_KEY)).toEqual({ ok: false, reason: "rejected" });
  });

  it("reads the secret, URL and app hostname from the environment by default", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", TURNSTILE_PASS_SECRET_KEY);
    vi.stubEnv("TURNSTILE_VERIFY_URL", server.url);
    const before = server.requests.length;
    expect(await verifyTurnstile(TOKEN)).toEqual({ ok: true });
    expect(server.requests.length).toBe(before + 1);
    expect(await verifyTurnstile(`fail.${TOKEN}`)).toEqual({ ok: false, reason: "rejected" });
  });
});
