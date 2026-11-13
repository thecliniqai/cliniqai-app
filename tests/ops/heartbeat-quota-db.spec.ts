/**
 * V2-04 04-06: heartbeat (FT-03) and quota monitor (FT-04, R-8) on the local stack, called directly (the lanes pause
 * pg_cron).
 *
 *   - `ops.heartbeat()` writes a `pg_cron` row; `ops-heartbeat` runs every 6 hours at minute 0; the newest heartbeat aged
 *     7 h 1 min raises `heartbeat_gap` (6 h 59 min, none at all, or a fresh one after an old one: quiet).
 *   - `ops.quota_snapshot()` reports the database size, the Storage bytes (one synthetic object uploaded through the
 *     Storage API adds exactly its size) and the MAU estimate (seeded sign-ins this UTC month count, last month's not).
 *   - With the Free database limit lowered by the test (rolled back) so usage is 65 % → `quota_upgrade_trigger` only;
 *     at 72 % → `quota_critical` only; the details carry the level words and percentages.
 *   - The weekly summary opens one `info` alert per ISO week with its `alert.notify` job; it is re-tried while unsent
 *     (R-51) and, delivered through the real handler and Mailpit, sends exactly one email that names the levels and
 *     the egress reminder; two clean evaluations later it is resolved and nothing else is sent.
 *
 * Rolled-back sessions start from a baseline that empties what the rules read, so other files' leftovers never decide
 * a case. The committed email case starts from and leaves an empty `ops.alerts` (alert-helpers).
 */
import { randomBytes } from "node:crypto";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { getJobHandlers } from "@/lib/jobs/internal/registry";
import { getAdminClient } from "../helpers/supabase-admin";
import { psql, psqlSession } from "../helpers/sql";
import { deleteRunnerRuns } from "../jobs/helpers";
import {
  alertFor,
  deleteMail,
  mailForAlert,
  mailMessage,
  notifyJobsFor,
  resetAlertState,
  runKinds,
  useMailpitAlerts,
} from "../jobs/alert-helpers";

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
];

const EVALUATE = "select 'E|' || ops.evaluate_alerts()";
const OPEN_ALERTS = "select 'A|' || rule || '|' || severity || '|' || details::text from ops.alerts where status = 'open' order by rule";

interface OpenAlert {
  rule: string;
  severity: string;
  details: Record<string, unknown>;
}

/** Baseline, `steps`, then the open alerts; rolled back. Lines not starting with A| are returned in `other`. */
function session(steps: string[]): { open: OpenAlert[]; other: string[] } {
  const lines = psqlSession(["begin", ...BASELINE, ...steps, OPEN_ALERTS, "rollback"]);
  const open: OpenAlert[] = [];
  const other: string[] = [];
  for (const line of lines) {
    if (line.startsWith("A|")) {
      const [, rule, severity, ...json] = line.split("|");
      open.push({ rule, severity, details: JSON.parse(json.join("|")) as Record<string, unknown> });
    } else other.push(line);
  }
  return { open, other };
}

const heartbeatAgo = (ago: string) => `insert into ops.heartbeats (at) values (now() - interval '${ago}')`;
const SNAPSHOT = "select 'S|' || ops.quota_snapshot()::text";
const snapshotOf = (other: string[]) =>
  other.filter((l) => l.startsWith("S|")).map((l) => JSON.parse(l.slice(2)) as Record<string, unknown> & { levels: Record<string, string> });

