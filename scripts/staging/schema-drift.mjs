#!/usr/bin/env node
/**
 * Hosted staging schema drift (V2-03 03-08, B1 for staging; ruling R-21). Runs nightly in `drift.yml` (`schema` job,
 * GitHub Environment `staging-readonly`).
 *
 *   1. `target-guard`: `STAGING_DB_URL_RO` must be the staging project (`SUPABASE_PROJECT_REF_STAGING`); loopback,
 *      IP literals and other projects are refused before anything runs.
 *   2. `supabase db diff --db-url <canonical URL without the password> --schema public,ops,private --agent no
 *      --output-format json`, with the password in `PGPASSWORD` (04-00 L-7: never in argv): the CLI
 *      builds a shadow database from `supabase/migrations` in the runner's Docker and diffs it against the staging
 *      database. The CLI only reads the target (catalog queries); the URL's role is the read-only `clinicos_drift_ro`
 *      (no table grants; docs/runbooks/staging.md). 03-13b (M-DRIFT): `ops` and `private` hold this phase's
 *      protections, so they are diffed too.
 *   3. The diff is judged by `scripts/ci/local-drift.mjs --input` (the same allowlist as the local gate, 03-03).
 *   4. 03-13b (M-DRIFT): migra does not compare privileges, so `scripts/drift/schema-snapshot.mjs`'s catalogue query
 *      (grants to anon/authenticated/service_role/PUBLIC, policies, RLS flags, functions, `ops`/`private`) runs through
 *      `psql` in one read-only transaction and is compared with the committed snapshot of this commit.
 * The database URL and its password are removed from every line the CLI prints before it is shown; psql gets the
 * connection as `PG*` variables (TLS required), never on its command line.
 *
 * Usage: node scripts/staging/schema-drift.mjs [--out <dir>]
 * Exit 0 = no drift beyond the allowlist, 1 = drift, 2 = refused or the diff could not be produced.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { judgeSnapshot, parseSnapshot, psqlArgs } from "../drift/schema-snapshot.mjs";
import { REF_VAR, canonicalDbUrl, redactUrl, stagingTargetProblems, urlPassword } from "./target-guard.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const DB_URL_VAR = "STAGING_DB_URL_RO";
/** 03-13b M-DRIFT: the schemas the hosted diff covers (this phase's protections live in `ops` and `private` too). */
export const DIFF_SCHEMAS = "public,ops,private";

/**
 * The CLI arguments of the read-only diff (exported for the spec). 04-00 (review A L-7): `url` is the password-free
 * canonical URL; the CLI reads the password from `PGPASSWORD` in its environment, never from argv.
 */
export function diffArgs(url) {
  return ["supabase", "db", "diff", "--db-url", url, "--schema", DIFF_SCHEMAS, "--agent", "no", "--output-format", "json"];
}

/** `postgres://user:password@host:port/db` → the `PG*` variables psql reads (TLS required; no URL on a command line). */
export function pgEnv(url) {
  const u = new URL(url);
  return {
    PGHOST: u.hostname,
    PGPORT: u.port || "5432",
    PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password),
    PGDATABASE: decodeURIComponent(u.pathname.replace(/^\//, "")) || "postgres",
    PGSSLMODE: new URLSearchParams(u.search).get("sslmode") === "verify-full" ? "verify-full" : "require",
    PGCONNECT_TIMEOUT: "15",
  };
}

/**
 * @param {{ vars?: Record<string, string | undefined>, out?: string,
 *   spawnImpl?: (cmd: string, args: string[], opts: object) => { status: number | null, stdout: string, stderr: string, error?: Error } }} [options]
 * @returns {{ exitCode: number, lines: string[] }}
 */
export function runSchemaDrift({ vars = process.env, out, spawnImpl = spawnSync } = {}) {
  const url = vars[DB_URL_VAR];
  const problems = stagingTargetProblems({ url, ref: vars[REF_VAR], kind: "db" });
  if (problems.length) return { exitCode: 2, lines: problems.map((p) => `schema-drift: REFUSED ${DB_URL_VAR}: ${p}`) };

  // 03-13 M-GUARD: the CLI gets the URL re-serialised from the checked parts with TLS required, never the raw secret.
  const target = canonicalDbUrl(url);
  // The raw URL first: it is a prefix of the canonical one, so both print as `<staging-url>` (password always `***`).
  const redact = (text) => redactUrl(redactUrl(text, url), target);
  // 04-00 L-7: the URL on the command line carries no password; pgx takes it from PGPASSWORD (local CLI proof in
  // .planning/phases/04-jobs-reliability/evidence/04-00/l7-cli-pgpassword.txt).
  const diff = spawnImpl("npx", diffArgs(canonicalDbUrl(url, { password: false })), {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, [DB_URL_VAR]: undefined, PGSSLMODE: "require", PGPASSWORD: urlPassword(url) ?? "" },
  });
  if (diff.error || diff.status !== 0) {
    const stderr = redact(String(diff.stderr ?? "")).trim();
    return {
      exitCode: 2,
      lines: [`schema-drift: \`supabase db diff --db-url <staging>\` failed (exit ${diff.status})`, ...(stderr ? [stderr] : [])],
    };
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "schema-drift-"));
  const input = path.join(dir, "staging-diff.json");
  fs.writeFileSync(input, redact(String(diff.stdout ?? "")));
  const judge = spawnImpl(process.execPath, [path.join(REPO_ROOT, "scripts/ci/local-drift.mjs"), "--input", input, ...(out ? ["--out", out] : [])], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  fs.rmSync(dir, { recursive: true, force: true });
  const lines = [String(judge.stdout ?? "").trim(), String(judge.stderr ?? "").trim()].filter(Boolean).map(redact);
  const diffExit = judge.status === 0 ? 0 : judge.status === 1 ? 1 : 2;

  // 4. Privileges, policies and the ops/private catalogue (migra compares none of the grants).
  const snap = spawnImpl("psql", psqlArgs(), {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    // Only PATH and the PG* variables reach psql (no other secret of the job's environment).
    env: { PATH: process.env.PATH ?? "", ...pgEnv(target) },
  });
  if (snap.error || snap.status !== 0) {
    const stderr = redact(String(snap.stderr ?? "")).trim();
    lines.push(`schema-drift: the privilege snapshot query failed (exit ${snap.status})`, ...(stderr ? [stderr] : []));
    return { exitCode: 2, lines };
  }
  const judged = judgeSnapshot(parseSnapshot(String(snap.stdout ?? "")), { out, label: "staging" });
  lines.push(...judged.lines.map(redact));
  return { exitCode: Math.max(diffExit, judged.exitCode), lines };
}

function main() {
  const argv = process.argv.slice(2);
  const i = argv.indexOf("--out");
  const out = i > -1 ? path.resolve(argv[i + 1]) : undefined;
  if (argv.some((a, idx) => a.startsWith("--") && a !== "--out" && idx !== i + 1)) {
    console.error("usage: node scripts/staging/schema-drift.mjs [--out <dir>]");
    return 2;
  }
  const { exitCode, lines } = runSchemaDrift({ out });
  for (const line of lines) (exitCode === 0 ? console.log : console.error)(line);
  return exitCode;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exit(main());
}
