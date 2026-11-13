/**
 * V2-04 04-06 (R-2, V2-03 R-27; threat T-04-18): `ops.cleanup()` removes ops rows past their retention and keeps the
 * newer ones, per table: jobs done/cancelled 7 d, dead 30 d (pending/running never); runner runs 14 d; inbound webhook
 * events 30 d; resolved alerts 180 d (open never); heartbeats 90 d; quota snapshots and backup runs 400 d; error events
 * 180 d through `ops.purge_error_events` (with the overflow counters). The newest heartbeat, quota snapshot, ok runner
 * run and backup run per environment are kept even when old, so a stopped schedule keeps its alert firing. Each case
 * runs in one session inside `begin … rollback` from emptied tables (nothing committed); ages are read back in days.
 */
import { describe, expect, it } from "vitest";
import { psql, psqlSession } from "../helpers/sql";

const TABLES = [
  "ops.jobs",
  "ops.job_runner_runs",
  "ops.inbound_webhook_events",
  "ops.alerts",
  "ops.heartbeats",
  "ops.quota_snapshots",
  "ops.backup_runs",
  "ops.error_events",
  "ops.error_event_overflow",
];
const BASELINE = TABLES.map((t) => `delete from ${t}`);
const CLEANUP = "select 'C|' || ops.cleanup()::text";

/** Baseline, seed, cleanup, then each `read` query (prefixed); rolled back. */
function run(seed: string[], reads: Record<string, string>): { counts: Record<string, number>; rows: Record<string, string> } {
  const lines = psqlSession([
    "begin",
    ...BASELINE,
    ...seed,
    CLEANUP,
    ...Object.entries(reads).map(([k, sql]) => `select '${k}|' || coalesce((${sql}), '')`),
    "rollback",
  ]);
  const counts = JSON.parse(lines.find((l) => l.startsWith("C|"))!.slice(2)) as Record<string, number>;
  const rows = Object.fromEntries(Object.keys(reads).map((k) => [k, lines.find((l) => l.startsWith(`${k}|`))!.slice(k.length + 1)]));
  return { counts, rows };
}

const ages = (table: string, column: string, filter = "true") =>
  `select string_agg(round(extract(epoch from (now() - ${column})) / 86400)::text, ',' order by ${column}) from ${table} where ${filter}`;

