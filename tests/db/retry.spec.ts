/**
 * `retryOnDeadlock` (lib/db/retry.ts, V2-05 05-11c, INT L-3): a write PostgreSQL aborted as a deadlock victim (40P01)
 * runs exactly once more with a fresh query; any other outcome, and the retry's own outcome, is returned unchanged.
 * The real race is forced in tests/scheduling/slot-deadlock-retry.spec.ts; this pins the helper's contract.
 */
import { describe, expect, it } from "vitest";
import { isDeadlock, retryOnDeadlock } from "@/lib/db/retry";

type R = { data: string | null; error: { code: string; message: string } | null };
const DEADLOCK: R = { data: null, error: { code: "40P01", message: "deadlock detected" } };
const TAKEN: R = { data: null, error: { code: "23P01", message: "exclusion" } };
const OK: R = { data: "row", error: null };

function writer(results: R[]) {
  let calls = 0;
  return {
    write: () => Promise.resolve(results[calls++]),
    calls: () => calls,
  };
}

describe("retryOnDeadlock", () => {
  it.each([
    ["success: not retried", [OK], OK, 1],
    ["23P01: not retried", [TAKEN], TAKEN, 1],
    ["40P01 then success: the retry's result", [DEADLOCK, OK], OK, 2],
    ["40P01 then 23P01: the retry's result", [DEADLOCK, TAKEN], TAKEN, 2],
    ["40P01 twice: retried once only, the second deadlock is returned", [DEADLOCK, DEADLOCK, OK], DEADLOCK, 2],
  ] as const)("%s", async (_name, results, expected, calls) => {
    const w = writer([...results]);
    expect(await retryOnDeadlock(w.write)).toEqual(expected);
    expect(w.calls()).toBe(calls);
  });

  it("isDeadlock is true only for SQLSTATE 40P01", () => {
    expect(isDeadlock(DEADLOCK.error)).toBe(true);
    expect(isDeadlock(TAKEN.error)).toBe(false);
    expect(isDeadlock({ code: "40001" })).toBe(false);
    expect(isDeadlock(null)).toBe(false);
    expect(isDeadlock(undefined)).toBe(false);
  });
});
