#!/usr/bin/env node
/**
 * Hosted schema drift report from a PO-provided dump (V2-03 plan 03-03; BACKEND_MIGRATION_PLAN B1 hosted half,
 * roadmap V2-03 evidence "the drift report (read-only against the hosted project)"; PO action E1a).
 *
 * The agent never connects to a hosted database. The PO takes a schema-only dump outside the agent session
 * (`supabase db dump --db-url <hosted> -f hosted-schema.sql`, no data) and hands over the file. This script:
 *   1. refuses unless the database it will use is the local stack on a loopback address;
 *   2. creates a scratch database `drift_scratch_*` in the local stack's Postgres container (`docker exec ... psql`);
 *   3. gives it the Supabase base the dump assumes (the local `auth` schema, schema-only, no owners or grants; and
 *      the schemas the dump's `CREATE EXTENSION ... WITH SCHEMA` lines name);
 *   4. loads the dump with ownership statements stripped (objects end up owned by the local `postgres`, as they are
 *      in the migrations-built shadow; ownership is not compared). Grants are kept: migra compares privileges, and a
 *      hosted grant the migrations do not make is drift worth reporting;
 *   5. runs `supabase db diff --db-url <scratch> --schema public`. CLI 2.120.0 builds a shadow database from
 *      `supabase/migrations` and prints the SQL that turns it into the scratch database (verified 2026-11-13: the
 *      CLI logs "Creating shadow database..." and applies every migration);
 *   6. writes `hosted-drift.txt` (the diff) and `hosted-drift.json` (counts, statements, the dump's sha256) to
 *      `--out` (default: the phase evidence `b1/` directory), and always drops the scratch database.
 * The dump file is never copied into the repository and must not be committed.
 *
 * Allowlist: the same documented pg_net CLI false positive as scripts/ci/local-drift.mjs (it does not appear under
 * `--schema public`, but the report treats it identically). Drift here is documented, not reconciled: production
 * is built fresh from migrations (C26).
 *
 * Usage: node scripts/drift/hosted-dump-diff.mjs <dump.sql> [--out <dir>] [--label <name>] [--stack-url <url>]
 *   --stack-url  the local stack DB URL (default: `supabase status -o json` DB_URL); must be loopback.
 * Exit 0 = no drift beyond the allowlist, 1 = drift reported, 2 = refused or failed (nothing reported).
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_OUT = join(ROOT, ".planning/phases/03-platform-hygiene/evidence/b1");
const ALLOWLIST = ['drop extension if exists "pg_net";'];
const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

const fail = (msg) => {
  console.error(`hosted-dump-diff: ${msg}`);
  process.exit(2);
};
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
};

const dumpPath = process.argv[2];
if (!dumpPath || dumpPath.startsWith("--")) {
  fail("usage: hosted-dump-diff.mjs <dump.sql> [--out <dir>] [--label <name>] [--stack-url <url>]");
}
const out = resolve(arg("--out") ?? DEFAULT_OUT);
const label = arg("--label") ?? "hosted";

// 1. Loopback only: decided before any connection, from the URL alone.
let stackUrl = arg("--stack-url");
if (!stackUrl) {
  const s = spawnSync("npx", ["supabase", "status", "-o", "json"], { cwd: ROOT, encoding: "utf8" });
  if (s.status !== 0) fail(`\`supabase status\` failed; is the local stack running? ${s.stderr}`);
  try {
    stackUrl = JSON.parse(s.stdout).DB_URL;
  } catch {
    fail("cannot read DB_URL from `supabase status -o json`");
  }
}
let url;
try {
  url = new URL(stackUrl);
} catch {
  fail("the local stack DB URL is not a URL");
}
if (!LOOPBACK.has(url.hostname)) {
  fail(`refusing: the stack database host "${url.hostname}" is not loopback. This tool only uses the local stack.`);
}

if (!existsSync(resolve(dumpPath))) fail(`dump not found: ${dumpPath}`);
const dump = readFileSync(resolve(dumpPath), "utf8");
const dumpSha256 = createHash("sha256").update(dump).digest("hex");

const projectId = /^project_id\s*=\s*"([^"]+)"/m.exec(readFileSync(join(ROOT, "supabase/config.toml"), "utf8"))?.[1];
if (!projectId) fail("cannot read project_id from supabase/config.toml");
const container = `supabase_db_${projectId}`;
const pgUser = decodeURIComponent(url.username || "postgres");

const docker = (args, input) =>
  spawnSync("docker", ["exec", "-i", container, ...args], { input, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
const psql = (db, sql, what) => {
  const r = docker(["psql", "-U", pgUser, "-d", db, "-v", "ON_ERROR_STOP=1", "-q", "-o", "/dev/null"], sql);
  if (r.error || r.status !== 0) throw new Error(`${what} failed (psql exit ${r.status}): ${(r.stderr ?? "").trim()}`);
};

/** Ownership and session settings the local server may not accept; everything else in the dump is loaded as is. */
function stripForLoad(sql) {
  return sql
    .split("\n")
    .filter((l) => !/^\s*ALTER\s+.+\s+OWNER\s+TO\s+.+;\s*$/i.test(l) && !/^\s*SET\s+transaction_timeout\b/i.test(l))
    .join("\n");
}