describe("heartbeat (FT-03)", () => {
  it("ops.heartbeat() writes one pg_cron row at now()", () => {
    const lines = psqlSession([
      "begin",
      "delete from ops.heartbeats",
      "select 'H|' || (ops.heartbeat() = now())",
      "select 'R|' || count(*) || '|' || string_agg(source, ',') || '|' || bool_and(at = now()) from ops.heartbeats",
      "rollback",
    ]);
    expect(lines).toEqual(["H|true", "R|1|pg_cron|true"]);
  });

  it("the four 04-06 schedules are registered once each, as postgres (the lane paused them)", () => {
    expect(
      psql(
        "select jobname || '|' || schedule || '|' || command || '|' || username from cron.job " +
          "where jobname in ('ops-heartbeat', 'ops-quota-snapshot', 'ops-quota-weekly-summary', 'ops-cleanup') order by jobname",
      ),
    ).toEqual([
      "ops-cleanup|45 21 * * *|select ops.cleanup()|postgres",
      "ops-heartbeat|0 */6 * * *|select ops.heartbeat()|postgres",
      "ops-quota-snapshot|30 21 * * *|select ops.quota_snapshot()|postgres",
      "ops-quota-weekly-summary|30 3 * * 1|select ops.enqueue_quota_weekly_summary()|postgres",
    ]);
  });

  it("the newest heartbeat aged 7 h 1 min raises heartbeat_gap (warn) with the age; 6 h 59 min does not", () => {
    const stale = session([heartbeatAgo("30 hours"), heartbeatAgo("7 hours 1 minute"), EVALUATE]);
    expect(stale.open.map((a) => [a.rule, a.severity])).toEqual([["heartbeat_gap", "warn"]]);
    expect(stale.open[0].details).toMatchObject({ max_age_minutes: 420, age_minutes: 421 });
    expect(stale.open[0].details.last_heartbeat_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);

    expect(session([heartbeatAgo("6 hours 59 minutes"), EVALUATE]).open).toEqual([]);
    expect(session([heartbeatAgo("30 hours"), heartbeatAgo("1 minute"), EVALUATE]).open).toEqual([]);
    // No heartbeat at all (a stack without the schedule having fired): quiet.
    expect(session([EVALUATE]).open).toEqual([]);
  });
});

