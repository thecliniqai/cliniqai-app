/**
 * V2-04 04-02 (RL-23, R-18, R-49; T-04-01, T-04-02): `isAuthorisedRunner` (lib/jobs/auth.ts), the bearer check of
 * `/api/jobs/run`. The bearer is a short-lived token `v1.<unix_ts>.<hex hmac_sha256(secret, "jobs-run|v1|" + ts)>`,
 * never the secret itself.
 *
 * - A token minted now (and at exactly ±120 s) with the current secret is accepted; with the rotation slot set, a
 *   token of either secret is accepted; a token at −121 s (stale) or +121 s (future) is refused.
 * - A token signed with another secret, the raw secret as bearer (the 000033 form), and every malformed shape (scheme,
 *   version, non-canonical or non-numeric timestamp, upper-case or short hex, extra parts, padding) are refused.
 * - The token's construction matches an independent HMAC computation, so the SQL kick and the route agree.
 * - Constant time: every well-formed token is compared through `timingSafeEqual` on two 32-byte buffers, against both
 *   secrets whatever the first result (no early exit); malformed headers are refused before any comparison.
 * - No current secret → always false (also when only the rotation slot is set), nothing compared.
 *
 * Secrets are random per run, built at run time. Time is passed explicitly (no clock reads in assertions).
 */
import { createHmac, randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const compares = vi.hoisted(() => ({ lengths: [] as Array<[number, number]> }));

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  const timingSafeEqual: typeof actual.timingSafeEqual = (a, b) => {
    compares.lengths.push([a.byteLength, b.byteLength]);
    return actual.timingSafeEqual(a, b);
  };
  return { ...actual, default: { ...actual, timingSafeEqual }, timingSafeEqual };
});

const { isAuthorisedRunner, mintRunnerToken, RUNNER_TOKEN_MAX_SKEW_SECONDS } = await import("@/lib/jobs/auth");

const current = randomBytes(32).toString("hex");
const next = randomBytes(32).toString("hex");
const NOW = 1_794_000_000; // a fixed instant (2026-11-07); every case passes its own clock
const bearer = (value: string) => `Bearer ${value}`;
const tokenAt = (secret: string, ts: number) => bearer(mintRunnerToken(secret, ts));

beforeEach(() => {
  compares.lengths = [];
});

describe("mintRunnerToken: the format the SQL kick builds (migration 000034)", () => {
  it("is v1.<ts>.<hex hmac_sha256(secret, 'jobs-run|v1|' + ts)> and never contains the secret", () => {
    const token = mintRunnerToken(current, NOW);
    const expected = createHmac("sha256", current).update(`jobs-run|v1|${NOW}`).digest("hex");
    expect(token).toBe(`v1.${NOW}.${expected}`);
    expect(token).not.toContain(current);
  });
});

describe("isAuthorisedRunner: freshness window (±120 s)", () => {
  it("accepts a token minted now and at exactly ±120 s", () => {
    expect(RUNNER_TOKEN_MAX_SKEW_SECONDS).toBe(120);
    for (const ts of [NOW, NOW - 120, NOW + 120]) {
      expect(isAuthorisedRunner(tokenAt(current, ts), { current }, NOW), String(ts - NOW)).toBe(true);
    }
  });

  it.each([
    ["stale (−121 s)", -121],
    ["future (+121 s)", 121],
    ["an hour old", -3600],
    ["a day ahead", 86_400],
  ])("refuses a %s token, without comparing", (_label, offset) => {
    expect(isAuthorisedRunner(tokenAt(current, NOW + offset), { current }, NOW)).toBe(false);
    expect(compares.lengths).toEqual([]);
  });
});

describe("isAuthorisedRunner: the HMAC", () => {
  it("refuses a well-formed, fresh token signed with another secret", () => {
    expect(isAuthorisedRunner(tokenAt(randomBytes(32).toString("hex"), NOW), { current }, NOW)).toBe(false);
  });

  it("refuses a token whose timestamp was changed after signing (the HMAC covers it)", () => {
    const [, , hex] = mintRunnerToken(current, NOW).split(".");
    expect(isAuthorisedRunner(bearer(`v1.${NOW + 1}.${hex}`), { current }, NOW)).toBe(false);
  });

  it.each([
    ["no header", null],
    ["an undefined header", undefined],
    ["an empty header", ""],
    ["`Bearer ` with nothing", "Bearer "],
    ["the raw secret as bearer (the 000033 form)", bearer(current)],
    ["the literal `undefined`", "Bearer undefined"],
    ["a token without the scheme", mintRunnerToken(current, NOW)],
    ["a lower-case scheme", `bearer ${mintRunnerToken(current, NOW)}`],
    ["two spaces", `Bearer  ${mintRunnerToken(current, NOW)}`],
    ["a trailing space", `${tokenAt(current, NOW)} `],
    ["another version", bearer(mintRunnerToken(current, NOW).replace(/^v1\./, "v2."))],
    ["a leading-zero timestamp", bearer(mintRunnerToken(current, NOW).replace(`.${NOW}.`, `.0${NOW}.`))],
    ["a negative timestamp", bearer(mintRunnerToken(current, NOW).replace(`.${NOW}.`, `.-${NOW}.`))],
    ["a fractional timestamp", bearer(mintRunnerToken(current, NOW).replace(`.${NOW}.`, `.${NOW}.5.`))],
    ["upper-case hex", bearer(mintRunnerToken(current, NOW).toUpperCase().replace(/^V1/, "v1"))],
    ["a truncated HMAC", bearer(mintRunnerToken(current, NOW).slice(0, -2))],
    ["an extra part", bearer(`${mintRunnerToken(current, NOW)}.x`)],
  ])("refuses %s, without comparing", (_label, header) => {
    expect(isAuthorisedRunner(header, { current, next }, NOW)).toBe(false);
    expect(compares.lengths).toEqual([]);
  });
});

describe("isAuthorisedRunner: rotation (current + next)", () => {
  it("accepts a token of the current and of the next secret while both are set", () => {
    expect(isAuthorisedRunner(tokenAt(current, NOW), { current, next }, NOW)).toBe(true);
    expect(isAuthorisedRunner(tokenAt(next, NOW), { current, next }, NOW)).toBe(true);
    expect(isAuthorisedRunner(tokenAt(randomBytes(32).toString("hex"), NOW), { current, next }, NOW)).toBe(false);
  });

  it("compares a well-formed token with both secrets every time, as 32-byte buffers (no early exit)", () => {
    for (const secret of [current, next, randomBytes(32).toString("hex")]) {
      compares.lengths = [];
      isAuthorisedRunner(tokenAt(secret, NOW), { current, next }, NOW);
      expect(compares.lengths).toEqual([
        [32, 32],
        [32, 32],
      ]);
    }
  });

  it("refuses the next secret's token once the slot is unset", () => {
    expect(isAuthorisedRunner(tokenAt(next, NOW), { current }, NOW)).toBe(false);
  });
});

describe("isAuthorisedRunner: no secret configured", () => {
  it.each([
    ["nothing set", {}],
    ["an empty current secret", { current: "" }],
    ["only the rotation slot", { next }],
  ])("%s: always false, nothing compared", (_label, secrets) => {
    for (const header of [tokenAt(next, NOW), tokenAt("", NOW), "Bearer ", "Bearer undefined", null]) {
      expect(isAuthorisedRunner(header, secrets, NOW)).toBe(false);
    }
    expect(compares.lengths).toEqual([]);
  });
});