describe("ops.cleanup(): retention per table", () => {
  it("jobs: done/cancelled older than 7 days and dead older than 30 days go; newer, pending and running stay", () => {
    const job = (label: string, status: string, finishedDaysAgo: number | null, createdDaysAgo = 200) =>
      `insert into ops.jobs (kind, dedupe_key, status, created_at, updated_at, finished_at, attempts, lease_token, locked_until) values ` +
      `('test.cleanup', 'cleanup-spec:${label}', '${status}', now() - interval '${createdDaysAgo} days', now() - interval '${finishedDaysAgo ?? createdDaysAgo} days', ` +
      `${finishedDaysAgo === null ? "null" : `now() - interval '${finishedDaysAgo} days'`}, 1, ` +
      `${status === "running" ? "gen_random_uuid(), now() + interval '1 minute'" : "null, null"})`;
    const { counts, rows } = run(
      [
        job("done-8", "done", 8),
        job("done-6", "done", 6),
        job("cancelled-8", "cancelled", 8),
        job("cancelled-null-finish", "cancelled", null, 9),
        job("dead-31", "dead", 31),
        job("dead-29", "dead", 29),
        job("pending-old", "pending", null),
        job("running-old", "running", null),
      ],
      { J: "select string_agg(substr(dedupe_key, 14), ',' order by dedupe_key) from ops.jobs" },
    );
    expect(rows.J).toBe("dead-29,done-6,pending-old,running-old");
    expect(counts).toMatchObject({ jobs_finished: 3, jobs_dead: 1 });
  });

  it("runner runs older than 14 days go, except the newest ok run", () => {
    const pass = (daysAgo: number, ok: boolean) =>
      `insert into ops.job_runner_runs (worker, source, started_at, ok) values ('test:cleanup', 'test', now() - interval '${daysAgo} days', ${ok})`;
    const { counts, rows } = run([pass(30, true), pass(20, true), pass(16, false), pass(13, false), pass(1, false)], {
      R: ages("ops.job_runner_runs", "started_at"),
    });
    // The 20-day-old ok pass is the newest ok one: kept so `last_ok_age` stays truthful.
    expect(rows.R).toBe("20,13,1");
    expect(counts.job_runner_runs).toBe(2);
    const fresh = run([pass(30, true), pass(16, true), pass(1, true)], { R: ages("ops.job_runner_runs", "started_at") });
    expect(fresh.rows.R).toBe("1");
  });

  it("inbound webhook events older than 30 days go", () => {
    const event = (key: string, daysAgo: number) =>
      `insert into ops.inbound_webhook_events (provider, dedupe_key, received_at) values ('msg91', 'cleanup-spec:${key}', now() - interval '${daysAgo} days')`;
    const { counts, rows } = run([event("a", 31), event("b", 29), event("c", 0)], {
      I: ages("ops.inbound_webhook_events", "received_at"),
    });
    expect(rows.I).toBe("29,0");
    expect(counts.inbound_webhook_events).toBe(1);
  });

  it("resolved alerts older than 180 days go; open alerts stay however old", () => {
    const resolved = (rule: string, daysAgo: number) =>
      `insert into ops.alerts (rule, severity, status, first_seen, last_seen, resolved_at) values ('${rule}', 'warn', 'resolved', ` +
      `now() - interval '${daysAgo + 1} days', now() - interval '${daysAgo} days', now() - interval '${daysAgo} days')`;
    const { counts, rows } = run(
      [
        resolved("dead_letter", 181),
        resolved("queue_lag", 179),
        "insert into ops.alerts (rule, severity, first_seen, last_seen) values ('backup_stale', 'critical', now() - interval '400 days', now() - interval '400 days')",
      ],
      { A: "select string_agg(rule || ':' || status, ',' order by rule) from ops.alerts" },
    );
    expect(rows.A).toBe("backup_stale:open,queue_lag:resolved");
    expect(counts.alerts).toBe(1);
  });

  it("heartbeats older than 90 days go; when all are old the newest stays (heartbeat_gap keeps firing)", () => {
    const beat = (daysAgo: number) => `insert into ops.heartbeats (at) values (now() - interval '${daysAgo} days')`;
    const { counts, rows } = run([beat(120), beat(91), beat(89), beat(0)], { H: ages("ops.heartbeats", "at") });
    expect(rows.H).toBe("89,0");
    expect(counts.heartbeats).toBe(2);
    expect(run([beat(200), beat(120), beat(95)], { H: ages("ops.heartbeats", "at") }).rows.H).toBe("95");
  });

  it("quota snapshots older than 400 days go; when all are old the newest stays", () => {
    const snap = (daysAgo: number) =>
      `insert into ops.quota_snapshots (at, plan, db_bytes, storage_bytes, mau_estimate, limits, levels) values ` +
      `(now() - interval '${daysAgo} days', 'free', 1, 0, 0, '{}', '{}')`;
    const { counts, rows } = run([snap(500), snap(401), snap(399), snap(1)], { Q: ages("ops.quota_snapshots", "at") });
    expect(rows.Q).toBe("399,1");
    expect(counts.quota_snapshots).toBe(2);
    expect(run([snap(600), snap(450)], { Q: ages("ops.quota_snapshots", "at") }).rows.Q).toBe("450");
  });

  it("backup runs older than 400 days go, except the newest run of each environment", () => {
    const backup = (env: string, daysAgo: number) =>
      `insert into ops.backup_runs (environment, started_at, created_at, status, error_code) values ` +
      `('${env}', now() - interval '${daysAgo} days', now() - interval '${daysAgo} days', 'failed', 'cleanup_spec')`;
    const { counts, rows } = run(
      [backup("staging", 500), backup("staging", 401), backup("staging", 399), backup("local", 700), backup("local", 450)],
      {
        S: ages("ops.backup_runs", "created_at", "environment = 'staging'"),
        L: ages("ops.backup_runs", "created_at", "environment = 'local'"),
      },
    );
    expect(rows.S).toBe("399");
    expect(rows.L).toBe("450");
    expect(counts.backup_runs).toBe(3);
  });

  it("error events not seen for 180 days go (V2-03 R-27 purge, with the old overflow counters)", () => {
    const event = (daysAgo: number) =>
      `insert into ops.error_events (fingerprint, occurred_on, first_seen, last_seen, count, environment, error_name, message) values ` +
      `(md5(random()::text) || md5(random()::text), (now() at time zone 'UTC')::date - ${daysAgo}, now() - interval '${daysAgo} days', ` +
      `now() - interval '${daysAgo} days', 1, 'test', 'Error', 'synthetic cleanup spec')`;
    const overflow = (daysAgo: number) =>
      `insert into ops.error_event_overflow (day, dropped) values ((now() at time zone 'UTC')::date - ${daysAgo}, 1)`;
    const { counts, rows } = run([event(181), event(179), event(0), overflow(200), overflow(10)], {
      E: ages("ops.error_events", "last_seen"),
      O: "select string_agg(((now() at time zone 'UTC')::date - day)::text, ',' order by day) from ops.error_event_overflow",
    });
    expect(rows.E).toBe("179,0");
    expect(rows.O).toBe("10");
    expect(counts.error_events).toBe(1);
  });

  it("returns a count per table and is a no-op on an empty or fresh state", () => {
    const { counts } = run([], {});
    expect(counts).toEqual({
      jobs_finished: 0,
      jobs_dead: 0,
      job_runner_runs: 0,
      inbound_webhook_events: 0,
      alerts: 0,
      heartbeats: 0,
      quota_snapshots: 0,
      backup_runs: 0,
      error_events: 0,
    });
  });

  it("is scheduled daily at 21:45 GMT (03:15 IST) as postgres", () => {
    expect(psql("select schedule || '|' || command || '|' || username from cron.job where jobname = 'ops-cleanup'")).toEqual([
      "45 21 * * *|select ops.cleanup()|postgres",
    ]);
  });
});
