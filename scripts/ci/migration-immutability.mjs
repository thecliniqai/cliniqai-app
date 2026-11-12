#!/usr/bin/env node
/**
 * Migration immutability gate (V2-03 plan 03-03; BACKEND_MIGRATION_PLAN B2, roadmap P1-34, ruling R-4).
 *
 * An applied migration is never edited: schema changes land as new files (expand -> migrate -> contract). Compared
 * with the merge base of `--base` (CI: the PR's base branch), the gate fails when
 *   - a migration that exists on the base is modified, deleted, renamed, copied or changes type (any status but A);
 *   - a new migration is not named `NNNNNN_snake_case.sql` (zero-padded sequence, R-4; this also catches the CLI's
 *     timestamped `db diff -f` output);
 *   - a new migration's number is not above the highest number on the base;
 *   - two migrations share a number.
 * The comparison runs against the working tree (tracked changes and untracked files under the directory), so an
 * uncommitted local edit fails too; a CI checkout is clean, so there it equals `<base>...HEAD`.
 *
 * Reads only git metadata and file names. Usage:
 *   node scripts/ci/migration-immutability.mjs --base <ref> [--root <repo>] [--dir supabase/migrations]
 * Exit 0 = pass, 1 = violation, 2 = usage or git error (for example a shallow clone without the base).
 */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const base = arg("--base");
const root = resolve(arg("--root", "."));
const dir = arg("--dir", "supabase/migrations").replace(/\/+$/, "");

if (!base) {
  console.error("usage: migration-immutability.mjs --base <ref> [--root <repo>] [--dir supabase/migrations]");
  process.exit(2);
}

const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

let mergeBase;
try {
  mergeBase = git("merge-base", base, "HEAD").trim();
} catch {
  console.error(`migration-immutability: cannot resolve the merge base of '${base}' and HEAD (shallow clone? fetch the base)`);
  process.exit(2);
}

const NAME = /^(\d{6})_[a-z0-9_]+\.sql$/;
const fileName = (p) => p.slice(p.lastIndexOf("/") + 1);
const numberOf = (p) => {
  const m = /^(\d+)_/.exec(fileName(p));
  return m ? Number(m[1]) : null;
};
const lines = (out) => out.split("\n").filter(Boolean);

const baseFiles = lines(git("ls-tree", "-r", "--name-only", mergeBase, "--", `${dir}/`));
const baseNumbers = baseFiles.map(numberOf).filter((n) => n !== null);
const highest = baseNumbers.length ? Math.max(...baseNumbers) : 0;

// Tracked changes: merge base vs the working tree (renames detected so they are named, not seen as delete + add).
const changes = lines(git("diff", "--name-status", "--find-renames", mergeBase, "--", `${dir}/`)).map((l) => {
  const [status, ...paths] = l.split("\t");
  return { status, paths };
});
for (const p of lines(git("ls-files", "--others", "--exclude-standard", "--", `${dir}/`))) {
  changes.push({ status: "A", paths: [p] });
}

const problems = [];
const added = [];
for (const { status, paths } of changes) {
  if (status === "A") {
    added.push(paths[0]);
    continue;
  }
  const what = { M: "modified", D: "deleted", T: "type changed" }[status[0]];
  if (status[0] === "R") problems.push(`applied migration renamed (${status}): ${paths[0]} -> ${paths[1]}`);
  else if (status[0] === "C") problems.push(`applied migration copied (${status}): ${paths[0]} -> ${paths[1]}`);
  else problems.push(`applied migration ${what ?? "changed"} (${status}): ${paths[0]}`);
}

for (const p of added) {
  const n = numberOf(p);
  if (!NAME.test(fileName(p))) {
    problems.push(`new migration ${p} is not named NNNNNN_snake_case.sql (zero-padded sequence, R-4)`);
  } else if (n <= highest) {
    problems.push(`new migration ${p} has number ${n}, not above the highest on the base (${highest})`);
  }
}

// Duplicate numbers across the resulting directory: base files still present, plus added, renamed-to and copied-to.
const gone = new Set(changes.filter((c) => c.status[0] === "D" || c.status[0] === "R").map((c) => c.paths[0]));
const arrived = changes.filter((c) => c.status === "A" || c.paths.length > 1).map((c) => c.paths.at(-1));
const byNumber = new Map();
for (const p of [...baseFiles.filter((f) => !gone.has(f)), ...arrived]) {
  const n = numberOf(p);
  if (n === null) continue;
  byNumber.set(n, [...(byNumber.get(n) ?? []), p]);
}
for (const [n, files] of byNumber) {
  if (files.length > 1) problems.push(`migration number ${n} is used by ${files.length} files: ${files.sort().join(", ")}`);
}

if (problems.length) {
  for (const p of problems) console.error(`FAIL ${p}`);
  console.error("Applied migrations are immutable: add a new, higher-numbered migration instead (CLAUDE.md, R-4).");
  process.exit(1);
}
console.log(
  `migration-immutability: PASS (base ${base} @ ${mergeBase.slice(0, 7)}; ${baseFiles.length} applied unchanged; ` +
    `${added.length} new above ${highest})`,
);
