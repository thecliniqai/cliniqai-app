#!/usr/bin/env node
/**
 * P0-13 CI canary (V2-02 plan 02-02 step 5): proves, on every PR, that adding an unguarded server action makes the
 * guard test fail.
 *
 * Copies lint-fixtures/p0-13/unguarded-action.ts to features/__guard_canary__/actions.ts, runs
 * tests/security/guard-actions.spec.ts, and passes only when that run FAILS and its output names the canary module.
 * The copy is always deleted. Needs the local Supabase stack (same as the `test` job's Vitest step); reads no env file
 * itself (vitest.config.ts loads the local-stack test env and refuses anything non-local).
 *
 * Usage: node scripts/ci/guard-canary.mjs
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const FIXTURE = path.join(ROOT, "lint-fixtures/p0-13/unguarded-action.ts");
const CANARY_DIR = path.join(ROOT, "features/__guard_canary__");
const CANARY_FILE = "features/__guard_canary__/actions.ts";
const CANARY_KEY = `${CANARY_FILE}#listCanaryPatients`;
const SPEC = "tests/security/guard-actions.spec.ts";

if (fs.existsSync(CANARY_DIR)) {
  console.error(`guard-canary: ${path.relative(ROOT, CANARY_DIR)} already exists; refusing to overwrite it`);
  process.exit(2);
}

let result;
fs.mkdirSync(CANARY_DIR);
try {
  fs.copyFileSync(FIXTURE, path.join(ROOT, CANARY_FILE));
  result = spawnSync(path.join(ROOT, "node_modules/.bin/vitest"), ["run", SPEC, "--reporter=verbose"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
} finally {
  fs.rmSync(CANARY_DIR, { recursive: true, force: true });
}

if (result.error) {
  console.error(`guard-canary: could not run vitest: ${result.error.message}`);
  process.exit(2);
}

const output = `${result.stdout}\n${result.stderr}`;
const failures = [];
if (result.status === 0) failures.push(`${SPEC} PASSED with an unguarded action in ${CANARY_FILE}`);
if (!output.includes(CANARY_KEY)) failures.push(`the ${SPEC} output does not name ${CANARY_KEY}`);
if (!output.includes("actions with no entry in tests/security/guard-manifest.ts")) {
  failures.push("the completeness check did not report the missing manifest entry");
}

// The lines that name the canary, for the CI log.
for (const line of output.split("\n").filter((l) => l.includes("__guard_canary__")).slice(0, 40)) {
  console.log(`  ${line.trim()}`);
}

if (failures.length > 0) {
  for (const f of failures) console.error(`guard-canary: FAIL ${f}`);
  process.exit(1);
}
console.log(`guard-canary: PASS (${SPEC} exited ${result.status} and named ${CANARY_KEY})`);
