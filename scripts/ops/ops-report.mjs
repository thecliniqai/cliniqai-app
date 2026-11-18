#!/usr/bin/env node
/**
 * Staging ops report fetch (V2-04 04-06; ruling R-28; threats T-04-15, T-04-17). The `report` job of
 * `.github/workflows/ops-report.yml` runs it in Environment `staging-readonly` with the read-only database URL; the
 * checker (`scripts/ops/check-ops-report.ts`) validates what it writes.
 *
 *   1. `target-guard`: `STAGING_DB_URL_RO` must be the staging project (`SUPABASE_PROJECT_REF_STAGING`); loopback, IP
 *      literals, other projects and re-targeting query parameters are refused before anything runs.
 *   2. Read-only credentials only: the URL's user must be the read-only role `clinicos_drift_ro` (direct host) or
 *      `clinicos_drift_ro.<ref>` (session pooler). `postgres`, `authenticator`, any other role: refused, nothing runs.
 *   3. `psql` 17 from the digest-pinned image (`POSTGRES_IMAGE` in `ops/bin/pins.env`); the connection reaches the
 *      container as `PG*` variables passed by name (no URL or password in any argv). One read-only transaction:
 *      {@link READ_ONLY_GUARD_SQL} first refuses (`ops_report_role_not_read_only: <reason>`) unless the transaction is
 *      read-only and the session's role has no superuser/createrole/createdb/replication/bypassrls attribute, is a
 *      member of no other role, can write no table and can create in no schema or database; only then
 *      `select ops.report_all(<hours>)` (definer, counts only; the role needs the 04-P10 grant), then `rollback`.
 *   4. The single JSON line is written to `--out`. Nothing else is printed: no URL, no row, no report content.
 *
 * Usage: node scripts/ops/ops-report.mjs --out <file> [--hours <1..336>]   (default 48)
 * Exit 0 = report written, 2 = refused, the credentials are not read-only, or the report could not be read.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { pgEnv } from "../staging/schema-drift.mjs";
import { REF_VAR, canonicalDbUrl, redactUrl, stagingTargetProblems } from "../staging/target-guard.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const DB_URL_VAR = "STAGING_DB_URL_RO";
/** The staging read-only role (docs/runbooks/staging.md §3; 04-P10 grants it the report). */
export const READ_ONLY_ROLE = "clinicos_drift_ro";
export const GUARD_FAILURE = "ops_report_role_not_read_only";
export const PINS_FILE = path.join(REPO_ROOT, "ops/bin/pins.env");
const PG_ENV_NAMES = ["PGHOST", "PGPORT", "PGUSER", "PGPASSWORD", "PGDATABASE", "PGSSLMODE", "PGCONNECT_TIMEOUT"];

/**
 * Refuses, inside the report's read-only transaction, a session that could change anything. `net` is skipped: pg_net
 * grants its request tables to PUBLIC on every Supabase project (04-02 residual, R-49), so every role can write them;
 * that is a platform fact, not a property of the credential under test.
 */
export const READ_ONLY_GUARD_SQL = `do $guard$
declare
    r record;
begin
    if pg_catalog.current_setting('transaction_read_only') <> 'on' then
        raise exception '${GUARD_FAILURE}: transaction_not_read_only';
    end if;
    select a.oid, a.rolsuper, a.rolcreaterole, a.rolcreatedb, a.rolreplication, a.rolbypassrls
      into r
      from pg_catalog.pg_roles a
     where a.rolname = current_user;
    if r.rolsuper or r.rolcreaterole or r.rolcreatedb or r.rolreplication or r.rolbypassrls then
        raise exception '${GUARD_FAILURE}: role_attributes';
    end if;
    if exists (select 1 from pg_catalog.pg_auth_members m where m.member = r.oid) then
        raise exception '${GUARD_FAILURE}: role_membership';
    end if;
    if exists (
        select 1
          from pg_catalog.pg_class c
          join pg_catalog.pg_namespace n on n.oid = c.relnamespace
         where c.relkind in ('r', 'p', 'v', 'm', 'f')
           and n.nspname not in ('pg_catalog', 'information_schema', 'net')
           and n.nspname not like 'pg\\_%'
           and pg_catalog.has_schema_privilege(n.oid, 'USAGE')
           and pg_catalog.has_table_privilege(c.oid, 'INSERT, UPDATE, DELETE, TRUNCATE')
    ) then
        raise exception '${GUARD_FAILURE}: table_write_privilege';
    end if;
    if pg_catalog.has_database_privilege(pg_catalog.current_database(), 'CREATE')
       or exists (
           select 1 from pg_catalog.pg_namespace n
            where n.nspname not like 'pg\\_%' and n.nspname <> 'information_schema'
              and pg_catalog.has_schema_privilege(n.oid, 'CREATE')
       ) then
        raise exception '${GUARD_FAILURE}: create_privilege';
    end if;
end
$guard$`;

/** The report query for a window of `hours`. */
export function reportSql(hours) {
  return `select ops.report_all(${hours})`;
}

/** The `psql` arguments: one read-only transaction (guard, report, rollback), tuples only, no psqlrc. */
export function reportPsqlArgs(hours) {
  return ["-X", "-v", "ON_ERROR_STOP=1", "-qAt", "-c", "begin read only", "-c", READ_ONLY_GUARD_SQL, "-c", reportSql(hours), "-c", "rollback"];
}

