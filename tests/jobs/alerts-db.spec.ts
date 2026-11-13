/**
 * V2-04 04-04: `ops.evaluate_alerts()` and the nine rules of migration 000039, called directly (the lanes pause
 * pg_cron). Every case runs in ONE psql session inside `begin … rollback`: the session first empties what the rules
 * read (jobs, runner runs, backups, error events, the Vault runner URL, dead-lettered/failed delivery rows, alerts), so
 * other files' leftovers never decide a case, then seeds a synthetic condition, evaluates and reads the result. Nothing
 * a case writes is ever committed (Vitest runs one file at a time).
 *
 * Each rule fires on its condition and stays quiet just below it; a persistent condition inside the cooldown refreshes
 * the open alert (count + 1) without a second `alert.notify` job; an expired cooldown enqueues notification n + 1; two
 * clean evaluations resolve; a dead `alert.notify` job never raises `dead_letter` (R-36); a broken or disabled rule does
 * not stop the others; details carry only numbers, booleans, null, ISO timestamps and UUIDs; no API role reaches any of
 * it.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { getAdminClient } from "../helpers/supabase-admin";
import { psql, psqlSession } from "../helpers/sql";
import { anonClient } from "./helpers";
import { UUID_RE } from "./alert-helpers";

/** What every case starts from (inside its transaction). */
const BASELINE = [
  "delete from ops.alerts",
  "delete from ops.jobs",
  "delete from ops.job_runner_runs",
  "delete from ops.backup_runs",
  "delete from ops.error_events",
  "delete from ops.error_event_overflow",
  "delete from vault.secrets where name = 'jobs_runner_url'",
  "delete from public.communication_queue where status = 'dead_letter'",
  "delete from public.webhook_delivery_queue where status = 'failed'",
];

const EVALUATE = "select 'E|' || ops.evaluate_alerts()";
const ALERTS =
  "select 'A|' || id || '|' || rule || '|' || severity || '|' || status || '|' || count || '|' || clean_evaluations || '|' || " +
  "(resolved_at is not null) || '|' || details::text from ops.alerts order by first_seen, rule";
const NOTIFY_JOBS =
  "select 'J|' || (payload ->> 'alert_id') || '|' || (payload ->> 'seq') || '|' || dedupe_key || '|' || max_attempts || '|' || " +
  "coalesce(tenant_id::text, 'none') from ops.jobs where kind = 'alert.notify' order by created_at, dedupe_key";

interface Alert {
  id: string;
  rule: string;
  severity: string;
  status: string;
  count: number;
  clean: number;
  resolved: boolean;
  details: Record<string, unknown>;
}

interface NotifyJob {
  alertId: string;
  seq: number;
  dedupeKey: string;
  maxAttempts: number;
  tenant: string;
}

interface Outcome {
  /** ops.evaluate_alerts() results (number of firing rules), in call order. */
  firing: number[];
  alerts: Alert[];
  jobs: NotifyJob[];
  other: string[];
}

function parse(lines: string[]): Outcome {
  const out: Outcome = { firing: [], alerts: [], jobs: [], other: [] };
  for (const line of lines) {
    if (line.startsWith("E|")) out.firing.push(Number(line.slice(2)));
    else if (line.startsWith("A|")) {
      const [, id, rule, severity, status, count, clean, resolved, ...json] = line.split("|");
      out.alerts.push({
        id, rule, severity, status, count: Number(count), clean: Number(clean), resolved: resolved === "true",
        details: JSON.parse(json.join("|")) as Record<string, unknown>,
      });
    } else if (line.startsWith("J|")) {
      const [, alertId, seq, dedupeKey, maxAttempts, tenant] = line.split("|");
      out.jobs.push({ alertId, seq: Number(seq), dedupeKey, maxAttempts: Number(maxAttempts), tenant });
    } else out.other.push(line);
  }
  return out;
}

