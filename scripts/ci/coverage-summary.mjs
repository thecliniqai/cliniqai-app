#!/usr/bin/env node
/**
 * Coverage summary, report-only (V2-02 plan 02-05; P1-41 V2-02 part; TEST_STRATEGY §9.5 item 5).
 *
 * Reads Vitest's v8 `json-summary` output (`coverage/coverage-summary.json`) and prints a markdown report: overall
 * totals plus one row per domain module against the G2 targets (80% lines / 70% branches). The report is appended
 * to `$GITHUB_STEP_SUMMARY` when that variable is set, otherwise printed to stdout.
 *
 * REPORT ONLY until V2-14: this script never fails the job on coverage numbers. It exits 0 when the summary file is
 * missing or unreadable too (with a warning), so a coverage problem can never mask or replace the real test result.
 *
 * Usage: node scripts/ci/coverage-summary.mjs [coverage/coverage-summary.json]
 */
import { appendFileSync, readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

const TARGET_LINES = 80;
const TARGET_BRANCHES = 70;

// TEST_STRATEGY §9.5 domain modules (billing, scheduling, queue, prescriptions, permissions). Directory prefixes,
// relative to the repo root, POSIX separators.
const DOMAINS = [
  { name: "billing", dirs: ["features/billing/"] },
  { name: "scheduling (appointments, waitlist)", dirs: ["features/appointments/", "features/waitlist/"] },
  { name: "queue", dirs: ["features/queue/"] },
  { name: "prescriptions", dirs: ["features/prescriptions/"] },
  { name: "permissions", dirs: ["lib/permissions/"] },
];

const METRICS = ["lines", "branches", "functions", "statements"];

const file = resolve(process.argv[2] ?? "coverage/coverage-summary.json");
const root = process.cwd();

function emit(markdown) {
  const out = process.env.GITHUB_STEP_SUMMARY;
  if (out) appendFileSync(out, markdown + "\n");
  else process.stdout.write(markdown + "\n");
}

let summary;
try {
  summary = JSON.parse(readFileSync(file, "utf8"));
} catch (err) {
  console.warn(`::warning title=coverage summary missing::${relative(root, file)} not readable (${err.code ?? err.message})`);
  emit("## Coverage (report only until V2-14)\n\nNo coverage summary was produced by this run.");
  process.exit(0);
}

const empty = () => Object.fromEntries(METRICS.map((m) => [m, { total: 0, covered: 0 }]));
const add = (acc, entry) => {
  for (const m of METRICS) {
    acc[m].total += entry[m]?.total ?? 0;
    acc[m].covered += entry[m]?.covered ?? 0;
  }
};
const pct = ({ total, covered }) => (total === 0 ? null : (covered / total) * 100);
const fmt = (p) => (p === null ? "n/a" : `${p.toFixed(1)}%`);
const mark = (p, target) => (p === null ? "n/a" : p >= target ? "meets" : "below");

const domains = DOMAINS.map((d) => ({ ...d, acc: empty(), files: 0 }));
for (const [key, entry] of Object.entries(summary)) {
  if (key === "total") continue;
  const rel = relative(root, resolve(key)).split(sep).join("/");
  for (const d of domains) {
    if (d.dirs.some((dir) => rel.startsWith(dir))) {
      add(d.acc, entry);
      d.files += 1;
    }
  }
}

const total = summary.total ?? {};
const lines = [
  "## Coverage (report only until V2-14)",
  "",
  `Targets (G2, enforced from V2-14): ${TARGET_LINES}% lines / ${TARGET_BRANCHES}% branches on the domain modules. ` +
    "This job never fails on coverage.",
  "",
  "| Scope | Files | Lines | Branches | Functions | Statements | G2 lines | G2 branches |",
  "|---|---:|---:|---:|---:|---:|---|---|",
  `| **All (app, features, lib, components)** | ${Object.keys(summary).length - 1} | ${fmt(total.lines?.pct ?? null)} | ` +
    `${fmt(total.branches?.pct ?? null)} | ${fmt(total.functions?.pct ?? null)} | ${fmt(total.statements?.pct ?? null)} | — | — |`,
];
for (const d of domains) {
  const p = Object.fromEntries(METRICS.map((m) => [m, pct(d.acc[m])]));
  lines.push(
    `| ${d.name} (\`${d.dirs.join("`, `")}\`) | ${d.files} | ${fmt(p.lines)} | ${fmt(p.branches)} | ${fmt(p.functions)} | ` +
      `${fmt(p.statements)} | ${mark(p.lines, TARGET_LINES)} | ${mark(p.branches, TARGET_BRANCHES)} |`,
  );
}
lines.push(
  "",
  "`components/` is mostly exercised by the Playwright e2e lane, not Vitest, so its low figure pulls the overall total down.",
  "",
  "Full HTML report: the `coverage` artifact of this run.",
);
emit(lines.join("\n"));