describe("quota snapshot (FT-04)", () => {
  const bucket = `quota-spec-${randomBytes(4).toString("hex")}`;
  afterAll(async () => {
    const admin = getAdminClient();
    await admin.storage.from(bucket).remove(["synthetic.bin"]);
    await admin.storage.deleteBucket(bucket);
  });

  it("reports db_bytes, Storage bytes (an uploaded synthetic object adds its size) and the MAU estimate", async () => {
    const before = snapshotOf(session([SNAPSHOT]).other)[0];
    const admin = getAdminClient();
    const size = 70_001;
    expect((await admin.storage.createBucket(bucket, { public: false })).error).toBeNull();
    expect((await admin.storage.from(bucket).upload("synthetic.bin", randomBytes(size), { contentType: "application/octet-stream" })).error).toBeNull();

    const { other } = session([
      SNAPSHOT,
      // Three users signed in this UTC month and one just before it: the estimate counts the three.
      "insert into auth.users (id, instance_id, aud, role, email, last_sign_in_at) select gen_random_uuid(), " +
        "'00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'quota-spec-' || g || '@example.test', now() " +
        "from generate_series(1, 3) g",
      "insert into auth.users (id, instance_id, aud, role, email, last_sign_in_at) values (gen_random_uuid(), " +
        "'00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'quota-spec-old@example.test', " +
        "(date_trunc('month', now() at time zone 'UTC') at time zone 'UTC') - interval '1 second')",
      SNAPSHOT,
      "select 'D|' || pg_database_size(current_database())",
    ]);
    const [uploaded, signedIn] = snapshotOf(other);
    expect(uploaded.storage_bytes).toBeGreaterThanOrEqual(size);
    expect(Number(uploaded.storage_bytes) - Number(before.storage_bytes)).toBe(size);
    expect(Number(uploaded.db_bytes)).toBeGreaterThan(0);
    const dbSize = Number(other.find((l) => l.startsWith("D|"))!.slice(2));
    expect(Math.abs(Number(signedIn.db_bytes) - dbSize)).toBeLessThan(1_000_000);
    expect(Number(signedIn.mau_estimate) - Number(uploaded.mau_estimate)).toBe(3);
    expect(signedIn).toMatchObject({ plan: "free", limits: { db_bytes: 500000000, storage_bytes: 1000000000, mau: 50000 } });
    expect(signedIn.levels).toEqual({ db_bytes: "ok", storage_bytes: "ok", mau: "ok" });
  });

  const dbLimitAt = (fraction: number) =>
    `update ops.quota_limits set limit_value = ceil(pg_database_size(current_database()) / ${fraction}) where plan = 'free' and metric = 'db_bytes'`;

  it("database usage at 65 % of the (lowered) Free limit raises quota_upgrade_trigger (warn) and not quota_critical", () => {
    const { open, other } = session([dbLimitAt(0.65), SNAPSHOT, EVALUATE]);
    expect(snapshotOf(other)[0].levels).toEqual({ db_bytes: "upgrade_trigger", storage_bytes: "ok", mau: "ok" });
    expect(open.map((a) => [a.rule, a.severity])).toEqual([["quota_upgrade_trigger", "warn"]]);
    expect(open[0].details).toMatchObject({ db_level: "upgrade_trigger", storage_level: "ok", mau_level: "ok", mau_limit: 50000 });
    expect(Number(open[0].details.db_percent)).toBeGreaterThanOrEqual(64.5);
    expect(Number(open[0].details.db_percent)).toBeLessThan(65.5);
  });

  it("database usage at 72 % raises quota_critical (critical) and not quota_upgrade_trigger", () => {
    const { open, other } = session([dbLimitAt(0.72), SNAPSHOT, EVALUATE]);
    expect(snapshotOf(other)[0].levels.db_bytes).toBe("critical");
    expect(open.map((a) => [a.rule, a.severity])).toEqual([["quota_critical", "critical"]]);
    expect(open[0].details).toMatchObject({ db_level: "critical" });
    expect(Number(open[0].details.db_percent)).toBeGreaterThanOrEqual(71.5);
  });

  it("the rules read the newest snapshot only: a later ok snapshot clears them", () => {
    const { open } = session([dbLimitAt(0.72), SNAPSHOT, "update ops.quota_limits set limit_value = 500000000 where plan = 'free' and metric = 'db_bytes'", SNAPSHOT, EVALUATE]);
    expect(open).toEqual([]);
    // Storage at 65 % and MAU at 70 % at once: critical wins (one alert per level, never both).
    const mixed = session([
      "update ops.quota_limits set limit_value = 1 where plan = 'free' and metric = 'mau'",
      "insert into auth.users (id, instance_id, aud, role, email, last_sign_in_at) values (gen_random_uuid(), " +
        "'00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'quota-spec-mau@example.test', now())",
      SNAPSHOT,
      EVALUATE,
    ]);
    expect(mixed.open.map((a) => a.rule)).toEqual(["quota_critical"]);
    expect(mixed.open[0].details.mau_level).toBe("critical");
  });
});