/** Baseline, `seed`, one evaluation (or the given steps), then the alerts and notify jobs; rolled back. */
function run(seed: string[], steps: string[] = [EVALUATE]): Outcome {
  return parse(psqlSession(["begin", ...BASELINE, ...seed, ...steps, ALERTS, NOTIFY_JOBS, "rollback"]));
}

function open(outcome: Outcome): string[] {
  return outcome.alerts.filter((a) => a.status === "open").map((a) => a.rule).sort();
}

// --- Synthetic seeds (SQL fragments; no row data from outside the spec) ---------------------------------------------

const deadJob = (ago = "1 minute", kind = "test.alerts_dead") =>
  `insert into ops.jobs (kind, dedupe_key, status, attempts, max_attempts, finished_at, last_error) values ` +
  `('${kind}', 'alerts-spec:' || gen_random_uuid(), 'dead', 2, 2, now() - interval '${ago}', 'drill_failure')`;

const pendingJob = (ago: string) =>
  `insert into ops.jobs (kind, dedupe_key, run_at) values ('test.alerts_pending', 'alerts-spec:' || gen_random_uuid(), now() - interval '${ago}')`;

/** `n` finished jobs first claimed now with `lagSeconds` between run_at and the claim. */
const claimedJobs = (n: number, lagSeconds: number) =>
  `insert into ops.jobs (kind, dedupe_key, status, attempts, run_at, first_claimed_at, finished_at) ` +
  `select 'test.alerts_lag', 'alerts-spec:' || gen_random_uuid(), 'done', 1, now() - make_interval(secs => ${lagSeconds}), now(), now() ` +
  `from generate_series(1, ${n})`;

const leaseExpiries = (n: number, ago = "1 minute") =>
  `insert into ops.jobs (kind, dedupe_key, status, attempts, finished_at, last_lease_expired_at) ` +
  `select 'test.alerts_lease', 'alerts-spec:' || gen_random_uuid(), 'done', 2, now(), now() - interval '${ago}' from generate_series(1, ${n})`;

const RUNNER_URL = "select 'V|' || vault.create_secret('https://runner.example.invalid/api/jobs/run', 'jobs_runner_url')";
const runnerRun = (ago: string, ok: boolean) =>
  `insert into ops.job_runner_runs (worker, source, started_at, finished_at, ok) values ` +
  `('test:alerts-spec', 'test', now() - interval '${ago}', now() - interval '${ago}' + interval '2 seconds', ${ok})`;

const errorEvents = (count: number, ago = "1 minute") =>
  `insert into ops.error_events (fingerprint, occurred_on, first_seen, last_seen, count, environment, error_name, message) values ` +
  `(md5(random()::text) || md5(random()::text), (now() at time zone 'UTC')::date, now() - interval '${ago}', ` +
  `now() - interval '${ago}', ${count}, 'test', 'Error', 'synthetic alerts spec')`;

const overflow = (daysAgo: number, dropped: number) =>
  `insert into ops.error_event_overflow (day, dropped) values ((now() at time zone 'UTC')::date - ${daysAgo}, ${dropped})`;

const backupRun = (hoursAgo: number, status: "ok" | "failed") =>
  status === "ok"
    ? `insert into ops.backup_runs (environment, started_at, finished_at, status, object_key, archive_bytes, duration_s) values ` +
      `('local', now() - interval '${hoursAgo} hours', now() - interval '${hoursAgo} hours' + interval '1 minute', 'ok', ` +
      `'local/2026-11-13T010203Z.tar.age', 1024, 60)`
    : `insert into ops.backup_runs (environment, started_at, finished_at, status, error_code) values ` +
      `('local', now() - interval '${hoursAgo} hours', now() - interval '${hoursAgo} hours' + interval '1 minute', 'failed', 'drill_forced')`;

const TENANT = "insert into public.tenants (id, name) values ('00000000-0000-4000-8000-00000000a1e7', 'Alerts spec clinic')";
const deadLetterMessage =
  "insert into public.communication_queue (tenant_id, channel, message_type, template_id, status, updated_at) values " +
  "('00000000-0000-4000-8000-00000000a1e7', 'whatsapp', 'appointment_reminder', 'appointment_reminder', 'dead_letter', now())";
