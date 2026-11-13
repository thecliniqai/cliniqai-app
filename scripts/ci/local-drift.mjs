#!/usr/bin/env node
/**
 * Local schema drift gate (V2-03 plan 03-03; BACKEND_MIGRATION_PLAN B1 local half, roadmap P1-34).
 *
 * Runs `supabase db diff --local` (migra engine): the CLI builds a shadow database from `supabase/migrations` and
 * prints the SQL that would turn it into the running local database. After a fresh `db reset` that must be empty,
 * apart from one documented exception. In CI this proves the migrations are deterministic (it compares them with
 * themselves); the "fresh reset matches the target schema" half, including privileges, is
 * `scripts/drift/schema-snapshot.mjs --local --check` against the committed snapshot (03-13b M-DRIFT).
 *
 *   drop extension if exists "pg_net";
 *     CLI 2.120.0 shadow-DB false positive (03-RESEARCH §03-03): the shadow image enables pg_net, the migrated
 *     database does not (no migration creates it). Not drift; allowlisted verbatim, nothing else is.
 *
 * Any other statement fails the gate and is printed. The diff goes to stdout only: never `db diff -f`, which writes a
 * migration file (`-f /dev/null` creates `supabase/migrations/<ts>_/dev/null.sql`, research pitfall 1).
 *
 * Usage:
 *   node scripts/ci/local-drift.mjs [--out <dir>]          diff the running local stack
 *   node scripts/ci/local-drift.mjs --input <file> [...]   check a saved CLI output (JSON or plain SQL; tests)
 * `--out` writes `local-drift.txt` (the raw diff) and `local-drift.json` (counts and statements).
 * Exit 0 = no drift beyond the allowlist, 1 = drift, 2 = the diff could not be produced or parsed.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ALLOWLIST = ['drop extension if exists "pg_net";'];

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
};

/** The CLI prints JSON under `--output-format json` (and when it detects an agent); otherwise plain SQL. */
function diffText(raw) {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{")) return trimmed;
  const parsed = JSON.parse(trimmed);
  if (typeof parsed.diff !== "string") throw new Error("CLI JSON output has no string `diff` field");
  return parsed.diff;
}

/** migra separates statements with blank lines; a multi-line body splits into several chunks, all reported. */
function statementsOf(sql) {
  return sql
    .split(/\n\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

let raw;
const input = arg("--input");
if (input) {
  raw = readFileSync(resolve(input), "utf8");
} else {
  const r = spawnSync("npx", ["supabase", "db", "diff", "--local", "--agent", "no", "--output-format", "json"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error || r.status !== 0) {
    console.error(`local-drift: \`supabase db diff --local\` failed (exit ${r.status}): ${r.error?.message ?? ""}`);
    console.error(r.stderr);
    process.exit(2);
  }
  raw = r.stdout;
}

let sql;
try {
  sql = diffText(raw);
} catch (e) {
  console.error(`local-drift: cannot parse the diff output: ${e.message}`);
  process.exit(2);
}

const statements = statementsOf(sql);
const allowed = statements.filter((s) => ALLOWLIST.includes(s));
const drift = statements.filter((s) => !ALLOWLIST.includes(s));

const out = arg("--out");
if (out) {
  const dir = resolve(out);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "local-drift.txt"), statements.length ? `${statements.join("\n\n")}\n` : "");
  const report = {
    tool: "scripts/ci/local-drift.mjs",
    source: input ? "input file" : "supabase db diff --local (migra)",
    statements: statements.length,
    allowlisted: allowed,
    drift,
    result: drift.length === 0 ? "pass" : "fail",
  };
  writeFileSync(join(dir, "local-drift.json"), `${JSON.stringify(report, null, 2)}\n`);
}

if (drift.length) {
  console.error(`local-drift: FAIL (${drift.length} statement(s) beyond the allowlist):`);
  for (const s of drift) console.error(`---\n${s}`);
  console.error("Schema drift: the local database differs from what supabase/migrations builds.");
  process.exit(1);
}
console.log(`local-drift: PASS (${statements.length} statement(s), ${allowed.length} allowlisted: ${allowed.join(" ") || "none"})`);
