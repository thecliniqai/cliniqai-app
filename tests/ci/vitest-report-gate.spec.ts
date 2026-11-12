/**
 * Vitest report gate (V2-02 02-01 step 3; roadmap acceptance "0 skipped in the DB lane"): proves
 * scripts/ci/assert-vitest-report.mjs fails on a skipped test, a todo test, a failed test, a file that failed to load
 * and a suite below the floor, and passes a clean report. Reports are fixtures in lint-fixtures/vitest-report/.
 */
import { describe, expect, it } from "vitest";
import { runNodeChecker } from "./run-checker";

const gate = (fixture: string, ...extra: string[]) =>
  runNodeChecker("assert-vitest-report.mjs", [`lint-fixtures/vitest-report/${fixture}.json`, ...extra]);

describe("vitest report gate", () => {
  it("passes a report with every test passed and the total at the floor", () => {
    const r = gate("clean", "--min-total", "3");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("tests=3 passed=3 failed=0 skipped/todo=0");
    expect(r.stdout).toContain("PASS");
  });

  it("fails when one test is skipped (0 skipped allowed), naming it", () => {
    const r = gate("skipped", "--min-total", "3");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("test skipped (0 skipped allowed): /repo/tests/fixture/a.spec.ts > fixture a needs the database");
  });

  it("fails when a test is todo", () => {
    const r = gate("todo", "--min-total", "3");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("test todo (0 skipped allowed)");
  });

  it("fails on a failed test", () => {
    const r = gate("failed", "--min-total", "3");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("test failed: /repo/tests/fixture/a.spec.ts > fixture a rejects the forged tenant");
  });

  it("fails when a test file failed to load even though every collected test passed", () => {
    const r = gate("file-error", "--min-total", "3");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("file failed: /repo/tests/fixture/broken-import.spec.ts");
  });

  it("fails when the suite shrinks below the recorded floor (default 1100)", () => {
    const r = gate("clean");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("total 3 is below the floor 1100");
  });

  it("exits 2 on a missing report", () => {
    const r = gate("does-not-exist");
    expect(r.status).toBe(2);
  });
});
