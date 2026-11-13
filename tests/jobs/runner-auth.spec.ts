/**
 * V2-04 04-02 (RL-23, R-18; T-04-01): `isAuthorisedRunner` (lib/jobs/auth.ts), the bearer check of `/api/jobs/run`.
 *
 * - The current secret, and the rotation slot when set, are accepted; anything else is refused, including the right
 *   value without `Bearer `, with a lower-case scheme, with padding, or another secret's value.
 * - Constant time: every decision goes through `timingSafeEqual` on two 32-byte SHA-256 digests (so a shorter or
 *   longer bearer never throws and its length never matters), and with a rotation slot set the given value is
 *   compared with both secrets whatever the first comparison found (no early exit).
 * - No current secret → always false (also when only the rotation slot is set), without comparing anything.
 *
 * Secrets are random per run, built at run time.
 */
import { randomBytes } from "node:crypto";
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

const { isAuthorisedRunner } = await import("@/lib/jobs/auth");

const current = randomBytes(32).toString("hex");
const next = randomBytes(32).toString("hex");
const bearer = (value: string) => `Bearer ${value}`;

beforeEach(() => {
  compares.lengths = [];
});

describe("isAuthorisedRunner: the current secret", () => {
  it("accepts `Bearer <current>`", () => {
    expect(isAuthorisedRunner(bearer(current), { current })).toBe(true);
  });

  it.each([
    ["no header", null],
    ["an undefined header", undefined],
    ["an empty header", ""],
    ["`Bearer ` with nothing", "Bearer "],
    ["the secret without the scheme", current],
    ["a lower-case scheme", `bearer ${current}`],
    ["two spaces", `Bearer  ${current}`],
    ["a trailing space", `${bearer(current)} `],
    ["the secret with one character changed", bearer(`${current.slice(0, -1)}${current.endsWith("0") ? "1" : "0"}`)],
    ["a prefix of the secret", bearer(current.slice(0, 16))],
    ["the secret plus a suffix", bearer(`${current}0`)],
    ["a much longer value", bearer(current.repeat(64))],
    ["another random value", bearer(randomBytes(32).toString("hex"))],
    ["the literal `undefined`", "Bearer undefined"],
  ])("refuses %s", (_label, header) => {
    expect(isAuthorisedRunner(header, { current })).toBe(false);
  });

  it("never throws on a length difference: both sides are always 32-byte digests", () => {
    for (const value of ["", "x", current.slice(0, 31), current, `${current}${current}`, "y".repeat(10_000)]) {
      expect(() => isAuthorisedRunner(bearer(value), { current })).not.toThrow();
    }
    expect(compares.lengths.length).toBe(6);
    expect(compares.lengths.every(([a, b]) => a === 32 && b === 32)).toBe(true);
  });
});

describe("isAuthorisedRunner: the rotation slot", () => {
  it("accepts the current and the next secret while both are set", () => {
    expect(isAuthorisedRunner(bearer(current), { current, next })).toBe(true);
    expect(isAuthorisedRunner(bearer(next), { current, next })).toBe(true);
    expect(isAuthorisedRunner(bearer(randomBytes(32).toString("hex")), { current, next })).toBe(false);
  });

  it("compares with both secrets every time (no early exit on the first match or mismatch)", () => {
    for (const value of [current, next, "wrong"]) {
      compares.lengths = [];
      isAuthorisedRunner(bearer(value), { current, next });
      expect(compares.lengths, value === "wrong" ? "mismatch" : "match").toEqual([
        [32, 32],
        [32, 32],
      ]);
    }
  });

  it("refuses the next secret once it is unset", () => {
    expect(isAuthorisedRunner(bearer(next), { current })).toBe(false);
  });
});

describe("isAuthorisedRunner: no secret configured", () => {
  it.each([
    ["nothing set", {}],
    ["an empty current secret", { current: "" }],
    ["only the rotation slot", { next }],
  ])("%s: always false, nothing compared", (_label, secrets) => {
    for (const header of [bearer(next), "Bearer ", "Bearer undefined", null]) {
      expect(isAuthorisedRunner(header, secrets)).toBe(false);
    }
    expect(compares.lengths).toEqual([]);
  });
});
