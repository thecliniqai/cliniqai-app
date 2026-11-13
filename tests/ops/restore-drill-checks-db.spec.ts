/**
 * V2-04 04-05a (FT-02, R-11): supabase/tests/restore_drill_checks.sql, the checks the restore drill runs on a database
 * restored from a backup, proven on the primary local stack with the manifest values computed live.
 *
 * Every run is wrapped in a transaction (`before: ["begin", …]`): the file's own `rollback`, or the session ending on
 * a failure, undoes the probe clinic it inserts and any fault a case installs, so nothing persists.
 */
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { psql, psqlFile } from "../helpers/sql";
import { seedTenantWithOwner } from "../helpers/tenants";

const CHECKS = path.resolve(__dirname, "../../supabase/tests/restore_drill_checks.sql");

/**
 * A restored database never holds a schedule or a queued request (the dump excludes them): emulate that here. 04-02:
 * the primary stack now carries migration 000033's schedules, owned by `postgres` in a table owned by `supabase_admin`,
 * so they are removed with `cron.unschedule` (a plain DELETE is refused); the session's rollback brings them back.
 */
const AS_RESTORED = `do $$ begin
  if to_regclass('cron.job') is not null then execute 'select cron.unschedule(jobid) from cron.job'; end if;
  if to_regclass('net.http_request_queue') is not null then execute 'delete from net.http_request_queue'; end if;
end $$`;

function liveManifestValues(): Record<string, number> {
  const [policies] = psql("select count(*) from pg_policies where schemaname in ('public', 'storage')");
  const [functions] = psql(
    "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'private', 'ops') " +
      "and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')",
  );
  const [users] = psql("select count(*) from auth.users");
  return { expected_policies: Number(policies), expected_functions: Number(functions), expected_users: Number(users) };
}

const tapFailures = (out: string) => out.split("\n").filter((l) => l.startsWith("not ok"));

describe("restore_drill_checks.sql on the primary local stack", () => {
  beforeAll(async () => {
    // The tenant-isolation probe needs one restored membership; a fresh lane may hold none yet.
    await seedTenantWithOwner("Restore drill checks spec clinic");
  });

  it("passes with the manifest values computed live: 13 checks ok, nothing persists", () => {
    const [tenantsBefore] = psql("select count(*) from public.tenants");
    const [cronJobsBefore] = psql("select count(*) from cron.job");
    const r = psqlFile(CHECKS, liveManifestValues(), { before: ["begin", AS_RESTORED] });
    expect(r.stderr.replace(/^.*there is already a transaction in progress\n?/m, "")).toBe("");
    expect(r.status).toBe(0);
    const oks = r.stdout.split("\n").filter((l) => /^ok \d+ - /.test(l));
    expect(oks).toHaveLength(13);
    expect(tapFailures(r.stdout)).toEqual([]);
    expect(r.stdout).toMatch(/^1\.\.13$/m);
    // 04-07c (M-RESTORE): the schedule checks ran, and the re-created schedules were rolled back with the rest.
    expect(oks.some((l) => l.includes("the restore re-creates the expected pg_cron schedule set"))).toBe(true);
    expect(oks.some((l) => l.includes("jobs-kick is re-created inactive"))).toBe(true);
    expect(psql("select count(*) from cron.job")).toEqual([cronJobsBefore]);
    // The probe clinic and patient were rolled back.
    expect(psql("select count(*) from public.tenants")).toEqual([tenantsBefore]);
    expect(psql("select count(*) from public.patients where full_name = 'Restore Drill Probe'")).toEqual(["0"]);
  });

  it("fails naming patients when RLS is off on public.patients", () => {
    const r = psqlFile(CHECKS, liveManifestValues(), {
      before: ["begin", AS_RESTORED, "alter table public.patients disable row level security"],
    });
    expect(r.status).not.toBe(0);
    const failed = tapFailures(r.stdout);
    expect(failed.some((l) => l.includes("RLS is enabled on every public table"))).toBe(true);
    // The diagnostics name the table, and the isolation probe sees the other clinic's patient.
    expect(r.stdout).toMatch(/#\s+.*patients/);
    expect(failed.some((l) => l.includes("no table with a tenant_id shows the probe member a row of another clinic"))).toBe(true);
    expect(psql("select relrowsecurity from pg_class where oid = 'public.patients'::regclass")).toEqual(["t"]);
  });

  it("fails when a cron.job row came back with the restore", () => {
    const cronBefore = psql("select count(*) from pg_extension where extname = 'pg_cron'");
    const r = psqlFile(CHECKS, liveManifestValues(), {
      before: [
        "begin",
        AS_RESTORED,
        "create extension if not exists pg_cron",
        "select cron.schedule('restore-drill-probe', '0 0 1 1 *', 'select 1')",
      ],
    });
    expect(r.status).not.toBe(0);
    expect(tapFailures(r.stdout).some((l) => l.includes("cron.job is empty"))).toBe(true);
    // The extension and the schedule were rolled back with the transaction.
    expect(psql("select count(*) from pg_extension where extname = 'pg_cron'")).toEqual(cronBefore);
  });

  it("fails when the restore path does not re-create a schedule, or re-creates jobs-kick active (04-07c, M-RESTORE)", () => {
    // ops.ensure_schedules() that forgets one schedule (the 000042 bug class: a migration added a schedule and not here).
    const forgets = `do $$ begin
      execute 'alter function ops.ensure_schedules(boolean) rename to ensure_schedules_real';
      execute $f$create function ops.ensure_schedules(p boolean default false) returns jsonb language plpgsql as $b$
        declare v jsonb; begin v := ops.ensure_schedules_real(p); perform cron.unschedule('ops-cleanup'); return v; end $b$ $f$;
    end $$`;
    const missing = psqlFile(CHECKS, liveManifestValues(), { before: ["begin", AS_RESTORED, forgets] });
    expect(missing.status).not.toBe(0);
    expect(tapFailures(missing.stdout).some((l) => l.includes("the restore re-creates the expected pg_cron schedule set"))).toBe(true);
    // ... and one that would start sending at once on a restored project.
    const active = `do $$ begin
      execute 'alter function ops.ensure_schedules(boolean) rename to ensure_schedules_real';
      execute $f$create function ops.ensure_schedules(p boolean default false) returns jsonb language plpgsql as $b$
        begin return ops.ensure_schedules_real(true); end $b$ $f$;
    end $$`;
    const kick = psqlFile(CHECKS, liveManifestValues(), { before: ["begin", AS_RESTORED, active] });
    expect(kick.status).not.toBe(0);
    expect(tapFailures(kick.stdout).some((l) => l.includes("jobs-kick is re-created inactive"))).toBe(true);
    // Both were rolled back: the real function is back, the stack's schedules untouched.
    expect(psql("select count(*) from pg_proc where proname = 'ensure_schedules_real'")).toEqual(["0"]);
    expect(psql("select count(*) from cron.job where jobname = 'ops-cleanup'")).toEqual(["1"]);
  });

  it("fails when a restored count differs from the manifest (policies, users)", () => {
    const live = liveManifestValues();
    const r = psqlFile(CHECKS, { ...live, expected_policies: live.expected_policies + 1, expected_users: live.expected_users + 1 }, {
      before: ["begin", AS_RESTORED],
    });
    expect(r.status).not.toBe(0);
    const failed = tapFailures(r.stdout);
    expect(failed.some((l) => l.includes("policy count"))).toBe(true);
    expect(failed.some((l) => l.includes("auth.users count"))).toBe(true);
  });
});
