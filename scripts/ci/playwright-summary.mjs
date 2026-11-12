#!/usr/bin/env node
/**
 * Playwright run summary (V2-02 plan 02-03a; TEST_STRATEGY §8 "report the retries").
 *
 * Reads Playwright's JSON report and prints a markdown summary: totals by outcome per project, every test that
 * needed a retry to pass (flaky) or failed, and (V2-02 02-06, IR-F4) every expected failure (`test.fail()`, a known
 * bug asserted as its correct outcome) with its annotation and the first line of the error it failed with, so a
 * reviewer sees it still fails for the known reason. Printed, and also appended to `$GITHUB_STEP_SUMMARY` when set.
 *
 * REPORT ONLY: Playwright's own exit code is the gate. This script exits 0 even when the report is missing or
 * unreadable (with a warning), so it can never mask or replace the real result.
 *
 * Usage: node scripts/ci/playwright-summary.mjs [playwright-report/results.json]
 */
import { appendFileSync, readFileSync } from "node:fs";

const file = process.argv[2] ?? "playwright-report/results.json";

function emit(markdown) {
  console.log(markdown);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
}

function* collectTests(suite, titles = []) {
  const here = suite.title ? [...titles, suite.title] : titles;
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) yield { title: [...here, spec.title].join(" › "), test };
  }
  for (const child of suite.suites ?? []) yield* collectTests(child, here);
}

let report;
try {
  report = JSON.parse(readFileSync(file, "utf8"));
} catch (error) {
  console.warn(`::warning title=Playwright summary::cannot read ${file}: ${error.message}`);
  process.exit(0);
}

const ANSI = /\u001b\[[0-9;]*m/g;
/** First non-empty line of the last attempt's first error. */
function firstErrorLine(test) {
  const last = (test.results ?? []).at(-1) ?? {};
  const message = last.errors?.[0]?.message ?? last.error?.message ?? "";
  return (message.replace(ANSI, "").split("\n").find((l) => l.trim() !== "") ?? "(no error recorded)").trim();
}

const byProject = new Map();
const retried = [];
const failed = [];
const expectedFailures = [];
for (const suite of report.suites ?? []) {
  for (const { title, test } of collectTests(suite)) {
    const project = test.projectName || "(default)";
    const counts = byProject.get(project) ?? { expected: 0, flaky: 0, unexpected: 0, skipped: 0 };
    counts[test.status] = (counts[test.status] ?? 0) + 1;
    byProject.set(project, counts);
    const attempts = (test.results ?? []).length;
    if (test.status === "flaky") retried.push(`- [${project}] ${title} (passed on attempt ${attempts})`);
    if (test.status === "unexpected") failed.push(`- [${project}] ${title}`);
    if (test.expectedStatus === "failed" && test.status === "expected") {
      const why = (test.annotations ?? []).find((a) => a.type === "fail")?.description ?? "";
      expectedFailures.push(`- [${project}] ${title}${why ? ` — ${why}` : ""}\n  - failed with: \`${firstErrorLine(test)}\``);
    }
  }
}

const lines = [
  "### Playwright run",
  "",
  "| project | passed | flaky (retried) | failed | skipped |",
  "|---|---|---|---|---|",
  ...[...byProject.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([p, c]) => `| ${p} | ${c.expected} | ${c.flaky} | ${c.unexpected} | ${c.skipped} |`),
  "",
  `**Retried to pass (flaky): ${retried.length}** — quarantine within 24 h behind an issue; never retry-to-green.`,
  ...retried,
];
if (failed.length) lines.push("", `**Failed: ${failed.length}**`, ...failed);
if (expectedFailures.length) {
  lines.push("", `**Expected failures (known bugs): ${expectedFailures.length}** — each must fail with its KNOWN-BUG assertion.`, ...expectedFailures);
}
emit(lines.join("\n"));
