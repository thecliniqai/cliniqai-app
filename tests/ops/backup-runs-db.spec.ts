/**
 * V2-04 04-05a, migration 000032: `ops.backup_runs` (the backup run log the backup_stale alert and the ops report read)
 * is closed to every API role and holds counts, sizes, a timestamped key and a machine code only; and
 * `ops.backup_runner_stale()` is the backup job's dead-man check for the scheduler (R-41).
 * Every write happens inside `begin … rollback` (psqlSession), so nothing persists.
 */
import { describe, expect, it } from "vitest";
import { psql, psqlSession } from "../helpers/sql";

const insert = (cols: string) =>
  `insert into ops.backup_runs (environment, started_at, finished_at, status, object_key, archive_bytes, duration_s, manifest_counts, error_code) values (${cols})`;

function refused(statement: string): string {
  try {
    psqlSession(["begin", statement, "rollback"]);
  } catch (err) {
    return String((err as Error).message);
  }
  return "accepted";
}

describe("ops.backup_runs", () => {
  it("is RLS-locked with no policy and no privilege for anon, authenticated or service_role", () => {
    expect(psql("select relrowsecurity from pg_class where oid = 'ops.backup_runs'::regclass")).toEqual(["t"]);
    expect(psql("select count(*) from pg_policies where schemaname = 'ops' and tablename = 'backup_runs'")).toEqual(["0"]);
    for (const role of ["anon", "authenticated", "service_role"]) {
      expect(psql(`select has_table_privilege('${role}', 'ops.backup_runs', 'SELECT, INSERT, UPDATE, DELETE')`), role).toEqual(["f"]);
      expect(psql(`select has_schema_privilege('${role}', 'ops', 'USAGE')`), role).toEqual(["f"]);
    }
  });

  it("accepts an ok run with a timestamped key and counts, and a failed run with a machine code", () => {
    const out = psqlSession([
      "begin",
      insert(`'staging', now(), now(), 'ok', 'staging/2026-11-13T020004Z.tar.age', 1234, 60, '{"tables":{"public.patients":4},"buckets":{"clinic-records":{"objects":1,"bytes":5}},"total_rows":4}', null`),
      insert(`'staging', now(), now(), 'failed', null, null, 3, null, 'storage_failed'`),
      "select count(*) from ops.backup_runs where started_at = now()",
      "rollback",
    ]);
    expect(out).toEqual(["2"]);
  });

  it.each([
    ["an ok run without an archive key", insert(`'staging', now(), now(), 'ok', null, null, 1, null, null`), "backup_runs_ok_has_archive"],
    ["a failed run without an error code", insert(`'staging', now(), now(), 'failed', null, null, 1, null, null`), "backup_runs_failed_has_code"],
    ["an object key that is not <env>/<timestamp>.tar.age", insert(`'staging', now(), now(), 'ok', 'staging/patient-dump.sql', 1, 1, null, null`), "backup_runs_object_key_check"],
    ["a free-text error", insert(`'staging', now(), now(), 'failed', null, null, 1, null, 'Connection to db.x failed for user postgres'`), "backup_runs_error_code_check"],
    ["an unknown environment", insert(`'prod', now(), now(), 'failed', null, null, 1, null, 'x'`), "backup_runs_environment_check"],
    ["manifest counts that are not an object", insert(`'staging', now(), now(), 'failed', null, null, 1, '[1,2]', 'x'`), "backup_runs_manifest_counts_check"],
  ])("refuses %s", (_label, statement, constraint) => {
    expect(refused(statement)).toContain(constraint);
  });
});

describe("ops.backup_runner_stale() (dead-man for the scheduler, R-41)", () => {
  // 04-02: real runner passes now land in ops.job_runner_runs (the run-route and guard specs, the local pg_cron kick), so
  // each probe starts from an empty table inside its own rolled-back transaction instead of assuming one.
  const probe = (setup: string[]) =>
    psqlSession([
      "begin",
      "delete from vault.secrets where name = 'jobs_runner_url'",
      "delete from ops.job_runner_runs",
      ...setup,
      "select ops.backup_runner_stale()",
      "rollback",
    ]);
  const secret = "select vault.create_secret('http://127.0.0.1:3100/api/jobs/run', 'jobs_runner_url') is not null";
  const run = (minutesAgo: number, ok: boolean) =>
    `insert into ops.job_runner_runs (worker, source, started_at, finished_at, ok) values ('drill-probe', 'test', now() - interval '${minutesAgo} minutes', now() - interval '${minutesAgo} minutes', ${ok})`;

  it("is false while no runner is configured (no jobs_runner_url in Vault), even with no runner pass", () => {
    expect(probe([])).toEqual(["f"]);
  });

  it("is true when a runner is configured and no pass finished ok in the last 15 minutes", () => {
    expect(probe([secret])).toEqual(["t", "t"]);
    expect(probe([secret, run(20, true), run(1, false)])).toEqual(["t", "t"]);
  });

  it("is false when a configured runner finished ok within 15 minutes", () => {
    expect(probe([secret, run(2, true)])).toEqual(["t", "f"]);
  });

  it("is executable by no API role and pins an empty search_path", () => {
    for (const role of ["anon", "authenticated", "service_role"]) {
      expect(psql(`select has_function_privilege('${role}', 'ops.backup_runner_stale()', 'EXECUTE')`), role).toEqual(["f"]);
    }
    expect(psql("select proconfig::text from pg_proc where oid = 'ops.backup_runner_stale()'::regprocedure")).toEqual(['{"search_path=\\"\\""}']);
  });
});
