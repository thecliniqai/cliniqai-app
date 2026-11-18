#!/usr/bin/env node
/**
 * UI policy (V2-06 plan 06-01a step 5; DESIGN_SYSTEM §10 guards). A CI policy check like ESLint rules: it reads tracked
 * source under app/, components/, features/ and lib/ with the TypeScript parser and runs every rule module found in
 * scripts/ci/ui-policy/rules/*.mjs. A rule exports `{ id, mode: "report" | "enforce", reason, check(file, sourceFile) }`
 * and returns findings `{ line, detail }`; later plans add or flip a rule by touching only its own file.
 *
 * Report-mode rules print counts and their delta against scripts/ci/ui-policy-baseline.json and never fail. Enforced
 * rules fail on any finding (printed as `FAIL <rule> <file>:<line> <detail>`). The AI-06 L1 checks stay in
 * scripts/ci/ai-l1-greps.mjs and stay blocking.
 *
 * Usage: node scripts/ci/ui-policy.mjs [--root <dir>] [--rules <dir>] [--baseline <file>] [--json <file>]
 *          [--summary <file>] [--write-baseline]
 *   --root      scan a directory tree instead of `git ls-files` (fixtures in lint-fixtures/ui-policy/)
 *   --json      write every finding (rule, file, line, detail) and the per-rule counts
 *   --summary   append the markdown table to this file (CI: $GITHUB_STEP_SUMMARY)
 *   --write-baseline  write the current per-rule counts to the baseline file
 * Exit 0 = no enforced finding, 1 = an enforced rule found something, 2 = usage error.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SCOPE = /^(app|components|features|lib)\/.*\.(ts|tsx|js|jsx|mjs)$/;
const MODES = new Set(["report", "enforce"]);

function usage(message) {
  console.error(`ui-policy: ${message}`);
  process.exit(2);
}

function arg(name) {
  const i = process.argv.indexOf(name);
  if (i === -1) return undefined;
  const v = process.argv[i + 1];
  if (!v || v.startsWith("--")) usage(`${name} needs a value`);
  return v;
}

function listFiles(root, useGit) {
  if (useGit) {
    return execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
      .split("\0")
      .filter(Boolean);
  }
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(relative(root, full).split(sep).join("/"));
    }
  };
  walk(root);
  return out.sort();
}

async function loadRules(dir) {
  if (!existsSync(dir)) usage(`rules directory ${dir} does not exist`);
  const rules = [];
  for (const name of readdirSync(dir).filter((n) => n.endsWith(".mjs")).sort()) {
    const rule = (await import(pathToFileURL(join(dir, name)).href)).default;
    if (!rule || typeof rule.id !== "string" || !MODES.has(rule.mode) || typeof rule.check !== "function") {
      usage(`${name}: a rule exports default { id, mode: "report"|"enforce", reason, check(file, sourceFile) }`);
    }
    if (rules.some((r) => r.id === rule.id)) usage(`duplicate rule id ${rule.id}`);
    rules.push(rule);
  }
  if (rules.length === 0) usage(`no rules in ${dir}`);
  return rules;
}

function kindOf(file) {
  if (file.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (file.endsWith(".ts")) return ts.ScriptKind.TS;
  if (file.endsWith(".jsx")) return ts.ScriptKind.JSX;
  return ts.ScriptKind.JS;
}

async function main() {
  const rootArg = arg("--root");
  const root = rootArg ? resolve(rootArg) : REPO;
  const rulesDir = resolve(arg("--rules") ?? join(REPO, "scripts/ci/ui-policy/rules"));
  const baselineFile = resolve(arg("--baseline") ?? join(REPO, "scripts/ci/ui-policy-baseline.json"));
  const jsonFile = arg("--json");
  const summaryFile = arg("--summary");
  const rules = await loadRules(rulesDir);

  const files = listFiles(root, !rootArg).filter((f) => SCOPE.test(f));
  const findings = [];
  for (const file of files) {
    const full = join(root, file);
    if (!existsSync(full) || !statSync(full).isFile()) continue;
    const sourceFile = ts.createSourceFile(file, readFileSync(full, "utf8"), ts.ScriptTarget.Latest, true, kindOf(file));
    for (const rule of rules) {
      for (const f of rule.check(file, sourceFile) ?? []) findings.push({ rule: rule.id, file, line: f.line, detail: f.detail });
    }
  }

  const baseline = existsSync(baselineFile) ? JSON.parse(readFileSync(baselineFile, "utf8")).counts ?? {} : {};
  const rows = rules.map((r) => {
    const hits = findings.filter((f) => f.rule === r.id);
    const files = new Set(hits.map((h) => h.file)).size;
    const base = baseline[r.id];
    return { id: r.id, mode: r.mode, count: hits.length, files, baseline: base ?? null, delta: base === undefined ? null : hits.length - base };
  });

  const enforced = findings.filter((f) => rules.find((r) => r.id === f.rule).mode === "enforce");
  for (const f of enforced) console.error(`FAIL ${f.rule} ${f.file}:${f.line} ${f.detail}`);
  for (const r of rows) {
    const delta = r.delta === null ? "no baseline" : `baseline ${r.baseline}, delta ${r.delta > 0 ? "+" : ""}${r.delta}`;
    console.log(`ui-policy: ${r.id} [${r.mode}] ${r.count} finding(s) in ${r.files} file(s) (${delta})`);
  }
  console.log(enforced.length ? `ui-policy: FAIL (${enforced.length} enforced finding(s))` : "ui-policy: PASS (report-mode findings do not fail)");

  if (jsonFile) {
    mkdirSync(dirname(resolve(jsonFile)), { recursive: true });
    const report = { generatedBy: "scripts/ci/ui-policy.mjs", files: files.length, rules: rows, findings };
    writeFileSync(jsonFile, `${JSON.stringify(report, null, 2)}\n`);
  }
  if (summaryFile) {
    const table = [
      "### UI policy (DESIGN_SYSTEM §10)",
      "",
      "| Rule | Mode | Findings | Files | Baseline | Delta |",
      "|---|---|---:|---:|---:|---:|",
      ...rows.map((r) => `| ${r.id} | ${r.mode} | ${r.count} | ${r.files} | ${r.baseline ?? "—"} | ${r.delta ?? "—"} |`),
      "",
    ].join("\n");
    appendFileSync(summaryFile, `${table}\n`);
  }
  if (process.argv.includes("--write-baseline")) {
    const counts = Object.fromEntries(rows.map((r) => [r.id, r.count]));
    writeFileSync(baselineFile, `${JSON.stringify({ $comment: "Per-rule finding counts; regenerate with `node scripts/ci/ui-policy.mjs --write-baseline`.", counts }, null, 2)}\n`);
    console.log(`ui-policy: baseline written to ${relative(REPO, baselineFile)}`);
  }
  return enforced.length ? 1 : 0;
}

process.exitCode = await main();
