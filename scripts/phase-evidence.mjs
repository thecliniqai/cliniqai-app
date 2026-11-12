#!/usr/bin/env node
/**
 * Generates tool-produced gate evidence for a phase (CLAUDE.md DoD 5: evidence is produced by tools, never
 * hand-typed). Runs on the LOCAL stack only: Vitest's own loopback guard refuses any non-local Supabase URL.
 *
 * Usage: node scripts/phase-evidence.mjs <evidence-dir> [runs=2]
 * Writes: commit.txt, full-run-<n>.json (Vitest JSON reporter), summary.json (per-run counts + per-file status +
 * teardown line), static-checks.json (typecheck, eslint, acceptance greps, inventory, dependency versions).
 * Prints nothing sensitive: no env values, no test data.
 */
import { execSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const dir = resolve(process.argv[2] ?? "");
if (!process.argv[2]) {
  console.error("usage: node scripts/phase-evidence.mjs <evidence-dir> [runs]");
  process.exit(2);
}
const runs = Number(process.argv[3] ?? 2);
mkdirSync(dir, { recursive: true });

const sh = (cmd) => execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const status = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  return { command: [cmd, ...args].join(" "), exit_code: r.status };
};

const commit = sh("git rev-parse HEAD");
const dirty = sh("git status --porcelain -- . ':!.planning'").length > 0;
writeFileSync(join(dir, "commit.txt"), `${commit}${dirty ? " (working tree has uncommitted changes)" : ""}\n`);

const summary = { commit, dirty_worktree: dirty, generated_at: new Date().toISOString(), runs: [] };
for (let n = 1; n <= runs; n++) {
  const out = join(dir, `full-run-${n}.json`);
  const r = spawnSync("npx", ["vitest", "run", "--reporter=json", `--outputFile=${out}`, "--reporter=dot"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const json = JSON.parse(readFileSync(out, "utf8"));
  const teardown = `${r.stdout}\n${r.stderr}`.split("\n").filter((l) => l.startsWith("[teardown]"));
  summary.runs.push({
    run: n,
    exit_code: r.status,
    success: json.success,
    files: json.numTotalTestSuites !== undefined ? json.testResults.length : undefined,
    files_failed: json.testResults.filter((f) => f.status !== "passed").length,
    tests_total: json.numTotalTests,
    tests_passed: json.numPassedTests,
    tests_failed: json.numFailedTests,
    tests_skipped: json.numPendingTests + (json.numTodoTests ?? 0),
    teardown,
    per_file: Object.fromEntries(
      json.testResults.map((f) => [f.name.replace(`${process.cwd()}/`, ""), f.status]),
    ),
  });
}
writeFileSync(join(dir, "summary.json"), `${JSON.stringify(summary, null, 1)}\n`);

const grepCount = (pattern, paths) => {
  const r = spawnSync("grep", ["-rnE", pattern, ...paths], { encoding: "utf8" });
  return r.stdout.split("\n").filter(Boolean).length;
};
const inventory = spawnSync("npx", ["tsx", "scripts/inventory-server-actions.ts"], { encoding: "utf8" });
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const installedNext = JSON.parse(readFileSync("node_modules/next/package.json", "utf8")).version;

const checks = {
  commit,
  typecheck: status("npm", ["run", "typecheck"]),
  eslint: status("npx", ["eslint", ".", "--quiet"]),
  grep_auth01_banned_otp_terms_in_app_code: grepCount("shouldCreateUser|devOtp", [
    "app",
    "features",
    "lib",
    "components",
    "tests",
  ]),
  grep_override_params_in_app_code: grepCount("[A-Za-z]+Override[,:)? ]|actorSession", ["features", "lib", "app"]),
  inventory: { exit_code: inventory.status, tail: inventory.stdout.trim().split("\n").slice(-6) },
  dependencies: { next_declared: pkg.dependencies?.next, next_installed: installedNext },
};
writeFileSync(join(dir, "static-checks.json"), `${JSON.stringify(checks, null, 1)}\n`);

for (const r of summary.runs) {
  console.log(
    `run ${r.run}: success=${r.success} files=${r.files} failed_files=${r.files_failed} tests=${r.tests_passed}/${r.tests_total} skipped=${r.tests_skipped}`,
  );
}
console.log(`typecheck exit=${checks.typecheck.exit_code} eslint exit=${checks.eslint.exit_code} inventory exit=${checks.inventory.exit_code}`);
