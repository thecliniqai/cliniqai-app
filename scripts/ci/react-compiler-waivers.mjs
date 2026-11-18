#!/usr/bin/env node
/**
 * React Compiler rule waivers (V2-06 06-08, R-30; risk K-7). `eslint.config.mjs` sets `react-hooks/set-state-in-effect`,
 * `react-hooks/purity` and `react-hooks/immutability` to "error" and downgrades one rule for one file per entry of
 * `scripts/ci/react-compiler-waivers.json` to "warn" until the entry's `expires` date. This module checks the register:
 *
 *   - shape: `file` exists, `rule` is one of the three, `owner` names a phase (`V2-08`, `V2-09b`, …), a reason is given,
 *     no file/rule pair twice;
 *   - time box: `added` is not in the future, `expires` is on or after today and at most 90 days after `added`;
 *   - stale or miscounted: with the rule at "error", the file has exactly `sites` findings of it. Fewer means a site was
 *     fixed (lower `sites`, or drop the entry at 0); more means new code added a site (fix it, a waiver is not a
 *     licence for new findings).
 *
 * Usage: node scripts/ci/react-compiler-waivers.mjs   (exit 0 = register valid, 1 = problems listed)
 * tests/ci/react-compiler-waivers.spec.ts runs the same checks on the real register and on synthetic entries.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const RULES = ["set-state-in-effect", "purity", "immutability"];
export const MAX_DAYS = 90;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const REGISTER = path.join(ROOT, "scripts/ci/react-compiler-waivers.json");
const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function readRegister(file = REGISTER) {
  const { waivers } = JSON.parse(readFileSync(file, "utf8"));
  return waivers;
}

const dayNumber = (ymd) => Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10))) / 86_400_000;

/**
 * Problems with a waiver register. `counts` maps `${file}#${rule}` to the number of findings of that rule in that file
 * with the rule at "error"; `today` is a `YYYY-MM-DD` UTC date; `exists(file)` answers whether the file is in the tree.
 */
export function waiverProblems(waivers, { today, counts, exists }) {
  const problems = [];
  if (!Array.isArray(waivers)) return ["register: `waivers` must be an array"];
  const seen = new Set();
  for (const w of waivers) {
    const at = `${w?.file ?? "?"} (${w?.rule ?? "?"})`;
    if (typeof w?.file !== "string" || !exists(w.file)) problems.push(`${at}: file not found`);
    if (!RULES.includes(w?.rule)) problems.push(`${at}: rule must be one of ${RULES.join(", ")}`);
    if (typeof w?.owner !== "string" || !/^V2-\d{2}[a-z]?$/.test(w.owner)) problems.push(`${at}: owner must name a phase (V2-08, V2-09b, …)`);
    if (typeof w?.reason !== "string" || w.reason.trim().length < 20) problems.push(`${at}: a reason is required`);
    if (!Number.isInteger(w?.sites) || w.sites < 1) problems.push(`${at}: sites must be a positive integer`);
    const key = `${w?.file}#${w?.rule}`;
    if (seen.has(key)) problems.push(`${at}: listed twice`);
    seen.add(key);
    if (!YMD.test(w?.added ?? "") || !YMD.test(w?.expires ?? "")) {
      problems.push(`${at}: added and expires must be YYYY-MM-DD`);
      continue;
    }
    if (w.added > today) problems.push(`${at}: added ${w.added} is in the future`);
    if (w.expires < today) problems.push(`${at}: expired on ${w.expires} (fix the sites or renew with a new reason)`);
    if (dayNumber(w.expires) - dayNumber(w.added) > MAX_DAYS) {
      problems.push(`${at}: expires ${w.expires} is more than ${MAX_DAYS} days after ${w.added}`);
    }
    if (Number.isInteger(w.sites)) {
      const found = counts.get(key) ?? 0;
      if (found === 0) problems.push(`${at}: stale, no ${w.rule} finding left (drop the entry)`);
      else if (found < w.sites) problems.push(`${at}: ${found} finding(s), the entry says ${w.sites} (lower sites)`);
      else if (found > w.sites) problems.push(`${at}: ${found} finding(s), the entry allows ${w.sites} (fix the new site)`);
    }
  }
  return problems;
}

/** Findings of the three rules at "error" in `files` (repo-relative), as `${file}#${rule}` → count. */
export async function measure(files, { cwd = ROOT } = {}) {
  const { ESLint } = await import("eslint");
  const eslint = new ESLint({
    cwd,
    overrideConfig: [{ rules: Object.fromEntries(RULES.map((r) => [`react-hooks/${r}`, "error"])) }],
  });
  const counts = new Map();
  const results = await eslint.lintFiles(files.map((f) => path.join(cwd, f)));
  for (const result of results) {
    const file = path.relative(cwd, result.filePath).split(path.sep).join("/");
    for (const m of result.messages) {
      const rule = RULES.find((r) => m.ruleId === `react-hooks/${r}`);
      if (rule && m.severity === 2) counts.set(`${file}#${rule}`, (counts.get(`${file}#${rule}`) ?? 0) + 1);
    }
  }
  return counts;
}

export const todayUtc = () => new Date().toISOString().slice(0, 10);

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const waivers = readRegister();
  const files = [...new Set(waivers.map((w) => w.file).filter((f) => existsSync(path.join(ROOT, f))))];
  const counts = await measure(files);
  const problems = waiverProblems(waivers, { today: todayUtc(), counts, exists: (f) => existsSync(path.join(ROOT, f)) });
  const sites = waivers.reduce((n, w) => n + (Number.isInteger(w.sites) ? w.sites : 0), 0);
  console.log(`react-compiler-waivers: ${waivers.length} entr(ies) in ${files.length} file(s), ${sites} waived site(s)`);
  for (const p of problems) console.error(`FAIL ${p}`);
  if (problems.length) process.exit(1);
  console.log("react-compiler-waivers: PASS");
}
