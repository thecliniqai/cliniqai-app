#!/usr/bin/env node
/**
 * Vitest report gate (V2-02 plan 02-01 step 3; roadmap V2-02 acceptance "0 skipped in the DB lane"; G3).
 *
 * Reads the JSON written by `vitest run --reporter=json --outputFile=<file>` and fails when
 *   - the run did not succeed, or any test file did not pass (includes files that failed to import);
 *   - any test failed;
 *   - any test is skipped, pending or todo (`it.skip`, `describe.skip`, `it.todo`, `skipIf` that fired, a filtered
 *     `.only` run) — the DB lane must run everything;
 *   - the total test count is below the floor (a silently shrinking suite, e.g. a glob or config change);
 *   - (V2-02 02-06, IR-F5) a required security spec file is missing or has no passed test: the floor alone would let
 *     a whole spec vanish.
 *
 * FLOOR rule (IR-F5): at least 95% of the measured suite, so a drop of more than ~5% fails.
 * FLOOR history (update in the same commit that legitimately removes tests, with the arithmetic):
 *   1100 — V2-02 02-01 (full suite at 60d8db0 had 1128 tests).
 *   1100 — V2-02 02-04, unchanged: −13 deleted (T-12: cabin/navigation-roles 5, queue/status-actions 5,
 *          ops/backup-restore 3), +1 (the one real case from navigation-roles moved to settings/profile-and-credentials),
 *          +1 visit-history and +1 clinic-visits-register (mock "isolation" cases rewritten as DB cases, dual-tenant
 *          user added), +7 tests/ci/doc-grep-gate, +3 tests/ci/tests-typecheck = net 0.
 *   1805 — V2-02 02-06 (IR-F5): the full suite at 21eff42 had 1885 tests, +14 in the 02-06 CI-hardening commit
 *          (known-bug-match 3, ci-scripts 6, vitest-report-gate 2, playwright-summary 1, audit-gate 1,
 *          test-env-guard 1) = 1899; 1899 × 0.95 = 1804.05 → 1805.
 *   3292 — V2-03 phase close: the full suite at 570a82d (code at e4eb4c1) had 3465 tests in 162 files, 0 skipped;
 *          3465 × 0.95 = 3291.75 → 3292. REQUIRED_FILES gains every spec V2-03 added outside tests/e2e (60 files; 69 in total).
 *
 * Usage: node scripts/ci/assert-vitest-report.mjs <report.json> [--min-total <n>] [--require-files <a,b,…|none>]
 *   --require-files replaces REQUIRED_FILES (repo-relative paths); `none` disables the check (gate fixtures only).
 * Exit 0 = pass, 1 = gate failure, 2 = usage or unreadable report.
 */
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

const FLOOR = 3292;