describe("weekly quota summary (R-8)", () => {
  const WEEKLY = "select 'W|' || coalesce(ops.enqueue_quota_weekly_summary()::text, 'null')";
  const WEEKLY_ROWS =
    "select 'Q|' || a.id || '|' || a.severity || '|' || a.status || '|' || a.notify_seq_enqueued || '|' || " +
    "(select string_agg(j.dedupe_key, ',' order by j.created_at) from ops.jobs j where j.kind = 'alert.notify' and j.payload ->> 'alert_id' = a.id::text) " +
    "from ops.alerts a where a.rule = 'quota_weekly_summary' order by a.first_seen";

  it("opens one info alert per ISO week with its alert.notify job; a second call the same week does nothing", () => {
    const { other } = session([WEEKLY, WEEKLY, WEEKLY_ROWS, "select 'C|' || count(*) from ops.quota_snapshots"]);
    const calls = other.filter((l) => l.startsWith("W|"));
    expect(calls[0]).toMatch(/^W\|[0-9a-f-]{36}$/);
    expect(calls[1]).toBe("W|null");
    const rows = other.filter((l) => l.startsWith("Q|")).map((l) => l.split("|"));
    expect(rows).toHaveLength(1);
    const [, id, severity, status, seq, keys] = rows[0];
    expect([severity, status, seq, keys]).toEqual(["info", "open", "1", `alert:${id}:1`]);
    // From a fresh snapshot (one taken by the first call only).
    expect(other).toContain("C|1");
  });

  it("the next ISO week opens a new one (the previous week's is resolved); a disabled rule opens none", () => {
    const { other } = session([
      WEEKLY,
      "update ops.alerts set first_seen = first_seen - interval '7 days', status = 'resolved', resolved_at = now() where rule = 'quota_weekly_summary'",
      WEEKLY,
      WEEKLY_ROWS,
    ]);
    const rows = other.filter((l) => l.startsWith("Q|")).map((l) => l.split("|"));
    expect(rows.map((r) => r[3])).toEqual(["resolved", "open"]);
    const disabled = session(["update ops.alert_rules set enabled = false where rule = 'quota_weekly_summary'", WEEKLY, WEEKLY_ROWS]);
    expect(disabled.other).toEqual(["W|null"]);
  });

  it("carries the three metrics, their levels and the ISO week; the evaluator keeps it open while unsent and re-tries it after 15 min (R-51)", () => {
    const { open, other } = session([
      WEEKLY,
      EVALUATE,
      // Its first try died (e.g. provider down) more than 15 minutes ago: the next evaluation enqueues try 2.
      "update ops.jobs set status = 'dead', finished_at = now(), last_error = 'mailpit_unreachable' where kind = 'alert.notify'",
      "update ops.alerts set notify_enqueued_at = now() - interval '16 minutes' where rule = 'quota_weekly_summary'",
      EVALUATE,
      WEEKLY_ROWS,
    ]);
    expect(open.map((a) => [a.rule, a.severity])).toEqual([["quota_weekly_summary", "info"]]);
    const d = open[0].details;
    for (const key of ["db_bytes", "db_limit_bytes", "db_percent", "storage_bytes", "storage_limit_bytes", "storage_percent", "mau_estimate", "mau_limit", "mau_percent", "iso_year", "iso_week"]) {
      expect(typeof d[key], key).toBe("number");
    }
    expect(d).toMatchObject({ db_level: "ok", storage_level: "ok", mau_level: "ok" });
    const [row] = other.filter((l) => l.startsWith("Q|")).map((l) => l.split("|"));
    expect(row[5]).toBe(`alert:${row[1]}:1,alert:${row[1]}:1:r2`);
  });
});

describe("weekly quota summary email (committed, Mailpit)", () => {
  const WORKER = "test:quota-weekly";
  const mailIds: string[] = [];
  const startedAt = psql("select now()")[0];

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    resetAlertState();
    deleteRunnerRuns(WORKER);
    psql(`delete from ops.quota_snapshots where at >= '${startedAt}'::timestamptz`);
    await deleteMail(mailIds);
  });

  it("sends exactly one email naming the levels and the egress reminder; then resolves and sends nothing more", async () => {
    resetAlertState();
    useMailpitAlerts();
    const [id] = psql("select ops.enqueue_quota_weekly_summary()");
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(psql("select coalesce(ops.enqueue_quota_weekly_summary()::text, 'null')")).toEqual(["null"]);

    const result = await runKinds(["alert.notify"], getJobHandlers(), WORKER);
    expect(result).toMatchObject({ ok: true, claimed: 1, done: 1, dead: 0 });
    const found = await mailForAlert(id);
    mailIds.push(...found.map((m) => m.ID));
    expect(found).toHaveLength(1);
    const message = await mailMessage(found[0].ID);
    expect(message.Subject).toBe("[clinicos test] INFO quota_weekly_summary");
    expect(message.Text).toContain("db_level: ok");
    expect(message.Text).toContain("storage_level: ok");
    expect(message.Text).toContain("mau_level: ok");
    expect(message.Text).toMatch(/db_percent: \d+(\.\d)?\n/);
    expect(message.Text).toContain("Egress is not measured here");
    expect(message.Text).toContain("Runbook: docs/runbooks/jobs.md#quota_weekly_summary");
    expect(message.Text).not.toContain("omitted");
    expect(alertFor("quota_weekly_summary")).toMatchObject({ notifyCount: 1, notified: true });

    // Sent: the rule stops firing; two clean evaluations resolve it; no new job, no second email.
    psql("select ops.evaluate_alerts()");
    psql("select ops.evaluate_alerts()");
    expect(psql(`select status from ops.alerts where id = '${id}'`)).toEqual(["resolved"]);
    expect(notifyJobsFor(id).map((j) => j.dedupeKey)).toEqual([`alert:${id}:1`]);
    await runKinds(["alert.notify"], getJobHandlers(), WORKER);
    expect(await mailForAlert(id)).toHaveLength(1);
  });
});

