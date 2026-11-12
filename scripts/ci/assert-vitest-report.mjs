#!/usr/bin/env node
/**
 * Vitest report gate (V2-02 plan 02-01 step 3; roadmap V2-02 acceptance "0 skipped in the DB lane"; G3).
 *
 * Reads the JSON written by `vitest run --reporter=json --outputFile=<file>` and fails when
 *   - the run did not succeed, or any test file did not pass (includes files that failed to import);
 *   - any test failed;
 *   - any test is skipped, pending or todo (`it.skip`, `describe.skip`, `it.todo`, `skipIf` that fired, a filtered
 *     `.only` run) — the DB lane must run everything;
 *   - the total test count is below the floor (a silently shrinking suite, e.g. a glob or config change).
 *
 * FLOOR history (update in the same commit that legitimately removes tests, with the arithmetic):
 *   1100 — V2-02 02-01 (full suite at 60d8db0 had 1128 tests).
 *   1100 — V2-02 02-04, unchanged: −13 deleted (T-12: cabin/navigation-roles 5, queue/status-actions 5,
 *          ops/backup-restore 3), +1 (the one real case from navigation-roles moved to settings/profile-and-credentials),
 *          +1 visit-history and +1 clinic-visits-register (mock "isolation" cases rewritten as DB cases, dual-tenant
 *          user added), +7 tests/ci/doc-grep-gate, +3 tests/ci/tests-typecheck = net 0.
 *
 * Usage: node scripts/ci/assert-vitest-report.mjs <report.json> [--min-total <n>]
 * Exit 0 = pass, 1 = gate failure, 2 = usage or unreadable report.
 */
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

const FLOOR = 1100;

const file = process.argv[2];
if (!file || file.startsWith("--")) {
  console.error("usage: node scripts/ci/assert-vitest-report.mjs <report.json> [--min-total <n>]");
  process.exit(2);
}
const minIdx = process.argv.indexOf("--min-total");
const floor = minIdx > -1 ? Number(process.argv[minIdx + 1]) : FLOOR;
if (!Number.isInteger(floor) || floor < 0) {
  console.error("vitest-report-gate: --min-total must be a non-negative integer");
  process.exit(2);
}

let report;
try {
  report = JSON.parse(readFileSync(resolve(file), "utf8"));
} catch {
  console.error(`vitest-report-gate: cannot read a JSON report at ${file}`);
  process.exit(2);
}
if (!Array.isArray(report.testResults)) {
  console.error("vitest-report-gate: report has no testResults array (not a Vitest JSON report)");
  process.exit(2);
}

const cwd = process.cwd();
const short = (name) => (typeof name === "string" && name.startsWith(`${cwd}/`) ? relative(cwd, name) : name);
const problems = [];
const counts = { files: report.testResults.length, total: 0, passed: 0, failed: 0, skipped: 0 };

for (const f of report.testResults) {
  if (f.status !== "passed") problems.push(`file ${f.status ?? "unknown"}: ${short(f.name)}`);
  for (const t of f.assertionResults ?? []) {
    counts.total += 1;
    if (t.status === "passed") {
      counts.passed += 1;
    } else if (t.status === "failed") {
      counts.failed += 1;
      problems.push(`test failed: ${short(f.name)} > ${t.fullName ?? t.title}`);
    } else {
      counts.skipped += 1;
      problems.push(`test ${t.status ?? "not run"} (0 skipped allowed): ${short(f.name)} > ${t.fullName ?? t.title}`);
    }
  }
}

// The summary counters must agree with the per-test statuses (guards against a truncated or hand-edited report).
const pending = (report.numPendingTests ?? 0) + (report.numTodoTests ?? 0);
if ((report.numFailedTests ?? 0) > 0 && counts.failed === 0) problems.push(`numFailedTests=${report.numFailedTests}`);
if (pending > 0 && counts.skipped === 0) problems.push(`numPendingTests+numTodoTests=${pending} (0 skipped allowed)`);
if ((report.numFailedTestSuites ?? 0) > 0 && !problems.some((p) => p.startsWith("file "))) {
  problems.push(`numFailedTestSuites=${report.numFailedTestSuites}`);
}
if (report.success !== true) problems.push(`success=${report.success}`);
if (counts.total < floor) problems.push(`total ${counts.total} is below the floor ${floor} (suite shrank?)`);

console.log(
  `vitest-report-gate: files=${counts.files} tests=${counts.total} passed=${counts.passed} failed=${counts.failed} ` +
    `skipped/todo=${counts.skipped} floor=${floor}`,
);
if (problems.length) {
  const shown = problems.slice(0, 200);
  for (const p of shown) console.error(`FAIL ${p}`);
  if (problems.length > shown.length) console.error(`FAIL ... and ${problems.length - shown.length} more`);
  process.exit(1);
}
console.log("vitest-report-gate: PASS");
