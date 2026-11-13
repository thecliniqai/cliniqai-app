/**
 * V2-04 04-07c (review C L-1, L-4; migration 000042's `ops.evaluate_alerts()`), called directly inside `begin … rollback`
 * (the lanes pause pg_cron; nothing is committed), from the same emptied baseline as tests/jobs/alerts-db.spec.ts.
 *
 *   L-1  The cooldown is per rule, not per episode. The reviewer's flapping proof (open → resolve → re-open inside the
 *        cooldown) queued a second `alert.notify` job; now the re-opened episode waits, and is notified (notification 1)
 *        at the first evaluation after the rule's cooldown if it is still open. A notification that was only tried
 *        (never sent: a broken channel) also counts, so flapping cannot turn into one dead job per episode.
 *   L-4  R-51 stops retrying once the latest try died with `alert_channel_unconfigured`: the alert records
 *        `notify_stopped_code`, stays open and unsent (the ops report shows it), and no dead job is added every 15
 *        minutes. Any other death is still retried; clearing the code resumes the retries.
 */
import { describe, expect, it } from "vitest";
import { psqlSession } from "../helpers/sql";

const BASELINE = [
  "delete from ops.alerts",
  "delete from ops.jobs",
  "delete from ops.job_runner_runs",
  "delete from ops.backup_runs",
  "delete from ops.error_events",
  "delete from ops.error_event_overflow",
  "delete from ops.heartbeats",
  "delete from ops.quota_snapshots",
  "delete from vault.secrets where name = 'jobs_runner_url'",
  "delete from public.communication_queue where status = 'dead_letter'",
  "delete from public.webhook_delivery_queue where status = 'failed'",
  // Only dead_letter: the other rules stay out of every case.
  "update ops.alert_rules set enabled = (rule = 'dead_letter')",
];

const EVALUATE = "select 'E|' || ops.evaluate_alerts()";
const DEAD_ROW =
  "insert into ops.jobs (kind, dedupe_key, status, attempts, max_attempts, finished_at, last_error) values " +
  "('drill.probe', 'alert-review-spec:' || gen_random_uuid(), 'dead', 1, 1, now() - interval '1 minute', 'drill_failure')";
const CLEAR = "delete from ops.jobs where kind = 'drill.probe'";
const STATE =
  "select 'A|' || status || '|' || notify_count || '|' || notify_seq_enqueued || '|' || notify_tries || '|' || " +
  "coalesce(notify_stopped_code, '-') from ops.alerts order by first_seen, (status = 'open')";
const JOBS = "select 'J|' || dedupe_key || '|' || status from ops.jobs where kind = 'alert.notify' order by created_at, dedupe_key";
/** The previous episode's notification moved `minutes` into the past (sent, or only tried when `sent` is false). */
const previousNotified = (minutes: number, sent = true) =>
  "update ops.alerts set notify_enqueued_at = now() - interval '" + (minutes + 1) + " minutes'" +
  (sent ? ", notified_at = now() - interval '" + minutes + " minutes', notify_count = 1" : "") +
  " where status = 'resolved'";

function run(steps: string[]) {
  const lines = psqlSession(["begin", ...BASELINE, ...steps, STATE, JOBS, "rollback"]);
  return {
    alerts: lines.filter((l) => l.startsWith("A|")).map((l) => l.slice(2)),
    jobs: lines.filter((l) => l.startsWith("J|")).map((l) => l.slice(2).replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, "<id>")),
    other: lines.filter((l) => !/^[AJE]\|/.test(l)),
  };
}

/** Open → notified (job 1) → resolved by two clean evaluations → `between` → re-opened by a new dead row. */
const FLAP = (between: string[] = []) => [DEAD_ROW, EVALUATE, CLEAR, EVALUATE, EVALUATE, ...between, DEAD_ROW, EVALUATE];

describe("L-1: the alert cooldown is per rule (a flapping condition)", () => {
  it("the reviewer's proof: a re-opened episode inside the cooldown queues no second notification", () => {
    const out = run(FLAP());
    expect(out.alerts).toEqual(["resolved|0|1|1|-", "open|0|0|0|-"]);
    expect(out.jobs).toEqual(["alert:<id>:1|pending"]);
  });

  it("the same when the previous notification was sent 30 minutes ago, or only tried (never sent)", () => {
    expect(run(FLAP([previousNotified(30)])).jobs).toEqual(["alert:<id>:1|pending"]);
    expect(run(FLAP([previousNotified(30, false)])).jobs).toEqual(["alert:<id>:1|pending"]);
  });

  it("outside the cooldown the re-opened episode is notified at once (notification 1)", () => {
    const out = run(FLAP([previousNotified(61)]));
    expect(out.alerts).toEqual(["resolved|1|1|1|-", "open|0|1|1|-"]);
    expect(out.jobs).toEqual(["alert:<id>:1|pending", "alert:<id>:1|pending"]);
  });

  it("a deferred episode is notified at the first evaluation after the cooldown, if still open", () => {
    const out = run([...FLAP(), EVALUATE, previousNotified(61), EVALUATE, EVALUATE]);
    expect(out.alerts).toEqual(["resolved|1|1|1|-", "open|0|1|1|-"]);
    // One job for the first episode, exactly one (not one per evaluation) for the deferred one.
    expect(out.jobs).toHaveLength(2);
  });
});

describe("L-4: R-51 ends with a terminal state for alert_channel_unconfigured", () => {
  const tryDied = (code: string) =>
    `update ops.jobs set status = 'dead', finished_at = now(), last_error = '${code}' where kind = 'alert.notify'`;
  const triedAgo = (minutes: number) => `update ops.alerts set notify_enqueued_at = now() - interval '${minutes} minutes' where status = 'open'`;

  it("no retry after the try died unconfigured: notify_stopped_code set, the alert open and unsent, no new job", () => {
    const out = run([
      DEAD_ROW,
      EVALUATE,
      tryDied("alert_channel_unconfigured"),
      triedAgo(16),
      EVALUATE,
      triedAgo(120),
      EVALUATE,
      "select 'U|' || jsonb_path_exists(ops.report_all(48), '$.** ? (@.rule == \"dead_letter\" && @.unsent == true)')",
    ]);
    expect(out.alerts).toEqual(["open|0|1|1|alert_channel_unconfigured"]);
    expect(out.jobs).toEqual(["alert:<id>:1|dead"]);
    expect(out.other).toContain("U|true");
  });

  it("any other death is still retried (R-51), and clearing the code resumes the retries", () => {
    const other = run([DEAD_ROW, EVALUATE, tryDied("mailpit_unreachable"), triedAgo(16), EVALUATE]);
    expect(other.alerts).toEqual(["open|0|1|2|-"]);
    expect(other.jobs).toEqual(["alert:<id>:1|dead", "alert:<id>:1:r2|pending"]);

    const resumed = run([
      DEAD_ROW,
      EVALUATE,
      tryDied("alert_channel_unconfigured"),
      triedAgo(16),
      EVALUATE,
      "update ops.alerts set notify_stopped_code = null where status = 'open'",
      EVALUATE,
    ]);
    expect(resumed.alerts).toEqual(["open|0|1|2|-"]);
    expect(resumed.jobs).toEqual(["alert:<id>:1|dead", "alert:<id>:1:r2|pending"]);
  });

  it("only the one terminal code is accepted in notify_stopped_code", () => {
    expect(() => psqlSession(["begin", ...BASELINE, DEAD_ROW, EVALUATE, "update ops.alerts set notify_stopped_code = 'smtp_down'", "rollback"])).toThrow(
      /alerts_notify_stopped_code_check/,
    );
  });
});
