/**
 * pgTAP report gate (V2-05 05-01a; roadmap V2-05 evidence "CI pgTAP report"): proves scripts/ci/assert-pgtap-report.mjs
 * passes a clean pg_prove --verbose report and fails on a failed test, a parse error ("No plan found"), a SKIP, a TODO,
 * a file that died before its plan, a truncated report, a missing required file and a suite below the floor.
 * Reports are fixtures in lint-fixtures/pgtap-report/ (clean.tap is a real `npm run test:pgtap` report with the
 * checkout path replaced by /repo; no-plan.tap is the pre-05-01a `supabase test db --local` output).
 */
import { describe, expect, it } from "vitest";
import { runNodeChecker } from "./run-checker";

const gate = (fixture: string, ...extra: string[]) =>
  runNodeChecker("assert-pgtap-report.mjs", [`lint-fixtures/pgtap-report/${fixture}.tap`, ...extra]);

describe("pgTAP report gate", () => {
  it("passes a clean report at the floor with both required files", () => {
    const r = gate("clean");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("files=2 tests=13 passed=13 failed=0 skipped/todo=0 floor=13 required=2");
    expect(r.stdout).toContain("pgtap-report-gate: PASS");
  });

  it("fails on one `not ok`, naming the file and the test", () => {
    const r = gate("failed");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(
      "FAIL test failed: supabase/tests/database/memberships_bounds_cleanup.test.sql > 4 - slot length 3 is clamped to 5",
    );
    expect(r.stderr).toContain("FAIL Result: FAIL");
  });

  it("fails on a `No plan found` parse error (the pre-05-01a psql scripts)", () => {
    const r = gate("no-plan");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("FAIL pg_prove parse error: Parse errors: No plan found in TAP output");
    expect(r.stderr).toContain("FAIL no plan found: supabase/tests/memberships_bounds_cleanup.sql");
  });

  it("fails on a `# SKIP` test even though pg_prove counts it as passed", () => {
    const r = gate("skip");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(
      "FAIL test skipped (0 skipped allowed): supabase/tests/database/search_medicines_extension_schema.test.sql > 3",
    );
  });

  it("fails on a `# TODO` test", () => {
    const r = gate("todo");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(
      "FAIL test todo (0 todo allowed): supabase/tests/database/memberships_bounds_cleanup.test.sql > 6 - an in-range slot length is not changed",
    );
  });

  it("fails when a file ran fewer tests than it planned", () => {
    const r = gate("died", "--min-total", "0");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("FAIL planned 7 tests but ran 3: supabase/tests/database/memberships_bounds_cleanup.test.sql");
  });

  it("fails a truncated report (no summary, no Result line)", () => {
    const r = gate("truncated");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("FAIL no `Result:` line (report truncated?)");
    expect(r.stderr).toContain("FAIL no `Files=…, Tests=…` summary line (report truncated?)");
  });

  it("fails when a required pgTAP file is missing from an otherwise passing report", () => {
    const r = gate("one-file", "--min-total", "0");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(
      "FAIL required pgTAP file missing: supabase/tests/database/search_medicines_extension_schema.test.sql",
    );
    expect(r.stderr).not.toContain("memberships_bounds_cleanup.test.sql");
  });

  it("fails a clean report when --require-files names a file the run did not include", () => {
    const r = gate("clean", "--require-files", "supabase/tests/database/authz_matrix.test.sql");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("FAIL required pgTAP file missing: supabase/tests/database/authz_matrix.test.sql");
  });

  it("fails when the total is below the floor", () => {
    const r = gate("clean", "--min-total", "14");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("FAIL total 13 is below the floor 14 (suite shrank?)");
  });

  it("exits 2 on an unreadable report or bad usage", () => {
    expect(runNodeChecker("assert-pgtap-report.mjs", ["lint-fixtures/pgtap-report/absent.tap"]).status).toBe(2);
    expect(runNodeChecker("assert-pgtap-report.mjs", []).status).toBe(2);
    expect(gate("clean", "--min-total", "-1").status).toBe(2);
  });
});
