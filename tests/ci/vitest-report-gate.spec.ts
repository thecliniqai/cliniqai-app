/**
 * Vitest report gate (V2-02 02-01 step 3; roadmap acceptance "0 skipped in the DB lane"): proves
 * scripts/ci/assert-vitest-report.mjs fails on a skipped test, a todo test, a failed test, a file that failed to load
 * and a suite below the floor, and passes a clean report. Reports are fixtures in lint-fixtures/vitest-report/.
 */
import { describe, expect, it } from "vitest";
import { runNodeChecker } from "./run-checker";

const gate = (fixture: string, ...extra: string[]) =>
  runNodeChecker("assert-vitest-report.mjs", [`lint-fixtures/vitest-report/${fixture}.json`, ...extra]);
/** The status checks alone: these fixtures carry no security spec files. */
const statusGate = (fixture: string, ...extra: string[]) => gate(fixture, "--require-files", "none", ...extra);

describe("vitest report gate", () => {
  it("passes a report with every test passed and the total at the floor", () => {
    const r = statusGate("clean", "--min-total", "3");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("tests=3 passed=3 failed=0 skipped/todo=0");
    expect(r.stdout).toContain("PASS");
  });

  it("fails when one test is skipped (0 skipped allowed), naming it", () => {
    const r = statusGate("skipped", "--min-total", "3");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("test skipped (0 skipped allowed): /repo/tests/fixture/a.spec.ts > fixture a needs the database");
  });

  it("fails when a test is todo", () => {
    const r = statusGate("todo", "--min-total", "3");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("test todo (0 skipped allowed)");
  });

  it("fails on a failed test", () => {
    const r = statusGate("failed", "--min-total", "3");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("test failed: /repo/tests/fixture/a.spec.ts > fixture a rejects the forged tenant");
  });

  it("fails when a test file failed to load even though every collected test passed", () => {
    const r = statusGate("file-error", "--min-total", "3");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("file failed: /repo/tests/fixture/broken-import.spec.ts");
  });

  it("fails when the suite shrinks below the recorded floor (default 3292, 95% of the suite, IR-F5)", () => {
    const r = statusGate("clean");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("total 3 is below the floor 3292");
  });

  it("fails when a required security spec file is missing, naming each one (IR-F5)", () => {
    const r = gate("clean", "--min-total", "3");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("required spec file missing: tests/security/guard-actions.spec.ts");
    expect(r.stderr).toContain("required spec file missing: tests/security/membership-guard.spec.ts");
  });

  it("passes when the required files are present with passed tests, and fails one with none passed", () => {
    const ok = gate("required", "--min-total", "3", "--require-files", "tests/security/guard-actions.spec.ts,tests/security/cross-tenant-refs.spec.ts");
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain("required=2");
    const none = gate("required-none-passed", "--min-total", "1", "--require-files", "tests/security/guard-actions.spec.ts");
    expect(none.status).toBe(1);
    expect(none.stderr).toContain("required spec file has no passed test: tests/security/guard-actions.spec.ts");
  });

  it("exits 2 on a missing report", () => {
    const r = gate("does-not-exist");
    expect(r.status).toBe(2);
  });
});
