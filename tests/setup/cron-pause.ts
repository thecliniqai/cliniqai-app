/**
 * V2-04 04-02 ("Background cron in test lanes"): pg_cron runs the reaper and the runner kick every minute on the local
 * stack (migration 000033). A test lane must not race them (a reap between a spec's claim and its assertion would make
 * the spec flaky), so the Vitest and Playwright global setups set every `cron.job` row inactive after taking the run
 * lock, and their teardowns set every row active again (also healing a run that was killed before its teardown).
 * Specs call the SQL functions directly.
 *
 * Loopback only by construction: `docker exec` into the local stack's Postgres container named after
 * `supabase/config.toml`'s `project_id`. A stack without pg_cron (before 000033) is left alone. Plain Node + relative
 * imports (used by both runners).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function container(rootDir: string): string {
  const toml = fs.readFileSync(path.join(rootDir, "supabase/config.toml"), "utf8");
  const projectId = /^project_id\s*=\s*"([^"]+)"/m.exec(toml)?.[1];
  if (!projectId) throw new Error("project_id not found in supabase/config.toml");
  return `supabase_db_${projectId}`;
}

function psql(rootDir: string, sql: string): string[] {
  const out = execFileSync(
    "docker",
    ["exec", container(rootDir), "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-qAtc", sql],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  return out.trim().split("\n").filter(Boolean);
}

/** Flips every row whose `active` differs from `active`; returns the names it changed. */
function setActive(rootDir: string, active: boolean): string[] {
  return psql(
    rootDir,
    `with t as materialized (select jobid, jobname from cron.job where active is distinct from ${active}) ` +
      `select t.jobname from t cross join lateral (select cron.alter_job(t.jobid, active := ${active})) a order by t.jobname`,
  );
}

/** Sets every active `cron.job` row inactive; returns the job names it paused. */
export function pauseCronJobs(rootDir: string): string[] {
  if (!hasCron(rootDir)) return [];
  return setActive(rootDir, false);
}

/** Sets every inactive `cron.job` row active again; returns the job names it resumed. */
export function resumeCronJobs(rootDir: string): string[] {
  if (!hasCron(rootDir)) return [];
  return setActive(rootDir, true);
}

/** True when the stack has pg_cron (migration 000033 applied). */
export function hasCron(rootDir: string): boolean {
  return psql(rootDir, "select to_regclass('cron.job') is not null")[0] === "t";
}

/** The active state of every `cron.job` row, `name=t|f`, by name. */
export function cronStates(rootDir: string): string[] {
  return psql(rootDir, "select jobname || '=' || active from cron.job order by jobname");
}