/** `POSTGRES_IMAGE` from `ops/bin/pins.env` (KEY=value lines; must be digest-pinned). */
export function postgresImage(pinsFile = PINS_FILE) {
  const line = fs
    .readFileSync(pinsFile, "utf8")
    .split("\n")
    .find((l) => l.startsWith("POSTGRES_IMAGE="));
  const image = line?.slice("POSTGRES_IMAGE=".length).trim();
  if (!image || !/^[a-z0-9./_-]+:[A-Za-z0-9._-]+@sha256:[0-9a-f]{64}$/.test(image)) {
    throw new Error("ops/bin/pins.env has no digest-pinned POSTGRES_IMAGE");
  }
  return image;
}

/** `docker run` arguments: the connection crosses by variable name only (`-e NAME`), never as a value. */
export function dockerArgs(image, hours) {
  return ["run", "--rm", "--read-only", ...PG_ENV_NAMES.flatMap((n) => ["-e", n]), image, "psql", ...reportPsqlArgs(hours)];
}

/** Problems with the URL's user as a read-only report credential (empty = the read-only role). */
export function readOnlyUserProblems(url, ref) {
  let user;
  try {
    user = decodeURIComponent(new URL(url).username);
  } catch {
    return ["the database URL cannot be parsed"];
  }
  if (user === READ_ONLY_ROLE || user === `${READ_ONLY_ROLE}.${ref}`) return [];
  return [`the database user is not the read-only role ${READ_ONLY_ROLE} (the report never runs with another role's credentials)`];
}

/**
 * @param {{ vars?: Record<string, string | undefined>, out: string, hours?: number, image?: string,
 *   spawnImpl?: (cmd: string, args: string[], opts: object) => { status: number | null, stdout: string, stderr: string, error?: Error } }} options
 * @returns {{ exitCode: number, lines: string[] }}
 */
export function runOpsReport({ vars = process.env, out, hours = 48, image, spawnImpl = spawnSync }) {
  if (!Number.isInteger(hours) || hours < 1 || hours > 336) return { exitCode: 2, lines: ["ops-report: --hours must be 1..336"] };
  const url = vars[DB_URL_VAR];
  const ref = vars[REF_VAR];
  const problems = stagingTargetProblems({ url, ref, kind: "db" });
  if (problems.length) return { exitCode: 2, lines: problems.map((p) => `ops-report: REFUSED ${DB_URL_VAR}: ${p}`) };
  const roleProblems = readOnlyUserProblems(url, ref);
  if (roleProblems.length) return { exitCode: 2, lines: roleProblems.map((p) => `ops-report: REFUSED ${DB_URL_VAR}: ${p}`) };

  const target = canonicalDbUrl(url);
  const redact = (text) => redactUrl(redactUrl(text, url), target);
  const env = { PATH: vars.PATH ?? process.env.PATH ?? "", ...pgEnv(target) };
  for (const name of ["HOME", "DOCKER_HOST", "DOCKER_CONFIG"]) if (vars[name]) env[name] = vars[name];
  let pinned;
  try {
    pinned = image ?? postgresImage();
  } catch (err) {
    return { exitCode: 2, lines: [`ops-report: ${err.message}`] };
  }
  const r = spawnImpl("docker", dockerArgs(pinned, hours), { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, env });
  const stderr = redact(String(r.stderr ?? ""));
  if (r.error || r.status !== 0) {
    const refused = new RegExp(`${GUARD_FAILURE}: ([a-z_]+)`).exec(stderr);
    if (refused) {
      return { exitCode: 2, lines: [`ops-report: REFUSED the credentials are not read-only (${refused[1]}); use the ${READ_ONLY_ROLE} URL`] };
    }
    const hint = /permission denied for (schema ops|function report_all)/.test(stderr)
      ? ` (does ${READ_ONLY_ROLE} hold the 04-P10 grant? docs/runbooks/jobs.md §13)`
      : "";
    // psql's message names the failing statement's problem; the URL and password are redacted.
    const first = stderr.split("\n").map((l) => l.trim()).find(Boolean);
    return { exitCode: 2, lines: [`ops-report: reading ops.report_all failed (exit ${r.status})${hint}`, ...(first ? [first] : [])] };
  }
  const rows = String(r.stdout ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  let report;
  try {
    if (rows.length !== 1) throw new Error("rows");
    report = JSON.parse(rows[0]);
    if (!report || typeof report !== "object" || Array.isArray(report)) throw new Error("shape");
  } catch {
    return { exitCode: 2, lines: [`ops-report: unexpected output (${rows.length} line(s)); expected one JSON object`] };
  }
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  const text = `${JSON.stringify(report, null, 2)}\n`;
  fs.writeFileSync(out, text);
  return { exitCode: 0, lines: [`ops-report: wrote ${path.basename(out)} (${Buffer.byteLength(text)} bytes, window ${hours} h)`] };
}

export function parseArgs(argv) {
  let out;
  let hours = 48;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out" && argv[i + 1]) out = argv[++i];
    else if (argv[i] === "--hours" && /^[0-9]{1,3}$/.test(argv[i + 1] ?? "")) hours = Number(argv[++i]);
    else return null;
  }
  return out ? { out, hours } : null;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args) {
    console.error("usage: node scripts/ops/ops-report.mjs --out <file> [--hours <1..336>]");
    return 2;
  }
  const { exitCode, lines } = runOpsReport(args);
  for (const line of lines) (exitCode === 0 ? console.log : console.error)(line);
  return exitCode;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exit(main());
}
