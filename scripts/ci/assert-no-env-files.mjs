#!/usr/bin/env node
/**
 * Env-file gate (V2-02 plan 02-01, `static` job; P0-10 / CLAUDE.md "never read .env*").
 *
 * Fails when
 *   - git tracks any `.env*` file other than the root template `.env.example` and the committed local-stack test
 *     defaults `.env.test` (TEST_STRATEGY T-01), or
 *   - any other `.env*` file exists in the working tree (CI checkouts have none by construction; a step that wrote one
 *     would let Next.js or a script load it).
 * Only file NAMES are inspected; no file content is ever read. node_modules/ and .git/ are skipped.
 *
 * Intended for CI. On a developer machine the untracked local `.env` makes it fail by design.
 * Usage: node scripts/ci/assert-no-env-files.mjs [--root <dir>]
 * Exit 0 = pass, 1 = env file found.
 */
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

const ALLOWED = new Set([".env.example", ".env.test"]);
const i = process.argv.indexOf("--root");
const root = resolve(i > -1 ? process.argv[i + 1] : ".");
const isEnvName = (name) => name === ".env" || name.startsWith(".env.");

let tracked = [];
try {
  tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .split("\0")
    .filter(Boolean);
} catch {
  // not a git checkout: only the working-tree walk applies
}

const problems = [];
for (const file of tracked) {
  const base = file.split("/").pop();
  if (isEnvName(base) && !ALLOWED.has(file)) problems.push(`tracked env file: ${file}`);
}

const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (isEnvName(entry.name)) {
      const rel = relative(root, full).split(sep).join("/");
      if (!ALLOWED.has(rel)) problems.push(`env file in working tree: ${rel}`);
    }
  }
};
walk(root);

if (problems.length) {
  for (const p of [...new Set(problems)]) console.error(`FAIL ${p}`);
  process.exit(1);
}
console.log("env-files: PASS (only the template and the local-stack test defaults are present)");