const failedWebhook = () =>
  "with s as (insert into public.webhook_subscriptions (tenant_id, endpoint_url, event_types, signing_secret) values " +
  `('00000000-0000-4000-8000-00000000a1e7', 'https://hooks.example.invalid/x', array['visit.completed'], '${["not", "real", "signing", "value"].join("-")}') returning id) ` +
  "insert into public.webhook_delivery_queue (tenant_id, subscription_id, event_type, payload, status, updated_at) " +
  "select '00000000-0000-4000-8000-00000000a1e7', s.id, 'visit.completed', '{}', 'failed', now() from s";

const setParams = (rule: string, json: string) => `update ops.alert_rules set params = '${json}'::jsonb where rule = '${rule}'`;

// ---------------------------------------------------------------------------------------------------------------------

describe("ops.evaluate_alerts(): quiet baseline", () => {
  it("with nothing to report every rule is quiet: no alert, no notify job", () => {
    const out = run([]);
    expect(out.firing).toEqual([0]);
    expect(out.alerts).toEqual([]);
    expect(out.jobs).toEqual([]);
  });

  it("the nine rules are registered with the planned severities, enabled, each with its function", () => {
    const rows = psql("select rule || '|' || severity || '|' || enabled || '|' || fn from ops.alert_rules order by rule");
    expect(rows).toEqual([
      "backup_stale|critical|true|ops.alert_rule_backup_stale",
      "dead_letter|warn|true|ops.alert_rule_dead_letter",
      "error_burst|warn|true|ops.alert_rule_error_burst",
      "error_sink_overflow|warn|true|ops.alert_rule_error_sink_overflow",
      "error_sink_size|warn|true|ops.alert_rule_error_sink_size",
      "lease_expiry|warn|true|ops.alert_rule_lease_expiry",
      "queue_lag|warn|true|ops.alert_rule_queue_lag",
      "queue_oldest_due|critical|true|ops.alert_rule_queue_oldest_due",
      "runner_stale|critical|true|ops.alert_rule_runner_stale",
    ]);
  });
});

describe("dead_letter (warn)", () => {
  it("a dead job opens one alert and one alert.notify job; a second evaluation inside the cooldown only refreshes it", () => {
    const out = run([deadJob()], [EVALUATE, EVALUATE]);
    expect(out.firing).toEqual([1, 1]);
    expect(out.alerts).toHaveLength(1);
    const [alert] = out.alerts;
    expect(alert).toMatchObject({ rule: "dead_letter", severity: "warn", status: "open", count: 2, clean: 0 });
    expect(alert.details).toMatchObject({ window_minutes: 15, jobs_dead: 1, messages_dead_letter: 0, webhooks_failed: 0 });
    expect(alert.details.job_ids).toHaveLength(1);
    expect(out.jobs).toEqual([
      { alertId: alert.id, seq: 1, dedupeKey: `alert:${alert.id}:1`, maxAttempts: 5, tenant: "none" },
    ]);
  });

  it("a dead-lettered message row or a failed webhook delivery fires it too (counts only)", () => {
    const msg = run([TENANT, deadLetterMessage]);
    expect(msg.alerts).toEqual([expect.objectContaining({ rule: "dead_letter" })]);
    expect(msg.alerts[0].details).toMatchObject({ messages_dead_letter: 1, webhooks_failed: 0 });

    const hook = run([TENANT, failedWebhook()]);
    expect(hook.alerts.map((a) => a.rule)).toEqual(["dead_letter"]);
    expect(hook.alerts[0].details).toMatchObject({ messages_dead_letter: 0, webhooks_failed: 1 });
  });

  it("stays quiet for a job that died before the 15-minute window", () => {
    expect(run([deadJob("16 minutes")]).alerts).toEqual([]);
  });

  it("R-36: a dead alert.notify job never raises dead_letter", () => {
    const out = run([deadJob("1 minute", "alert.notify")]);
    expect(out.alerts).toEqual([]);
    expect(out.jobs).toEqual([]);
  });
});