const scratch = `drift_scratch_${process.pid}_${Date.now()}`;
let created = false;
let exitCode = 2;
try {
  const probe = docker(["true"]);
  if (probe.status !== 0) throw new Error(`local Postgres container ${container} is not running (${(probe.stderr ?? "").trim()})`);

  // 2. Scratch database.
  psql("postgres", `create database "${scratch}";`, "create scratch database");
  created = true;

  // 3. Supabase base the dump assumes: schemas named by its extensions, then the local auth schema.
  const extSchemas = [...dump.matchAll(/CREATE EXTENSION IF NOT EXISTS "[^"]+" WITH SCHEMA "([^"]+)"/gi)]
    .map((m) => m[1])
    .filter((s) => s !== "public");
  const base = [...new Set(["extensions", "vault", ...extSchemas])]
    .map((s) => `create schema if not exists "${s.replace(/"/g, '""')}";`)
    .join("\n");
  psql(scratch, base, "create base schemas");
  const auth = docker(["pg_dump", "-U", pgUser, "-d", "postgres", "--schema-only", "--no-owner", "--no-acl", "-n", "auth"]);
  if (auth.status !== 0) throw new Error(`dump local auth schema failed: ${auth.stderr}`);
  psql(scratch, auth.stdout, "load local auth schema");

  // 4. The dump.
  psql(scratch, stripForLoad(dump), "load the schema dump");

  // 5. Diff against the migrations-built shadow.
  const scratchUrl = new URL(url.href);
  scratchUrl.pathname = `/${scratch}`;
  const d = spawnSync(
    "npx",
    ["supabase", "db", "diff", "--db-url", scratchUrl.href, "--schema", "public", "--agent", "no", "--output-format", "json"],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (d.status !== 0) throw new Error(`supabase db diff failed (exit ${d.status}): ${d.stderr}`);
  const sql = JSON.parse(d.stdout.trim()).diff;
  if (typeof sql !== "string") throw new Error("supabase db diff JSON has no string `diff` field");

  const statements = sql
    .split(/\n\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const allowlisted = statements.filter((s) => ALLOWLIST.includes(s));
  const drift = statements.filter((s) => !ALLOWLIST.includes(s));

  // 6. Report.
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, `${label}-drift.txt`), statements.length ? `${statements.join("\n\n")}\n` : "");
  const report = {
    tool: "scripts/drift/hosted-dump-diff.mjs",
    label,
    dump_sha256: dumpSha256,
    compared: "schema dump (loaded into a local scratch DB) vs shadow DB built from supabase/migrations",
    engine: "supabase db diff --schema public (migra), CLI 2.120.0",
    statements: statements.length,
    allowlisted,
    drift_count: drift.length,
    drift,
    result: drift.length === 0 ? "no drift" : "drift documented",
  };
  writeFileSync(join(out, `${label}-drift.json`), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`hosted-dump-diff: ${drift.length} drift statement(s), ${allowlisted.length} allowlisted; report in ${out}`);
  for (const s of drift) console.log(`---\n${s}`);
  exitCode = drift.length === 0 ? 0 : 1;
} catch (e) {
  console.error(`hosted-dump-diff: ${e.message}`);
  exitCode = 2;
} finally {
  if (created) {
    const r = docker(["psql", "-U", pgUser, "-d", "postgres", "-qc", `drop database if exists "${scratch}" with (force);`]);
    if (r.status !== 0) {
      console.error(`hosted-dump-diff: could not drop scratch database ${scratch}: ${r.stderr}`);
      exitCode = 2;
    }
  }
}
process.exit(exitCode);