/** Security and acceptance specs that must be present with at least one passed test (IR-F5; V2-03 phase close). */
const REQUIRED_FILES = [
  "tests/security/guard-actions.spec.ts",
  "tests/security/guard-routes.spec.ts",
  "tests/security/guard-canary.spec.ts",
  "tests/security/p0-01-action-sweep.spec.ts",
  "tests/security/p0-01-forged-overrides.spec.ts",
  "tests/security/cross-tenant-refs.spec.ts",
  "tests/security/multi-clinic-tenant-filters.spec.ts",
  "tests/security/share-tokens.spec.ts",
  "tests/security/membership-guard.spec.ts",
  // V2-03 (03-PLAN.md "Phase close" step 1 plus each plan record's close note).
  // 03-01 env schema and boot; readiness probe; synthetic-phone guard (M-SEEDPHONE); env example.
  "tests/config/env-schema.spec.ts",
  "tests/config/env-boot.spec.ts",
  "tests/api/readiness-probe-db.spec.ts",
  "tests/ci/env-example.spec.ts",
  "tests/utils/synthetic-phones.spec.ts",
  "tests/messaging/provider-selection.spec.ts",
  // 03-02 / 03-04 service-role factory and boundary gates.
  "tests/security/system-db.spec.ts",
  "tests/storage/no-service-role-fallback.spec.ts",
  "tests/referrals/referral-source-clinics.spec.ts",
  "tests/security/p1-34-lint-gates.spec.ts",
  // 03-03 generated types, migration immutability, drift.
  "tests/ci/migration-immutability.spec.ts",
  "tests/ci/local-drift.spec.ts",
  "tests/ci/schema-snapshot.spec.ts",
  "tests/ci/hosted-dump-diff.spec.ts",
  // 03-05 clinic-timezone dates.
  "tests/utils/datetime.spec.ts",
  "tests/integration/ist-boundaries.spec.ts",
  // 03-06 proxy session.
  "tests/api/proxy-session.spec.ts",
  // 03-07 D1 spike.
  "tests/billing/record-payment-rpc.spec.ts",
  "tests/db/error-map.spec.ts",
  // 03-08 staging workflows and scripts.
  "tests/ci/workflow-policy.spec.ts",
  "tests/ci/staging-scripts.spec.ts",
  "tests/integration/demo-clinic-seed.spec.ts",
  // 03-09a/b/c logger, request id, error sink, sweep.
  "tests/observability/logger.spec.ts",
  "tests/observability/request-id.spec.ts",
  "tests/observability/scrub.spec.ts",
  "tests/observability/error-sink-db.spec.ts",
  "tests/observability/on-request-error.spec.ts",
  "tests/observability/diag-route.spec.ts",
  "tests/observability/no-raw-error-logging.spec.ts",
  // 03-10 SSRF.
  "tests/api/webhook-ssrf.spec.ts",
  // 03-11a auth config as code and drift.
  "tests/ci/auth-policy.spec.ts",
  "tests/ci/auth-config-hosted.spec.ts",
  "tests/integration/auth/auth-config-applied.spec.ts",
  // 03-11b Send Email hook and SES.
  "tests/auth/send-email-hook.spec.ts",
  "tests/auth/ses-sender.spec.ts",
  "tests/integration/auth/mailpit-sender.spec.ts",
  // 03-12a FT-05 password flows.
  "tests/auth/pwned.spec.ts",
  "tests/auth/password-service.spec.ts",
  "tests/integration/auth/change-password.spec.ts",
  "tests/integration/auth/reset-completion.spec.ts",
  // 03-12b sign-out and public paths.
  "tests/auth/public-paths.spec.ts",
  "tests/auth/signout-route.spec.ts",
  // 03-12c Turnstile, safe next, AUTH-00 re-check kit.
  "tests/auth/safe-next.spec.ts",
  "tests/auth/password-flows-captcha.spec.ts",
  "tests/integration/auth/auth00-recheck-kit.spec.ts",
  "tests/ci/auth00-recheck-cli.spec.ts",
  "tests/ci/recheck-args.spec.ts",
  // 03-13a…e review fixes.
  "tests/auth/session-age.spec.ts",
  "tests/api/proxy-matcher.spec.ts",
  "tests/billing/payment-actor-guards.spec.ts",
  "tests/observability/error-sink-scrub-db.spec.ts",
  "tests/api/v1-system-client-order.spec.ts",
  "tests/billing/billing-error-messages.spec.ts",
  "tests/observability/console-scrub.spec.ts",
  "tests/observability/sink-flood.spec.ts",
  "tests/api/webhook-dispatch-hardening.spec.ts",
  "tests/messaging/provider-timeouts-and-synthetic.spec.ts",
  "tests/security/no-raw-error-responses.spec.ts",
  "tests/auth/session-age-token-hook-db.spec.ts",
  "tests/integration/auth/session-age-token-hook.spec.ts",
];

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
const reqIdx = process.argv.indexOf("--require-files");
const reqArg = reqIdx > -1 ? process.argv[reqIdx + 1] : undefined;
if (reqIdx > -1 && (reqArg === undefined || reqArg === "")) {
  console.error("vitest-report-gate: --require-files needs a comma-separated list or `none`");
  process.exit(2);
}
const required = reqArg === undefined ? REQUIRED_FILES : reqArg === "none" ? [] : reqArg.split(",").map((s) => s.trim());

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
for (const req of required) {
  const file = report.testResults.find((f) => f.name === req || (typeof f.name === "string" && f.name.endsWith(`/${req}`)));
  const passed = (file?.assertionResults ?? []).filter((t) => t.status === "passed").length;
  if (!file) problems.push(`required spec file missing: ${req}`);
  else if (passed === 0) problems.push(`required spec file has no passed test: ${req}`);
}

console.log(
  `vitest-report-gate: files=${counts.files} tests=${counts.total} passed=${counts.passed} failed=${counts.failed} ` +
    `skipped/todo=${counts.skipped} floor=${floor} required=${required.length}`,
);
if (problems.length) {
  const shown = problems.slice(0, 200);
  for (const p of shown) console.error(`FAIL ${p}`);
  if (problems.length > shown.length) console.error(`FAIL ... and ${problems.length - shown.length} more`);
  process.exit(1);
}
console.log("vitest-report-gate: PASS");
