/**
 * V2-09e 09E-02, staging finding of 2026-11-23: the first password-reset save on staging stalled about 30 s and the page said "We couldn't reset
 * your password" although the outcome was unknown (the retry saved). `saveWithRecheck` (features/auth/password-flows.ts) never reports "failed"
 * for a save whose answer did not arrive: it looks at the recovery session (a successful reset ends it, ruling R-35), tries once more if the
 * session is still open, and says "could not confirm" when it cannot tell. The cases assert the result the page acts on. Synthetic input only.
 */
import { describe, expect, it, vi } from "vitest";
import {
  AUTH_MESSAGES,
  probeRecoverySession,
  saveWithRecheck,
  type RecoverySessionProbe,
  type SetPasswordResult,
} from "@/features/auth/password-flows";

const INPUT = { newPassword: "synthetic-Pass-1234" };
const SAVED: SetPasswordResult = { ok: true, otherSessionsSignedOut: true, signedOut: true };

function harness(opts: { saves: Array<SetPasswordResult | "throw">; probes: RecoverySessionProbe[] }) {
  const saves = [...opts.saves];
  const probes = [...opts.probes];
  const save = vi.fn(async () => {
    const next = saves.shift();
    if (next === undefined || next === "throw") throw new TypeError("fetch failed");
    return next;
  });
  const probe = vi.fn(async () => probes.shift() ?? "unknown");
  const onChecking = vi.fn();
  return { save, probe, onChecking, run: () => saveWithRecheck(INPUT, { save, probe, onChecking }) };
}

describe("saveWithRecheck: an answer that arrives is the outcome", () => {
  it("success is success, with no session check and no 'checking'", async () => {
    const h = harness({ saves: [SAVED], probes: [] });
    expect(await h.run()).toEqual(SAVED);
    expect(h.probe).not.toHaveBeenCalled();
    expect(h.onChecking).not.toHaveBeenCalled();
  });

  it("a refusal the server answered (a breached password) is returned as it is, without a check or a retry", async () => {
    const refusal: SetPasswordResult = { ok: false, code: "pwned_password", message: "This password has appeared in a data breach. Choose a different one." };
    const h = harness({ saves: [refusal], probes: [] });
    expect(await h.run()).toEqual(refusal);
    expect(h.save).toHaveBeenCalledTimes(1);
    expect(h.probe).not.toHaveBeenCalled();
  });
});

describe("saveWithRecheck: the answer did not arrive", () => {
  it("the recovery session is gone: the save went through, so the reset is reported as done and nothing is retried", async () => {
    const h = harness({ saves: ["throw"], probes: ["gone"] });
    const result = await h.run();
    expect(result).toEqual({ ok: true, otherSessionsSignedOut: false, signedOut: true });
    expect(h.save).toHaveBeenCalledTimes(1);
    expect(h.onChecking).toHaveBeenCalledTimes(1);
  });

  it("the session is still open: nothing was saved, the save is tried once more and its answer is the outcome", async () => {
    const h = harness({ saves: ["throw", SAVED], probes: ["alive"] });
    expect(await h.run()).toEqual(SAVED);
    expect(h.save).toHaveBeenCalledTimes(2);
  });

  it("the retry also goes unanswered and the session is then gone: done", async () => {
    const h = harness({ saves: ["throw", "throw"], probes: ["alive", "gone"] });
    expect(await h.run()).toMatchObject({ ok: true, signedOut: true });
    expect(h.save).toHaveBeenCalledTimes(2);
  });

  it("the retry also goes unanswered and the session is still open: now it is a failure, and only now", async () => {
    const h = harness({ saves: ["throw", "throw"], probes: ["alive", "alive"] });
    expect(await h.run()).toEqual({ ok: false, code: "unknown", message: AUTH_MESSAGES.reset_failed });
    expect(h.save).toHaveBeenCalledTimes(2);
  });

  it("a retry the server answers 'session not found' means the first call finished meanwhile: done", async () => {
    const gone: SetPasswordResult = { ok: false, code: "session_not_found", message: "Your session has ended. Please sign in again." };
    const h = harness({ saves: ["throw", gone], probes: ["alive"] });
    expect(await h.run()).toMatchObject({ ok: true, signedOut: true });
  });

  it("a retry the server refuses for another reason is shown as that refusal", async () => {
    const weak: SetPasswordResult = { ok: false, code: "weak_password", message: "Choose a stronger password." };
    const h = harness({ saves: ["throw", weak], probes: ["alive"] });
    expect(await h.run()).toEqual(weak);
  });

  it("the session check is silent twice: 'could not confirm', never 'failed', and nothing is retried blindly", async () => {
    const h = harness({ saves: ["throw"], probes: ["unknown", "unknown"] });
    const result = await h.run();
    expect(result).toEqual({ ok: false, code: "unknown", message: AUTH_MESSAGES.reset_unconfirmed });
    expect(AUTH_MESSAGES.reset_unconfirmed).not.toContain("couldn't reset");
    expect(AUTH_MESSAGES.reset_unconfirmed).toContain("couldn't confirm");
    expect(h.save).toHaveBeenCalledTimes(1);
    expect(h.probe).toHaveBeenCalledTimes(2);
  });

  it("the session check is silent once and then answers: the answer decides", async () => {
    const h = harness({ saves: ["throw"], probes: ["unknown", "gone"] });
    expect(await h.run()).toMatchObject({ ok: true, signedOut: true });
  });
});

describe("probeRecoverySession", () => {
  const client = (answer: () => Promise<{ data: { user: object | null }; error: object | null }>) => ({ auth: { getUser: answer } }) as never;

  it("a user is an open session", async () => {
    expect(await probeRecoverySession(client(async () => ({ data: { user: {} }, error: null })))).toBe("alive");
  });

  it("GoTrue's 'session not found', a 401 or 403 and a missing session mean the session was ended", async () => {
    for (const error of [{ code: "session_not_found", status: 403 }, { status: 401 }, { status: 403 }, { name: "AuthSessionMissingError" }]) {
      expect(await probeRecoverySession(client(async () => ({ data: { user: null }, error })))).toBe("gone");
    }
  });

  it("a network error, a 5xx, a 429 and a throw tell nothing", async () => {
    for (const error of [{ name: "AuthRetryableFetchError", status: 0 }, { status: 503 }, { status: 429, code: "over_request_rate_limit" }]) {
      expect(await probeRecoverySession(client(async () => ({ data: { user: null }, error })))).toBe("unknown");
    }
    expect(await probeRecoverySession(client(async () => Promise.reject(new TypeError("fetch failed"))))).toBe("unknown");
  });
});