describe("access: the new tables and functions are closed to every API role", () => {
  const TABLES = ["ops.heartbeats", "ops.settings", "ops.quota_limits", "ops.quota_snapshots"];
  const FUNCTIONS = [
    "ops.heartbeat()",
    "ops.quota_snapshot()",
    "ops.quota_details(bigint)",
    "ops.enqueue_quota_weekly_summary()",
    "ops.cleanup()",
    "ops.report_all(integer)",
    "ops.alert_rule_heartbeat_gap(jsonb)",
    "ops.alert_rule_quota_upgrade_trigger(jsonb)",
    "ops.alert_rule_quota_critical(jsonb)",
    "ops.alert_rule_quota_weekly_summary(jsonb)",
  ];

  it("tables: RLS on, no policy, no privilege for anon, authenticated or service_role", () => {
    for (const table of TABLES) {
      expect(psql(`select relrowsecurity from pg_class where oid = '${table}'::regclass`), table).toEqual(["t"]);
      expect(psql(`select count(*) from pg_policy where polrelid = '${table}'::regclass`), table).toEqual(["0"]);
      for (const role of ["anon", "authenticated", "service_role"]) {
        const [row] = psql(
          `select has_table_privilege('${role}', '${table}', 'select') or has_table_privilege('${role}', '${table}', 'insert') ` +
            `or has_table_privilege('${role}', '${table}', 'update') or has_table_privilege('${role}', '${table}', 'delete')`,
        );
        expect(row, `${role} on ${table}`).toBe("f");
      }
    }
  });

  it("functions: SECURITY DEFINER with an empty search_path, executable by no API role and not by PUBLIC", () => {
    for (const fn of [...FUNCTIONS, "ops.utc_text(timestamptz)", "ops.quota_level(numeric,numeric)"]) {
      const [row] = psql(
        `select has_function_privilege('anon', '${fn}', 'execute') || '|' || has_function_privilege('authenticated', '${fn}', 'execute') ` +
          `|| '|' || has_function_privilege('service_role', '${fn}', 'execute') || '|' || ` +
          `coalesce((select bool_or(a.grantee = 0) from pg_proc p, aclexplode(p.proacl) a where p.oid = '${fn}'::regprocedure), false)`,
      );
      expect(row, fn).toBe("false|false|false|false");
    }
    for (const fn of FUNCTIONS) {
      const [row] = psql(`select prosecdef || '|' || array_to_string(proconfig, ',') from pg_proc where oid = '${fn}'::regprocedure`);
      expect(row, fn).toMatch(/^true\|search_path=""/);
    }
  });

  it("the four rules are registered with their severities, functions and cooldowns", () => {
    expect(
      psql(
        "select rule || '|' || severity || '|' || enabled || '|' || fn || '|' || cooldown_minutes || '|' || params::text from ops.alert_rules " +
          "where rule in ('heartbeat_gap', 'quota_upgrade_trigger', 'quota_critical', 'quota_weekly_summary') order by rule",
      ),
    ).toEqual([
      'heartbeat_gap|warn|true|ops.alert_rule_heartbeat_gap|360|{"max_age_minutes": 420}',
      "quota_critical|critical|true|ops.alert_rule_quota_critical|1440|{}",
      "quota_upgrade_trigger|warn|true|ops.alert_rule_quota_upgrade_trigger|1440|{}",
      'quota_weekly_summary|info|true|ops.alert_rule_quota_weekly_summary|10080|{"deliver_hours": 24}',
    ]);
  });
});
