/**
 * V2-04 04-07e (adversarial re-check N-2b): no psql session of the restore drill is unrestricted, and no
 * archive-derived value reaches SQL text. The real drill steps (ops/restore-drill/drill-lib.sh, sourced by run.sh) run
 * against the primary local stack (loopback) through ops/bin/psql-restricted.sh, with the pinned postgres:17 image.
 *
 *   - Route 1 (the re-checker's proof): a manifest count holding `\! echo …`, given as a psql variable to the checks
 *     file. 04-07d interpolated it raw (`:expected_policies::int`) in an unrestricted session and psql ran the command;
 *     now the session is restricted and the file uses `:'expected_policies'`: the value is one literal that fails its
 *     cast, the command never runs. drill_checks itself refuses a value that is not a validated count before psql.
 *   - Route 2: a table key that ends the counts query's literal when standard_conforming_strings is off, in a database
 *     whose own setting says off (ALTER DATABASE … SET, as a restored archive could leave it). The restricted session
 *     runs with the setting on whatever the database says; counts.sql takes the keys as one quoted variable and matches
 *     them against the catalog, so the key is just a name that matches no table; the command never runs.
 *   - The rewritten checks file (no `\set`, no `\gset`) passes all 13 checks through the restricted session.
 *   - The restore role cannot run `COPY … PROGRAM` or grant itself the role that allows it (L-F's server-side control).
 *
 * Synthetic SQL in a temp dir outside the repository; every shell command in a value is a harmless `echo`. The scratch
 * database is created and dropped by this file; the primary database is only read (or written inside a rolled-back
 * transaction).
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { psql } from "../helpers/sql";
import { letters } from "../jobs/helpers";
import { seedTenantWithOwner } from "../helpers/tenants";

const ROOT = path.resolve(__dirname, "../..");
const LIB = path.join(ROOT, "ops/restore-drill/drill-lib.sh");
const RESTRICTED = path.join(ROOT, "ops/bin/psql-restricted.sh");
// Real path: psql-docker.sh mounts PSQL_MOUNT and runs in $PWD, which must agree (macOS /var is a symlink).
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "drill-lib-")));
const scratch = `drill_scs_probe_${letters(8)}`;
let dbUrl = "";
let scratchUrl = "";

/** A restored database never holds a schedule or a queued request: emulate that inside the checks' transaction. */
const AS_RESTORED = `do $$ begin
  if to_regclass('cron.job') is not null then execute 'select cron.unschedule(jobid) from cron.job'; end if;
  if to_regclass('net.http_request_queue') is not null then execute 'delete from net.http_request_queue'; end if;
end $$`;

function stackDbUrl(): string {
  const out = execFileSync("npx", ["supabase", "status", "--workdir", ROOT, "-o", "env"], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const m = /^DB_URL="(.*)"$/m.exec(out);
  if (!m) throw new Error("local stack status has no DB_URL; is `npx supabase start` running?");
  return m[1];
}

beforeAll(async () => {
  dbUrl = stackDbUrl();
  expect(dbUrl).toMatch(/@127\.0\.0\.1:\d+\/postgres$/);
  scratchUrl = dbUrl.replace(/\/postgres$/, `/${scratch}`);
  // The tenant-isolation probe needs one restored membership; a fresh lane may hold none yet.
  await seedTenantWithOwner("Drill lib spec clinic");
  psql(`create database ${scratch}`);
  psql(`alter database ${scratch} set standard_conforming_strings = off`);
  const setup = spawnSync(RESTRICTED, ["-X", "-v", "ON_ERROR_STOP=1", "-c", "create table public.t (a int); insert into public.t values (1), (2);"], {
    cwd: tmp,
    encoding: "utf8",
    env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: "test", PSQL_DB_URL: scratchUrl, PSQL_MOUNT: tmp },
    timeout: 90_000,
  });
  expect(setup.status, setup.stderr).toBe(0);
}, 120_000);

