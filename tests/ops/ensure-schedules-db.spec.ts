/**
 * V2-04 04-07c (independent review M4, triage M-RESTORE): `ops.ensure_schedules()` (migration 000042) re-creates the
 * pg_cron schedules a restore leaves out (cron.job is not in the dump, and the replayed migration history means no
 * migration re-runs its cron.schedule call).
 *
 *   - It describes the migrated stack exactly: its expected set equals every `cron.job` name, and on the live stack it
 *     creates and updates nothing (same schedule, same command). A later migration that adds a schedule without
 *     replacing this function fails here.
 *   - On a stack with no schedule (a restore) it creates all nine, `jobs-kick` inactive; a second call changes nothing
 *     (no duplicate row); a drifted schedule or command is put back; `ensure_schedules(true)` activates `jobs-kick`.
 *   - postgres only: no API role executes it; it is not SECURITY DEFINER.
 *
 * Every case runs in one psql session inside `begin … rollback` (nothing committed; the lanes keep pg_cron paused).
 */
import { describe, expect, it } from "vitest";
import { psql, psqlSession } from "../helpers/sql";

const UNSCHEDULE_ALL = "select count(cron.unschedule(jobid)) from cron.job";
const ENSURE = (activate = false) => `select 'R|' || ops.ensure_schedules(${activate})::text`;
const JOBS = "select 'J|' || jobname || '|' || active || '|' || schedule from cron.job order by jobname";

interface Result {
  calls: Array<Record<string, string[]>>;
  jobs: Array<{ name: string; active: boolean; schedule: string }>;
}

function session(steps: string[]): Result {
  const lines = psqlSession(["begin", ...steps, JOBS, "rollback"]);
  return {
    calls: lines.filter((l) => l.startsWith("R|")).map((l) => JSON.parse(l.slice(2)) as Record<string, string[]>),
    jobs: lines
      .filter((l) => l.startsWith("J|"))
      .map((l) => {
        const [, name, active, schedule] = l.split("|");
        return { name, active: active === "true", schedule };
      }),
  };
}

const NINE = [
  "cron-history-cleanup",
  "delivery-reap",
  "jobs-kick",
  "jobs-reap",
  "ops-cleanup",
  "ops-evaluate-alerts",
  "ops-heartbeat",
  "ops-quota-snapshot",
  "ops-quota-weekly-summary",
];

describe("ops.ensure_schedules() (M-RESTORE)", () => {
  it("matches the migrated stack: same names, schedules and commands, so it creates and updates nothing there", () => {
    const live = psql("select jobname from cron.job where username = 'postgres' order by jobname");
    expect(live).toEqual(NINE);
    const { calls, jobs } = session([ENSURE()]);
    expect([...calls[0].expected].sort()).toEqual(live);
    expect(calls[0]).toMatchObject({ created: [], updated: [], inactive: [], activated: [] });
    expect(jobs.map((j) => j.name)).toEqual(NINE);
  });

  it("on a restored project (no schedule) creates all nine, jobs-kick inactive; a second call is a no-op", () => {
    const { calls, jobs } = session([UNSCHEDULE_ALL, ENSURE(), ENSURE()]);
    expect([...calls[0].created].sort()).toEqual(NINE);
    expect(calls[0].inactive).toEqual(["jobs-kick"]);
    expect(calls[1]).toMatchObject({ created: [], updated: [], inactive: [], activated: [] });
    expect(jobs.map((j) => j.name)).toEqual(NINE); // one row each, no duplicate
    expect(jobs.filter((j) => !j.active).map((j) => j.name)).toEqual(["jobs-kick"]);
    expect(jobs.find((j) => j.name === "ops-evaluate-alerts")?.schedule).toBe("*/5 * * * *");
  });

  it("puts back a drifted schedule or command, and ensure_schedules(true) activates jobs-kick after the review", () => {
    const { calls, jobs } = session([
      UNSCHEDULE_ALL,
      ENSURE(),
      "select cron.alter_job((select jobid from cron.job where jobname = 'ops-heartbeat'), schedule => '0 0 1 1 *')",
      "select cron.alter_job((select jobid from cron.job where jobname = 'jobs-reap'), command => 'select 1')",
      ENSURE(true),
    ]);
    expect([...calls[1].updated].sort()).toEqual(["jobs-reap", "ops-heartbeat"]);
    expect(calls[1].activated).toEqual(["jobs-kick"]);
    expect(jobs.every((j) => j.active)).toBe(true);
    expect(jobs.find((j) => j.name === "ops-heartbeat")?.schedule).toBe("0 */6 * * *");
    expect(psqlSession(["begin", UNSCHEDULE_ALL, ENSURE(), "select command from cron.job where jobname = 'jobs-reap'", "rollback"]).at(-1)).toBe(
      "select ops.reap_jobs()",
    );
  });

  it("an existing inactive jobs-kick stays inactive without the flag (the lane's paused rows are left as they are)", () => {
    const { jobs } = session(["select cron.alter_job((select jobid from cron.job where jobname = 'jobs-kick'), active => false)", ENSURE()]);
    expect(jobs.find((j) => j.name === "jobs-kick")?.active).toBe(false);
  });

  it("is postgres only: no API role executes it, and it is not SECURITY DEFINER", () => {
    for (const role of ["anon", "authenticated", "service_role"]) {
      expect(psql(`select has_function_privilege('${role}', 'ops.ensure_schedules(boolean)', 'EXECUTE')`), role).toEqual(["f"]);
    }
    // Nothing granted to PUBLIC (grantee 0).
    expect(psql("select count(*) from aclexplode((select proacl from pg_proc where oid = 'ops.ensure_schedules(boolean)'::regprocedure)) a where a.grantee = 0")).toEqual(["0"]);
    expect(psql("select prosecdef from pg_proc where oid = 'ops.ensure_schedules(boolean)'::regprocedure")).toEqual(["f"]);
  });
});
