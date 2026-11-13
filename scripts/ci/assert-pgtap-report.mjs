#!/usr/bin/env node
/**
 * pgTAP report gate (V2-05 plan 05-01a; roadmap V2-05 evidence "CI pgTAP report", acceptance 1 "… and passes").
 * Same shape as scripts/ci/assert-vitest-report.mjs.
 *
 * Reads the report written by `npm run test:pgtap -- <report.tap>` (scripts/test-pgtap.mjs: the stdout of
 * `supabase test db --local --debug`, i.e. pg_prove --verbose: a `<file> ..` header per file, its TAP stream, then the
 * harness summary) and fails when
 *   - any test is `not ok` (named with its file and description);
 *   - any test carries a `# SKIP` or `# TODO` directive, or a file plans `1..0` (a skipped file): the lane runs everything;
 *   - pg_prove reports a parse error ("No plan found", "Bad plan", …), a dubious exit, or `Result:` is not PASS / absent;
 *   - a file has no plan, or did not run exactly its planned tests in order 1..N (a test that died mid-file);
 *   - the per-file counts disagree with the harness summary `Files=…, Tests=…` (truncated or hand-edited report);
 *   - the total is below the floor (a silently shrinking suite);
 *   - a REQUIRED_FILES entry is missing or has no passed test.
 *
 * FLOOR rule: as the Vitest gate, at least the measured total at each part close (later plans raise it with the
 * arithmetic in the same commit).
 * FLOOR history:
 *   13 — V2-05 05-01a: the two converted legacy files (memberships_bounds_cleanup 7, search_medicines_extension_schema 6).
 * REQUIRED_FILES: the converted legacy files (05-01a); later plans append theirs at each part close.
 *
 * Usage: node scripts/ci/assert-pgtap-report.mjs <report.tap> [--min-total <n>] [--require-files <a,b,…|none>]
 *   --require-files replaces REQUIRED_FILES (repo-relative paths); `none` disables the check (gate fixtures only).
 * Exit 0 = pass, 1 = gate failure, 2 = usage or unreadable report.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const FLOOR = 13;

export const REQUIRED_FILES = [
  "supabase/tests/database/memberships_bounds_cleanup.test.sql",
  "supabase/tests/database/search_medicines_extension_schema.test.sql",
];

/** `/abs/path/supabase/tests/database/x.test.sql ..` (pg_prove prints the dots as one run, then a space). */
const FILE_HEADER = /^(\S+\.(?:sql|pg))\s+\.{2,}\s*(?:ok)?\s*$/;
const PLAN = /^1\.\.(\d+)(?:\s*#\s*(.*))?$/;
/** `ok 3 - description # SKIP reason` (pgTAP escapes a `#` inside a description as `\#`). */
const TEST = /^(not )?ok (\d+)\b(.*)$/;
const SUMMARY = /^Files=(\d+),\s*Tests=(\d+)/;
const RESULT = /^Result:\s*(\S+)/;

/** Repo-relative path (`supabase/tests/…`) whatever the checkout directory was. */
export function shortName(file) {
  const i = file.indexOf("supabase/tests/");
  return i > -1 ? file.slice(i) : file;
}

/**
 * @param {string} text the report
 * @param {{ floor?: number, required?: string[] }} [opts]
 * @returns {{ problems: string[], counts: { files: number, total: number, passed: number, failed: number, skipped: number },
 *   files: Array<{ name: string, planned: number | null, ran: number, passed: number }> }}
 */
export function checkPgTapReport(text, { floor = FLOOR, required = REQUIRED_FILES } = {}) {
  const problems = [];
  const files = [];
  let current = null;
  let summary = null;
  let result = null;
  let inSummaryReport = false;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const header = FILE_HEADER.exec(line);
    if (header && !inSummaryReport) {
      current = { name: shortName(header[1]), planned: null, skipAll: false, ran: 0, passed: 0, numbers: [] };
      files.push(current);
      continue;
    }
    if (/^Test Summary Report/.test(line) || /^All tests successful/.test(line)) {
      inSummaryReport = true;
      current = null;
      continue;
    }
    const s = SUMMARY.exec(line);
    if (s) {
      summary = { files: Number(s[1]), tests: Number(s[2]) };
      current = null;
      continue;
    }
    const r = RESULT.exec(line);
    if (r) {
      result = r[1];
      continue;
    }
    if (/Parse errors?:/i.test(line)) problems.push(`pg_prove parse error: ${line.trim()}`);
    if (/^Dubious, test returned/.test(line.trim())) problems.push(`pg_prove: ${line.trim()} (${current?.name ?? "unknown file"})`);
    if (!current) continue;

    const p = PLAN.exec(line);
    if (p) {
      current.planned = Number(p[1]);
      if (current.planned === 0 || /^skip/i.test(p[2] ?? "")) {
        current.skipAll = true;
        problems.push(`file skipped (1..0 / SKIP plan; 0 skipped allowed): ${current.name}`);
      }
      continue;
    }
    const t = TEST.exec(line);
    if (t) {
      const notOk = Boolean(t[1]);
      const num = Number(t[2]);
      const hash = t[3].search(/(?<!\\)#/);
      const desc = (hash > -1 ? t[3].slice(0, hash) : t[3]).replace(/^\s*-?\s*/, "").trim() || "(no description)";
      const directive = hash > -1 ? t[3].slice(hash + 1).trim() : "";
      current.ran += 1;
      current.numbers.push(num);
      if (/^skip\b/i.test(directive)) {
        problems.push(`test skipped (0 skipped allowed): ${current.name} > ${num} - ${desc} (# ${directive})`);
      } else if (/^todo\b/i.test(directive)) {
        problems.push(`test todo (0 todo allowed): ${current.name} > ${num} - ${desc}`);
      } else if (notOk) {
        problems.push(`test failed: ${current.name} > ${num} - ${desc}`);
      } else {
        current.passed += 1;
      }
    }
  }

  const counts = { files: files.length, total: 0, passed: 0, failed: 0, skipped: 0 };
  for (const f of files) {
    counts.total += f.ran;
    counts.passed += f.passed;
    if (f.planned === null) problems.push(`no plan found: ${f.name}`);
    else if (!f.skipAll && f.ran !== f.planned) problems.push(`planned ${f.planned} tests but ran ${f.ran}: ${f.name}`);
    if (f.numbers.some((n, i) => n !== i + 1)) problems.push(`test numbers are not 1..${f.ran} in order: ${f.name}`);
  }
  counts.failed = problems.filter((p) => p.startsWith("test failed")).length;
  counts.skipped = problems.filter((p) => p.startsWith("test skipped") || p.startsWith("test todo")).length;

  if (files.length === 0) problems.push("no pgTAP file in the report (did `supabase test db` run?)");
  if (result === null) problems.push("no `Result:` line (report truncated?)");
  else if (result !== "PASS") problems.push(`Result: ${result}`);
  if (summary === null) problems.push("no `Files=…, Tests=…` summary line (report truncated?)");
  else {
    if (summary.files !== files.length) problems.push(`summary Files=${summary.files} but the report has ${files.length} files`);
    if (summary.tests !== counts.total) problems.push(`summary Tests=${summary.tests} but the report has ${counts.total} test lines`);
  }
  if (counts.total < floor) problems.push(`total ${counts.total} is below the floor ${floor} (suite shrank?)`);
  for (const req of required) {
    const f = files.find((x) => x.name === req || x.name.endsWith(`/${req}`));
    if (!f) problems.push(`required pgTAP file missing: ${req}`);
    else if (f.passed === 0) problems.push(`required pgTAP file has no passed test: ${req}`);
  }
  return { problems, counts, files: files.map(({ name, planned, ran, passed }) => ({ name, planned, ran, passed })) };
}

function main(argv) {
  const file = argv[0];
  if (!file || file.startsWith("--")) {
    console.error("usage: node scripts/ci/assert-pgtap-report.mjs <report.tap> [--min-total <n>] [--require-files <a,b|none>]");
    return 2;
  }
  const minIdx = argv.indexOf("--min-total");
  const floor = minIdx > -1 ? Number(argv[minIdx + 1]) : FLOOR;
  if (!Number.isInteger(floor) || floor < 0) {
    console.error("pgtap-report-gate: --min-total must be a non-negative integer");
    return 2;
  }
  const reqIdx = argv.indexOf("--require-files");
  const reqArg = reqIdx > -1 ? argv[reqIdx + 1] : undefined;
  if (reqIdx > -1 && (reqArg === undefined || reqArg === "")) {
    console.error("pgtap-report-gate: --require-files needs a comma-separated list or `none`");
    return 2;
  }
  const required =
    reqArg === undefined ? REQUIRED_FILES : reqArg === "none" ? [] : reqArg.split(",").map((s) => s.trim()).filter(Boolean);

  let text;
  try {
    text = readFileSync(resolve(file), "utf8");
  } catch {
    console.error(`pgtap-report-gate: cannot read a report at ${file}`);
    return 2;
  }
  const { problems, counts } = checkPgTapReport(text, { floor, required });
  console.log(
    `pgtap-report-gate: files=${counts.files} tests=${counts.total} passed=${counts.passed} failed=${counts.failed} ` +
      `skipped/todo=${counts.skipped} floor=${floor} required=${required.length}`,
  );
  if (problems.length) {
    const shown = problems.slice(0, 200);
    for (const p of shown) console.error(`FAIL ${p}`);
    if (problems.length > shown.length) console.error(`FAIL ... and ${problems.length - shown.length} more`);
    return 1;
  }
  console.log("pgtap-report-gate: PASS");
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exit(main(process.argv.slice(2)));
}