describe("queue_lag (warn): p95 of first claim minus run_at over 15 minutes, at least 5 samples", () => {
  it("fires with p95 150 s over 5 samples", () => {
    const out = run([claimedJobs(5, 150)]);
    expect(open(out)).toEqual(["queue_lag"]);
    expect(out.alerts[0]).toMatchObject({ severity: "warn" });
    expect(out.alerts[0].details).toMatchObject({ samples: 5, p95_seconds: 150, threshold_seconds: 120, min_samples: 5 });
  });

  it("stays quiet with 4 slow samples, and when the p95 is under 120 s", () => {
    expect(run([claimedJobs(4, 150)]).alerts).toEqual([]);
    expect(run([claimedJobs(20, 10), claimedJobs(1, 150)]).alerts).toEqual([]);
    expect(run([claimedJobs(5, 119)]).alerts).toEqual([]);
  });
});

describe("queue_oldest_due (critical)", () => {
  it("fires when a due pending job has waited 6 minutes, naming its id", () => {
    const out = run([pendingJob("6 minutes")]);
    expect(open(out)).toEqual(["queue_oldest_due"]);
    const [alert] = out.alerts;
    expect(alert.severity).toBe("critical");
    expect(alert.details.threshold_minutes).toBe(5);
    expect(alert.details.oldest_due_seconds).toBeGreaterThanOrEqual(360);
    expect(alert.details.job_ids).toHaveLength(1);
  });

  it("stays quiet at 4 minutes", () => {
    expect(run([pendingJob("4 minutes")]).alerts).toEqual([]);
  });
});

