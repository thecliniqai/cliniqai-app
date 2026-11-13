#!/usr/bin/env node
/**
 * Staging migration plan (V2-04 04-00, review A L-5; ruling R-47; threat T-04-26). The `plan` job of `staging.yml`
 * runs it in Environment `staging-readonly` (no reviewer) before `migrate`, which `needs: plan` and waits for the PO's
 * approval of Environment `staging`: the reviewer sees what will be applied before approving, instead of a dry run
 * that only prints after the approval.
 *
 *   1. `target-guard`: `STAGING_DB_URL_RO` must be the staging project (`SUPABASE_PROJECT_REF_STAGING`); loopback, IP
 *      literals, other projects and re-targeting query parameters are refused before anything runs.
 *   2. `psql` (connection as `PG*` variables from the canonical URL, TLS required; no URL or password on its command
 *      line) reads `supabase_migrations.schema_migrations.version` in one read-only transaction. The read-only role
 *      `clinicos_drift_ro` needs `usage` on that schema and `select` on that table (docs/runbooks/staging.md §3, PO
 *      action 04-P16); it holds no other grant.
 *   3. The versions are compared with `supabase/migrations/<version>_<name>.sql` (the CLI's own file rule). Pending
 *      file names and the count go to stdout and, on a runner, to the job summary (`GITHUB_STEP_SUMMARY`). File names
 *      only: no SQL, no URL, no row of any table.
 *
 * Agents never run `supabase db push` (CLAUDE.md), so the plan is this testable script, not the CLI's dry run; the
 * `migrate` job keeps `db push --dry-run` as a second listing.
 *
 * Usage: node scripts/staging/migration-plan.mjs
 * Exit 0 = plan listed (0 or more pending), 1 = history drift (an applied version without a file, or a pending file
 * older than the newest applied one, which `db push` refuses), 2 = refused, or the history could not be read.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { pgEnv } from "./schema-drift.mjs";
import { REF_VAR, canonicalDbUrl, redactUrl, stagingTargetProblems } from "./target-guard.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const DB_URL_VAR = "STAGING_DB_URL_RO";
export const MIGRATIONS_DIR = path.join(REPO_ROOT, "supabase/migrations");
/** The Supabase CLI's migration file rule: `<digits>_<name>.sql`. */
const MIGRATION_FILE = /^([0-9]+)_.*\.sql$/;
const VERSION = /^[0-9]+$/;
export const HISTORY_SQL = "select version from supabase_migrations.schema_migrations order by version";

/** The `psql` arguments: one read-only transaction, unaligned tuples only, no connection data. */
export function planPsqlArgs() {
  return ["-v", "ON_ERROR_STOP=1", "-qAt", "-c", "begin read only", "-c", HISTORY_SQL, "-c", "rollback"];
}

/** `{ version, file }` for every migration file in `dir`, sorted by version. */
export function localMigrations(dir = MIGRATIONS_DIR) {
  return fs
    .readdirSync(dir)
    .map((file) => ({ file, m: MIGRATION_FILE.exec(file) }))
    .filter(({ m }) => m)
    .map(({ file, m }) => ({ version: m[1], file }))
    .sort((a, b) => (a.version < b.version ? -1 : a.version > b.version ? 1 : 0));
}

/**
 * Compares the applied versions with the files.
 * @param {string[]} applied
 * @param {{ version: string, file: string }[]} files
 */
export function comparePlan(applied, files) {
  const appliedSet = new Set(applied);
  const fileVersions = new Set(files.map((f) => f.version));
  const pending = files.filter((f) => !appliedSet.has(f.version));
  const unknown = [...appliedSet].filter((v) => !fileVersions.has(v)).sort();
  const newestApplied = [...appliedSet].filter((v) => fileVersions.has(v)).sort().at(-1);
  const outOfOrder = newestApplied === undefined ? [] : pending.filter((f) => f.version < newestApplied);
  return { pending, unknown, outOfOrder };
}

/**
 * @param {{ vars?: Record<string, string | undefined>, migrationsDir?: string, summaryFile?: string,
 *   spawnImpl?: (cmd: string, args: string[], opts: object) => { status: number | null, stdout: string, stderr: string, error?: Error } }} [options]
 * @returns {{ exitCode: number, lines: string[] }}
 */
export function runMigrationPlan({ vars = process.env, migrationsDir = MIGRATIONS_DIR, summaryFile, spawnImpl = spawnSync } = {}) {
  const url = vars[DB_URL_VAR];
  const problems = stagingTargetProblems({ url, ref: vars[REF_VAR], kind: "db" });
  if (problems.length) return { exitCode: 2, lines: problems.map((p) => `migration-plan: REFUSED ${DB_URL_VAR}: ${p}`) };

  const target = canonicalDbUrl(url);
  const redact = (text) => redactUrl(redactUrl(text, url), target);
  const r = spawnImpl("psql", planPsqlArgs(), {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    // Only PATH and the PG* variables reach psql (no other secret of the job's environment).
    env: { PATH: vars.PATH ?? process.env.PATH ?? "", ...pgEnv(target) },
  });
  if (r.error || r.status !== 0) {
    const stderr = redact(String(r.stderr ?? "")).trim();
    return {
      exitCode: 2,
      lines: [
        `migration-plan: reading supabase_migrations.schema_migrations failed (exit ${r.status}); does clinicos_drift_ro hold the 04-P16 grant?`,
        ...(stderr ? [stderr] : []),
      ],
    };
  }
  const rows = String(r.stdout ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const bad = rows.filter((v) => !VERSION.test(v));
  if (bad.length) return { exitCode: 2, lines: [`migration-plan: the history returned ${bad.length} row(s) that are not a version number`] };

  const files = localMigrations(migrationsDir);
  const { pending, unknown, outOfOrder } = comparePlan(rows, files);
  const lines = [`migration-plan: ${rows.length} applied on staging, ${files.length} file(s) in supabase/migrations, ${pending.length} pending`];
  for (const f of pending) lines.push(`migration-plan: pending ${f.file}`);
  let exitCode = 0;
  if (unknown.length) {
    exitCode = 1;
    lines.push(`migration-plan: DRIFT ${unknown.length} applied version(s) with no file: ${unknown.join(", ")} (applied outside supabase/migrations)`);
  }
  if (outOfOrder.length) {
    exitCode = 1;
    lines.push(
      `migration-plan: DRIFT ${outOfOrder.length} pending file(s) older than the newest applied version (db push refuses them): ${outOfOrder.map((f) => f.file).join(", ")}`,
    );
  }

  if (summaryFile) {
    const md = [
      "### Staging migration plan",
      "",
      `${pending.length} pending (${rows.length} applied, ${files.length} files)${exitCode ? " - **history drift, see the job log**" : ""}`,
      "",
      ...pending.map((f) => `- \`${f.file}\``),
      "",
    ].join("\n");
    fs.appendFileSync(summaryFile, md);
  }
  return { exitCode, lines };
}

function main() {
  if (process.argv.length > 2) {
    console.error("usage: node scripts/staging/migration-plan.mjs");
    return 2;
  }
  const { exitCode, lines } = runMigrationPlan({ summaryFile: process.env.GITHUB_STEP_SUMMARY || undefined });
  for (const line of lines) (exitCode === 0 ? console.log : console.error)(line);
  return exitCode;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exit(main());
}
