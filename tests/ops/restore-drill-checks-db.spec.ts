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

/** A restored database never holds a schedule or a queued request (the dump excludes them): emulate that here. */
const AS_RESTORED = `do $$ begin
  if to_regclass('cron.job') is not null then execute 'delete from cron.job'; end if;
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

  it("passes with the manifest values computed live: 10 checks ok, nothing persists", () => {
    const [tenantsBefore] = psql("select count(*) from public.tenants");
    const r = psqlFile(CHECKS, liveManifestValues(), { before: ["begin", AS_RESTORED] });
    expect(r.stderr.replace(/^.*there is already a transaction in progress\n?/m, "")).toBe("");
    expect(r.status).toBe(0);
    const oks = r.stdout.split("\n").filter((l) => /^ok \d+ - /.test(l));
    expect(oks).toHaveLength(10);
    expect(tapFailures(r.stdout)).toEqual([]);
    expect(r.stdout).toMatch(/^1\.\.10$/m);
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