afterAll(() => {
  psql(`drop database if exists ${scratch} with (force)`);
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** Runs one drill-lib.sh function (or any command after sourcing it) as run.sh does: set -euo pipefail. */
function lib(target: string, args: string[]) {
  return spawnSync("bash", ["-c", 'set -euo pipefail; source "$1"; shift; "$@"', "bash", LIB, ...args], {
    cwd: tmp,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      NODE_ENV: "test",
      ROOT,
      BIN: path.join(ROOT, "ops/bin"),
      WORK: tmp,
      DRILL_DB_URL: target,
    },
    timeout: 90_000,
  });
}

function write(name: string, content: string): string {
  const file = path.join(tmp, name);
  fs.writeFileSync(file, content);
  return file;
}

function liveCounts() {
  const [policies] = psql("select count(*) from pg_policies where schemaname in ('public', 'storage')");
  const [functions] = psql(
    "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'private', 'ops') " +
      "and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')",
  );
  const [users] = psql("select count(*) from auth.users");
  return { policies, functions, users };
}

const MARKER = /^(VAR_INTERP|COUNTS_SQL)_EXECUTED$/m;

describe("drill-lib.sh: every drill session is restricted and archive values reach SQL only quoted (04-07e, N-2b)", () => {
  it("route 1: a count holding a meta-command, given to the checks file → one literal that fails its cast; the command never runs", () => {
    fs.copyFileSync(path.join(ROOT, "supabase/tests/restore_drill_checks.sql"), path.join(tmp, "restore_drill_checks.sql"));
    const r = lib(dbUrl, [
      "drill_psql", "-At",
      "-v", "expected_policies=1 \\! echo VAR_INTERP_EXECUTED #",
      "-v", "expected_functions=1;\n\\! echo VAR_INTERP_EXECUTED",
      "-v", "expected_users=1",
      "-f", path.join(tmp, "restore_drill_checks.sql"),
    ]);
    expect(r.stdout).not.toMatch(MARKER);
    expect(r.stderr).not.toMatch(MARKER);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("invalid input syntax for type integer");
  }, 120_000);

  it("drill_checks refuses a manifest whose count is not a validated integer, before psql runs", () => {
    const manifest = write("bad-manifest.json", JSON.stringify({ policies: "1 \\! echo VAR_INTERP_EXECUTED #", functions: 1, auth_users: 1 }));
    const r = lib(dbUrl, ["drill_checks", manifest, path.join(tmp, "tap-bad.out")]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("manifest field policies is not a validated count");
    expect(fs.existsSync(path.join(tmp, "tap-bad.out"))).toBe(false);
  });

  it("the checks file (no meta-command) passes all 13 checks through the restricted session with the live counts", () => {
    fs.copyFileSync(path.join(ROOT, "supabase/tests/restore_drill_checks.sql"), path.join(tmp, "restore_drill_checks.sql"));
    const c = liveCounts();
    const r = lib(dbUrl, [
      "drill_psql", "-At",
      "-v", `expected_policies=${c.policies}`, "-v", `expected_functions=${c.functions}`, "-v", `expected_users=${c.users}`,
      "-c", "begin", "-c", AS_RESTORED,
      "-f", path.join(tmp, "restore_drill_checks.sql"),
    ]);
    expect(r.status, r.stderr).toBe(0);
    const tap = r.stdout.split("\n");
    expect(tap.filter((l) => l.startsWith("ok "))).toHaveLength(13);
    expect(tap.filter((l) => l.startsWith("not ok"))).toEqual([]);
    // No id is printed (the probe ids live in transaction-local settings).
    expect(r.stdout).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
    expect(psql("select count(*) from public.patients where full_name = 'Restore Drill Probe'")).toEqual(["0"]);
  }, 120_000);

  it("route 2: in a database whose own setting turns standard_conforming_strings off, the session runs with it on and a hostile table key is only a name", () => {
    // The scratch database really says off: a plain (non-wrapper) session sees it.
    expect(psql(`select setconfig from pg_db_role_setting s join pg_database d on d.oid = s.setdatabase where d.datname = '${scratch}'`)).toEqual([
      "{standard_conforming_strings=off}",
    ]);
    const probe = spawnSync(RESTRICTED, ["-X", "-At", "-c", "select current_setting('standard_conforming_strings') || '|' || current_setting('client_encoding')"], {
      cwd: tmp,
      encoding: "utf8",
      env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: "test", PSQL_DB_URL: scratchUrl, PSQL_MOUNT: tmp },
      timeout: 90_000,
    });
    expect(probe.status, probe.stderr).toBe(0);
    expect(probe.stdout.trim()).toBe("on|UTF8");

    fs.copyFileSync(path.join(ROOT, "ops/restore-drill/counts.sql"), path.join(tmp, "counts.sql"));
    const hostile = JSON.stringify(["public.t", "x\\'; \\! echo COUNTS_SQL_EXECUTED #.t"]);
    const r = lib(scratchUrl, ["drill_psql", "-At", "-F", "\t", "-v", `tables=${hostile}`, "-f", path.join(tmp, "counts.sql")]);
    expect(r.stdout).not.toMatch(MARKER);
    expect(r.stderr).not.toMatch(MARKER);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout.trim().split("\n")).toEqual(["public.t\t2"]);
  }, 120_000);

  it("drill_counts counts the validated tables that exist and refuses keys that are not validated", () => {
    const good = write("good-manifest.json", JSON.stringify({ tables: { "public.t": 2, "public.missing_table": 0 } }));
    const out = path.join(tmp, "counts.tsv");
    const r = lib(scratchUrl, ["drill_counts", good, out]);
    expect(r.status, r.stderr).toBe(0);
    // A missing table yields no row: compare-manifest.ts reports it as "missing after restore".
    expect(fs.readFileSync(out, "utf8").trim().split("\n")).toEqual(["public.t\t2"]);

    const bad = write("bad-tables.json", JSON.stringify({ tables: { "x\\'; \\! echo COUNTS_SQL_EXECUTED #.t": 1 } }));
    const refused = lib(scratchUrl, ["drill_counts", bad, path.join(tmp, "counts-bad.tsv")]);
    expect(refused.status).not.toBe(0);
    expect(refused.stderr).toContain("manifest table keys are not validated");
    expect(refused.stdout + refused.stderr).not.toMatch(MARKER);
  }, 120_000);

  it("psql-restricted.sh refuses to run without -c or -f (psql would silently ignore stdin)", () => {
    const r = spawnSync(RESTRICTED, ["-X", "-At"], {
      cwd: tmp,
      encoding: "utf8",
      input: "select 1;\n",
      env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: "test", PSQL_DB_URL: dbUrl, PSQL_MOUNT: tmp },
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("pass the SQL with -c or -f");
  });
});

describe("the restore role cannot run COPY … PROGRAM (04-07e, L-F: the server-side control)", () => {
  it("postgres (the role the restore connects as) holds neither superuser nor pg_execute_server_program, cannot grant it, and COPY … PROGRAM is refused", () => {
    expect(
      psql(
        "select rolsuper::text || '|' || pg_has_role('postgres', 'pg_execute_server_program', 'member')::text from pg_roles where rolname = 'postgres'",
      ),
    ).toEqual(["false|false"]);
    const run = (sql: string) =>
      spawnSync(RESTRICTED, ["-X", "-At", "-v", "ON_ERROR_STOP=1", "--single-transaction", "-c", sql], {
        cwd: tmp,
        encoding: "utf8",
        env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: "test", PSQL_DB_URL: dbUrl, PSQL_MOUNT: tmp },
        timeout: 90_000,
      });
    for (const sql of ["copy (select 1) to program 'true'", "copy (select 1) to program $$true$$"]) {
      const r = run(sql);
      expect(r.status, sql).not.toBe(0);
      expect(r.stderr).toMatch(/permission denied|must be superuser|pg_execute_server_program/);
    }
    const grant = run("grant pg_execute_server_program to postgres");
    expect(grant.status).not.toBe(0);
    expect(grant.stderr).toMatch(/only superusers can grant|permission denied|must have admin option/i);
    expect(psql("select pg_has_role('postgres', 'pg_execute_server_program', 'member')")).toEqual(["f"]);
  }, 120_000);
});
