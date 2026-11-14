/**
 * pgTAP report gate (V2-05 05-01a; roadmap V2-05 evidence "CI pgTAP report"): proves scripts/ci/assert-pgtap-report.mjs
 * passes a clean pg_prove --verbose report and fails on a failed test, a parse error ("No plan found"), a SKIP, a TODO,
 * a file that died before its plan, a truncated report, a missing required file and a suite below the floor.
 * Reports are fixtures in lint-fixtures/pgtap-report/ (clean.tap is a real `npm run test:pgtap` report with the
 * checkout path replaced by /repo; no-plan.tap is the pre-05-01a `supabase test db --local` output).
 */
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FLOOR, REQUIRED_FILES } from "../../scripts/ci/assert-pgtap-report.mjs";
import { runNodeChecker } from "./run-checker";

const gate = (fixture: string, ...extra: string[]) =>
  runNodeChecker("assert-pgtap-report.mjs", [`lint-fixtures/pgtap-report/${fixture}.tap`, ...extra]);

/** The fixtures are 05-01a reports of the two legacy files: check them against the 05-01a floor and file list. */
const LEGACY_FILES = [
  "supabase/tests/database/memberships_bounds_cleanup.test.sql",
  "supabase/tests/database/search_medicines_extension_schema.test.sql",
];
const LEGACY = ["--min-total", "13", "--require-files", LEGACY_FILES.join(",")];

describe("pgTAP report gate", () => {
  it("passes a clean report at the floor with both required files", () => {
    const r = gate("clean", ...LEGACY);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("files=2 tests=13 passed=13 failed=0 skipped/todo=0 floor=13 required=2");
    expect(r.stdout).toContain("pgtap-report-gate: PASS");
  });

  it("the shipped gate (05a close) refuses a report without the 05a files: every 05a file is required, floor 3343", () => {
    const r = gate("clean");
    expect(r.status).toBe(1);
    expect(r.stdout).toContain(`files=2 tests=13 passed=13 failed=0 skipped/todo=0 floor=${FLOOR} required=${REQUIRED_FILES.length}`);
    expect(r.stderr).toContain(`FAIL total 13 is below the floor ${FLOOR} (suite shrank?)`);
    for (const f of [
      "authz_matrix",
      "authz_completeness",
      "visit_integrity",
      "migration_edge_cases_visit_integrity",
      "invitation_binding",
      "billing_rpc_only",
      "api_keys_notices_columns",
      "actor_bindings_audit",
      "reverify_integrity",
      "amendment_snapshot",
      "signed_visit_fields",
    ]) {
      expect(r.stderr).toContain(`FAIL required pgTAP file missing: supabase/tests/database/${f}.test.sql`);
    }
    const missing = r.stderr.split("\n").filter((l) => l.startsWith("FAIL required pgTAP file missing:"));
    expect(missing).toHaveLength(REQUIRED_FILES.length - LEGACY_FILES.length);
  });

  it("pins the 05a floor and names only files that exist, each once", () => {
    expect(FLOOR).toBeGreaterThanOrEqual(3343);
    expect(REQUIRED_FILES.length).toBeGreaterThanOrEqual(31);
    expect(new Set(REQUIRED_FILES).size).toBe(REQUIRED_FILES.length);
    expect(REQUIRED_FILES.filter((f) => !existsSync(f))).toEqual([]);
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