describe("runner_stale (critical): Vault holds jobs_runner_url and no ok runner pass in 5 minutes", () => {
  it("fires with a runner URL in Vault and no runner pass, or only a failed one", () => {
    const none = run([RUNNER_URL]);
    expect(open(none)).toEqual(["runner_stale"]);
    expect(none.alerts[0]).toMatchObject({ severity: "critical" });
    expect(none.alerts[0].details).toEqual({ threshold_minutes: 5, last_ok_at: null });

    expect(open(run([RUNNER_URL, runnerRun("1 minute", false)]))).toEqual(["runner_stale"]);
    const old = run([RUNNER_URL, runnerRun("6 minutes", true)]);
    expect(open(old)).toEqual(["runner_stale"]);
    expect(String(old.alerts[0].details.last_ok_at)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it("stays quiet with a recent ok pass, and without the Vault secret (local and CI stacks)", () => {
    expect(run([RUNNER_URL, runnerRun("1 minute", true)]).alerts).toEqual([]);
    expect(run([]).alerts).toEqual([]);
  });
});

describe("lease_expiry (warn): more than 3 expired leases in 15 minutes", () => {
  it("fires with 4", () => {
    const out = run([leaseExpiries(4)]);
    expect(open(out)).toEqual(["lease_expiry"]);
    expect(out.alerts[0].details).toMatchObject({ lease_expiries: 4, threshold: 3, window_minutes: 15 });
    expect(out.alerts[0].details.job_ids).toHaveLength(4);
  });

  it("stays quiet with 3, and with 4 older than the window", () => {
    expect(run([leaseExpiries(3)]).alerts).toEqual([]);
    expect(run([leaseExpiries(4, "16 minutes")]).alerts).toEqual([]);
  });
});

describe("error_burst (warn): more than 20 error events in 10 minutes", () => {
  it("fires with 21 (one row, or several fingerprints)", () => {
    const one = run([errorEvents(21)]);
    expect(open(one)).toEqual(["error_burst"]);
    expect(one.alerts[0].details).toEqual({ window_minutes: 10, threshold: 20, events: 21, fingerprints: 1 });
    expect(open(run([errorEvents(11), errorEvents(10)]))).toEqual(["error_burst"]);
  });

  it("stays quiet with 20, and with 21 seen 11 minutes ago", () => {
    expect(run([errorEvents(20)]).alerts).toEqual([]);
    expect(run([errorEvents(21, "11 minutes")]).alerts).toEqual([]);
  });
});

describe("error_sink_overflow (warn, R-46): the sink dropped events today or yesterday (UTC)", () => {
  it("fires for an overflow row of today with dropped = 3, and for yesterday", () => {
    const today = run([overflow(0, 3)]);
    expect(open(today)).toEqual(["error_sink_overflow"]);
    expect(today.alerts[0].details).toMatchObject({ dropped_today: 3, dropped_yesterday: 0 });
    expect(open(run([overflow(1, 2)]))).toEqual(["error_sink_overflow"]);
  });

  it("stays quiet for an older day or a zero count", () => {
    expect(run([overflow(2, 5)]).alerts).toEqual([]);
    expect(run([overflow(0, 0)]).alerts).toEqual([]);
  });
});

describe("error_sink_size (warn, R-46): ops.error_events above the size parameter (default 50 MB)", () => {
  it("fires when the parameter is below the table's size (lowered in the rolled-back transaction)", () => {
    const out = run([setParams("error_sink_size", '{"max_bytes": 1}')]);
    expect(open(out)).toEqual(["error_sink_size"]);
    expect(out.alerts[0].details.max_bytes).toBe(1);
    expect(Number(out.alerts[0].details.bytes)).toBeGreaterThan(1);
  });

  it("stays quiet at the default threshold", () => {
    expect(psql("select params ->> 'max_bytes' from ops.alert_rules where rule = 'error_sink_size'")).toEqual(["50000000"]);
    expect(run([errorEvents(1)]).alerts).toEqual([]);
  });
});

describe("backup_stale (critical): backups recorded, none ok in 13 hours, or the latest run failed", () => {
  it("fires for a 14-hour-old ok run", () => {
    const out = run([backupRun(14, "ok")]);
    expect(open(out)).toEqual(["backup_stale"]);
    expect(out.alerts[0].severity).toBe("critical");
    expect(out.alerts[0].details).toMatchObject({ max_age_hours: 13, latest_run_failed: false, failed_runs: 0 });
  });

  it("a deliberately failed run raises it at once, even with an ok run 2 hours earlier", () => {
    const out = run([backupRun(2, "ok"), backupRun(0, "failed")]);
    expect(open(out)).toEqual(["backup_stale"]);
    expect(out.alerts[0].details).toMatchObject({ latest_run_failed: true, failed_runs: 1 });
    expect(open(run([backupRun(0, "failed")]))).toEqual(["backup_stale"]);
  });

  it("stays quiet with no backup rows, a recent ok run, or a failure an ok run already followed", () => {
    expect(run([]).alerts).toEqual([]);
    expect(run([backupRun(2, "ok")]).alerts).toEqual([]);
    expect(run([backupRun(3, "failed"), backupRun(1, "ok")]).alerts).toEqual([]);
  });
});

describe("lifecycle: cooldown, resolution, robustness", () => {
  it("two clean evaluations resolve an alert; firing again opens a new one with notification 1", () => {
    const out = run(
      [deadJob()],
      [
        EVALUATE,
        "delete from ops.jobs where kind = 'test.alerts_dead'",
        EVALUATE,
        "select 'C|' || clean_evaluations || '|' || status from ops.alerts",
        EVALUATE,
        deadJob(),
        EVALUATE,
      ],
    );
    expect(out.firing).toEqual([1, 0, 0, 1]);
    expect(out.other).toContain("C|1|open");
    expect(out.alerts.map((a) => [a.rule, a.status, a.resolved])).toEqual([
      ["dead_letter", "resolved", true],
      ["dead_letter", "open", false],
    ]);
    expect(out.jobs.map((j) => [j.alertId, j.seq])).toEqual([
      [out.alerts[0].id, 1],
      [out.alerts[1].id, 1],
    ]);
  });

  it("an expired cooldown enqueues notification n + 1; inside the cooldown, or never notified, nothing new", () => {
    const notifiedAgo = (minutes: number) =>
      `update ops.alerts set notified_at = now() - interval '${minutes} minutes', notify_count = 1 where rule = 'dead_letter'`;
    const expired = run([deadJob()], [EVALUATE, notifiedAgo(61), EVALUATE, EVALUATE]);
    const [alert] = expired.alerts;
    expect(expired.jobs.map((j) => [j.seq, j.dedupeKey])).toEqual([
      [1, `alert:${alert.id}:1`],
      [2, `alert:${alert.id}:2`],
    ]);
    expect(run([deadJob()], [EVALUATE, notifiedAgo(30), EVALUATE]).jobs).toHaveLength(1);
    // A send that never succeeded (notified_at null) is not retried by every evaluation (R-36; the ops report shows it).
    expect(
      run([deadJob()], [EVALUATE, "update ops.alerts set first_seen = now() - interval '1 day'", EVALUATE, EVALUATE]).jobs,
    ).toHaveLength(1);
  });

  it("a rule whose parameters break does not stop the others; a disabled rule never fires", () => {
    const out = run([setParams("dead_letter", '{"window_minutes": "x"}'), deadJob(), pendingJob("6 minutes")]);
    expect(open(out)).toEqual(["queue_oldest_due"]);
    const disabled = run(["update ops.alert_rules set enabled = false where rule = 'queue_oldest_due'", pendingJob("6 minutes")]);
    expect(disabled.alerts).toEqual([]);
  });

  it("with every rule firing, details hold only numbers, booleans, null, ISO timestamps and UUID lists", () => {
    const out = run([
      TENANT,
      deadJob(),
      deadLetterMessage,
      claimedJobs(5, 150),
      pendingJob("6 minutes"),
      RUNNER_URL,
      leaseExpiries(4),
      errorEvents(21),
      overflow(0, 3),
      setParams("error_sink_size", '{"max_bytes": 1}'),
      backupRun(14, "ok"),
    ]);
    expect(open(out)).toEqual([
      "backup_stale", "dead_letter", "error_burst", "error_sink_overflow", "error_sink_size",
      "lease_expiry", "queue_lag", "queue_oldest_due", "runner_stale",
    ]);
    expect(out.jobs).toHaveLength(9);
    const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
    for (const alert of out.alerts) {
      for (const [key, value] of Object.entries(alert.details)) {
        expect(key).toMatch(/^[a-z][a-z0-9_]*$/);
        const ok =
          value === null ||
          typeof value === "number" ||
          typeof value === "boolean" ||
          (typeof value === "string" && iso.test(value)) ||
          (Array.isArray(value) && value.length <= 10 && value.every((v) => typeof v === "string" && UUID_RE.test(v)));
        expect(ok, `${alert.rule}.${key}`).toBe(true);
      }
    }
  });
});

describe("access: nothing reachable from an API role", () => {
  const OPS_FUNCTIONS = [
    "ops.evaluate_alerts()",
    ...[
      "dead_letter", "queue_lag", "queue_oldest_due", "runner_stale", "lease_expiry",
      "error_burst", "error_sink_overflow", "error_sink_size", "backup_stale",
    ].map((r) => `ops.alert_rule_${r}(jsonb)`),
  ];
  const PUBLIC_FUNCTIONS = ["public.ops_alert_payload(uuid)", "public.ops_alert_notified(uuid,text,integer)"];

  it("no API role executes the evaluator or a rule; the handler RPCs are service_role only", () => {
    for (const fn of OPS_FUNCTIONS) {
      const [row] = psql(
        `select has_function_privilege('anon', '${fn}', 'execute') || '|' || has_function_privilege('authenticated', '${fn}', 'execute') ` +
          `|| '|' || has_function_privilege('service_role', '${fn}', 'execute')`,
      );
      expect(row, fn).toBe("false|false|false");
    }
    for (const fn of PUBLIC_FUNCTIONS) {
      const [row] = psql(
        `select has_function_privilege('anon', '${fn}', 'execute') || '|' || has_function_privilege('authenticated', '${fn}', 'execute') ` +
          `|| '|' || has_function_privilege('service_role', '${fn}', 'execute') || '|' || ` +
          `coalesce((select bool_or(a.grantee = 0) from pg_proc p, aclexplode(p.proacl) a where p.oid = '${fn}'::regprocedure), false)`,
      );
      expect(row, fn).toBe("false|false|true|false");
    }
  });

  it("every new function is SECURITY DEFINER with an empty search_path", () => {
    for (const fn of [...OPS_FUNCTIONS, ...PUBLIC_FUNCTIONS]) {
      const [row] = psql(`select prosecdef || '|' || array_to_string(proconfig, ',') from pg_proc where oid = '${fn}'::regprocedure`);
      expect(row, fn).toMatch(/^true\|search_path=""/);
    }
  });

  it("the tables are closed: RLS on, no policy, no privilege for anon, authenticated or service_role", () => {
    for (const table of ["ops.alerts", "ops.alert_rules"]) {
      expect(psql(`select relrowsecurity from pg_class where oid = '${table}'::regclass`)).toEqual(["t"]);
      expect(psql(`select count(*) from pg_policy where polrelid = '${table}'::regclass`)).toEqual(["0"]);
      for (const role of ["anon", "authenticated", "service_role"]) {
        const [row] = psql(
          `select has_table_privilege('${role}', '${table}', 'select') or has_table_privilege('${role}', '${table}', 'insert') ` +
            `or has_table_privilege('${role}', '${table}', 'update') or has_table_privilege('${role}', '${table}', 'delete')`,
        );
        expect(row, `${role} on ${table}`).toBe("f");
      }
    }
  });

  it("through PostgREST: anon is refused the handler RPCs; the service role reads nothing for an unknown alert", async () => {
    const anon = anonClient();
    const payload = await anon.rpc("ops_alert_payload", { p_alert_id: randomUUID() });
    expect(payload.error?.code).toBe("42501");
    const notified = await anon.rpc("ops_alert_notified", { p_alert_id: randomUUID(), p_provider_message_id: "x", p_seq: 1 });
    expect(notified.error?.code).toBe("42501");
    const sys = await getAdminClient().rpc("ops_alert_payload", { p_alert_id: randomUUID() });
    expect(sys.error).toBeNull();
    expect(sys.data).toBeNull();
  });

  it("ops_alert_notified is idempotent per notification and keeps only an id-shaped provider id", () => {
    const lines = psqlSession([
      "begin",
      "delete from ops.alerts",
      "insert into ops.alerts (id, rule, severity) values ('00000000-0000-4000-8000-0000000a1e70', 'dead_letter', 'warn')",
      "select 'N|' || public.ops_alert_notified('00000000-0000-4000-8000-0000000a1e70', 'mailpit-id-1', 1)",
      "select 'N|' || public.ops_alert_notified('00000000-0000-4000-8000-0000000a1e70', 'mailpit-id-again', 1)",
      "select 'S|' || notify_count || '|' || provider_message_id from ops.alerts",
      "select 'N|' || public.ops_alert_notified('00000000-0000-4000-8000-0000000a1e70', 'free text with spaces +919000000001', 2)",
      "select 'S|' || notify_count || '|' || coalesce(provider_message_id, 'null') || '|' || (notified_at is not null) from ops.alerts",
      "rollback",
    ]);
    expect(lines).toEqual(["N|true", "N|false", "S|1|mailpit-id-1", "N|true", "S|2|null|true"]);
  });

  it("pg_cron evaluates every 5 minutes as postgres (one row; the lane paused it)", () => {
    expect(psql("select schedule || '|' || command || '|' || username from cron.job where jobname = 'ops-evaluate-alerts'")).toEqual([
      "*/5 * * * *|select ops.evaluate_alerts()|postgres",
    ]);
  });
});
