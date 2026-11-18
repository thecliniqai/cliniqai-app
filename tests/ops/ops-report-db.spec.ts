/**
 * V2-04 04-06 (R-28; threats T-04-10, T-04-17): the staging ops report end to end on the local stack.
 *
 *   - Tracer: `ops.heartbeat()` and `ops.quota_snapshot()` rows are read back by `ops.report_all()` and the report is
 *     accepted by `scripts/ops/check-ops-report.ts` (schema and PII clean, quota and heartbeat blocks filled).
 *   - Counts only: with a synthetic phone, email and patient name seeded into the queue tables, a job payload, a job
 *     error and the inbound dedupe store, the report holds none of them and only its own keys.
 *   - The figures match seeded data: lag p50/p95/max, heartbeat and runner gaps, alert delivery facts, backups.
 *   - `scripts/ops/ops-report.mjs` runs the real read-only guard and report through psql on this database: the
 *     `postgres` credentials are refused (role attributes), and so is a role that can write a table, a role that is a
 *     member of another role, and a transaction that is not read-only; a role shaped like `clinicos_drift_ro` with the
 *     04-P10 grant gets a report the checker accepts; without the grant the script points at 04-P10.
 *
 * Every database case runs inside `begin … rollback` (the probe roles too): nothing is committed.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { checkOpsReport, type OpsReport } from "@/scripts/ops/check-ops-report";
import { READ_ONLY_GUARD_SQL, runOpsReport } from "@/scripts/ops/ops-report.mjs";
import { localDbContainer, psql, psqlSession } from "../helpers/sql";
import { anonClient } from "../jobs/helpers";

const BASELINE = [
  "delete from ops.alerts",
  "delete from ops.jobs",
  "delete from ops.job_runner_runs",
  "delete from ops.heartbeats",
  "delete from ops.quota_snapshots",
  "delete from ops.backup_runs",
];

/** Baseline, `seed`, then the report (one line); rolled back. */
function report(seed: string[], hours = 48): { report: OpsReport & Record<string, unknown>; text: string } {
  const lines = psqlSession(["begin", ...BASELINE, ...seed, `select 'R|' || ops.report_all(${hours})::text`, "rollback"]);
  const line = lines.find((l) => l.startsWith("R|"));
  if (!line) throw new Error("no report line");
  const text = line.slice(2);
  return { report: JSON.parse(text) as OpsReport & Record<string, unknown>, text };
}

const TOP_KEYS = [
  "alerts", "backups", "dead_last_24h", "generated_at", "heartbeats", "jobs", "quota", "report_version", "runner", "tables",
  "window_hours",
];

// Synthetic PII (never a real person): a phone in the synthetic range, an example.test email, an invented name.
const PHONE = "+919000000071";
const PHONE_BARE = "9000000071";
const EMAIL = "quota.report.patient@example.test";
const NAME = "Synthetic Reportpatient";
const TENANT_ID = "00000000-0000-4000-8000-0000000a0e06";

describe("ops.report_all (tracer): heartbeat and quota rows read back and accepted by the checker", () => {
  it("one heartbeat and one quota snapshot appear in the report; check-ops-report passes schema and PII", () => {
    const { report: r } = report(["select ops.heartbeat()", "select ops.quota_snapshot()"]);
    expect(Object.keys(r).sort()).toEqual(TOP_KEYS);
    expect(r.report_version).toBe(1);
    expect(r.window_hours).toBe(48);
    expect(r.heartbeats.count).toBe(1);
    expect(r.heartbeats.at).toHaveLength(1);
    expect(r.heartbeats.last_at).toBe(r.heartbeats.at[0]);
    expect(r.quota).not.toBeNull();
    expect(r.quota!.plan).toBe("free");
    expect(r.quota!.db_bytes).toBeGreaterThan(0);
    expect(Object.keys(r.quota!.levels).sort()).toEqual(["db_bytes", "mau", "storage_bytes"]);
    expect(r.quota!.limits).toEqual({ db_bytes: 500000000, storage_bytes: 1000000000, mau: 50000 });

    const check = checkOpsReport(r, ["quota"]);
    expect(check.schema).toEqual({ ok: true, problems: [] });
    expect(check.pii).toEqual({ ok: true, problems: [] });
    expect(check.ok).toBe(true);
    expect(check.requirements!.quota.pass).toBe(true);
    // One heartbeat a moment ago covers seconds, not 24 h: the heartbeat requirement is reported as not met.
    expect(check.requirements!.heartbeat.pass).toBe(false);
  });

  it("an empty window: null figures, empty lists, no quota; still schema-valid", () => {
    const { report: r } = report([]);
    expect(r.jobs).toEqual({ by_kind_status: [], lag: { samples: 0, p50_seconds: null, p95_seconds: null, max_seconds: null } });
    expect(r.dead_last_24h).toEqual({ total: 0, by_kind: [] });
    expect(r.alerts).toEqual([]);
    expect(r.backups).toEqual([]);
    expect(r.quota).toBeNull();
    expect(r.heartbeats).toEqual({ count: 0, at: [], largest_gap_seconds: null, covered_seconds: null, last_at: null });
    expect(r.runner).toMatchObject({ runs: 0, ok_runs: 0, largest_ok_gap_seconds: null, last_ok_age_seconds: null });
    expect(checkOpsReport(r).schema.ok).toBe(true);
  });

  it("refuses a window outside 1..336 hours", () => {
    for (const hours of [0, 337]) {
      expect(() => psql(`select ops.report_all(${hours})`)).toThrow(/invalid_report_window/);
    }
  });
});

describe("ops.report_all: counts only (T-04-10, T-04-17)", () => {
  it("synthetic phone, email and name in the queue, a job payload, a job error and the inbound store never reach the report", () => {
    const seed = [
      `insert into public.tenants (id, name) values ('${TENANT_ID}', '${NAME} Clinic')`,
      "insert into public.communication_queue (tenant_id, channel, message_type, template_id, template_params, recipient_phone, status, error_message) values " +
        `('${TENANT_ID}', 'whatsapp', 'appointment_reminder', 'appointment_reminder', '{"patient_name": "${NAME}", "email": "${EMAIL}"}', '${PHONE}', 'dead_letter', 'failed for ${PHONE}')`,
      "insert into ops.jobs (kind, tenant_id, payload, dedupe_key, status, attempts, max_attempts, finished_at, last_error) values " +
        `('test.report_pii', '${TENANT_ID}', '{"phone": "${PHONE}", "email": "${EMAIL}", "name": "${NAME}"}', 'report-spec:${PHONE_BARE}', 'dead', 1, 1, now(), 'boom ${PHONE} ${EMAIL}')`,
      `insert into ops.inbound_webhook_events (provider, dedupe_key) values ('msg91', 'report-spec:${PHONE}')`,
      "select ops.heartbeat()",
      "select ops.quota_snapshot()",
    ];
    const { report: r, text } = report(seed);
    for (const secret of [PHONE, PHONE_BARE, EMAIL, NAME, "Reportpatient", TENANT_ID]) expect(text).not.toContain(secret);
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
    expect(Object.keys(r).sort()).toEqual(TOP_KEYS);
    // The rows are counted, by kind and status only.
    expect(r.jobs.by_kind_status).toContainEqual({ kind: "test.report_pii", status: "dead", count: 1 });
    expect(r.dead_last_24h).toEqual({ total: 1, by_kind: [{ kind: "test.report_pii", count: 1 }] });
    expect(r.tables.inbound_webhook_events).toBeGreaterThanOrEqual(1);
    const check = checkOpsReport(r);
    expect(check.schema.ok).toBe(true);
    expect(check.pii.ok).toBe(true);
  });
});

describe("ops.report_all: figures match the seeded data", () => {
  /** n done jobs first claimed now with the given lags (seconds). */
  const lagged = (lags: number[]) =>
    "insert into ops.jobs (kind, dedupe_key, status, attempts, run_at, first_claimed_at, finished_at) " +
    `select 'test.report_lag', 'report-spec:' || gen_random_uuid(), 'done', 1, now() - make_interval(secs => l), now(), now() ` +
    `from unnest(array[${lags.join(",")}]) l`;

  it("lag p50/p95/max over jobs first claimed in the window (percentile_cont, 0.1 s)", () => {
    const { report: r } = report([
      lagged([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]),
      // Outside the window (first claimed 49 h ago) and a retried row whose run_at moved past its claim: not samples.
      "insert into ops.jobs (kind, dedupe_key, status, attempts, run_at, first_claimed_at, finished_at) values " +
        "('test.report_lag', 'report-spec:old', 'done', 1, now() - interval '49 hours 10 minutes', now() - interval '49 hours', now()), " +
        "('test.report_lag', 'report-spec:moved', 'done', 2, now() + interval '1 minute', now(), now())",
    ]);
    expect(r.jobs.lag).toEqual({ samples: 10, p50_seconds: 55, p95_seconds: 95.5, max_seconds: 100 });
    expect(r.jobs.by_kind_status).toEqual([{ kind: "test.report_lag", status: "done", count: 12 }]);
  });

  it("heartbeat and runner gaps: consecutive gaps and the last one to now; coverage from the first in the window", () => {
    const { report: r } = report([
      "insert into ops.heartbeats (at) values (now() - interval '50 hours'), (now() - interval '13 hours'), (now() - interval '7 hours'), (now() - interval '1 hour')",
      "insert into ops.job_runner_runs (worker, source, started_at, ok) values " +
        "('test:report', 'test', now() - interval '10 minutes', true), ('test:report', 'test', now() - interval '9 minutes', false), " +
        "('test:report', 'test', now() - interval '4 minutes', true), ('test:report', 'test', now() - interval '3 minutes', true)",
    ]);
    expect(r.heartbeats.count).toBe(3);
    expect(r.heartbeats.largest_gap_seconds).toBe(21600);
    expect(r.heartbeats.covered_seconds).toBe(46800);
    expect(r.runner).toMatchObject({ runs: 4, ok_runs: 3, largest_ok_gap_seconds: 360, last_ok_age_seconds: 180 });
  });

  it("alerts list state and delivery facts (no details, no ids); backups list sizes and codes", () => {
    const { report: r } = report([
      "insert into ops.alerts (rule, severity, status, resolved_at, details, notified_at, notify_count, notify_seq_enqueued, notify_tries, provider_message_id) values " +
        `('dead_letter', 'warn', 'resolved', now(), '{"job_ids": ["${TENANT_ID}"]}', now(), 1, 1, 1, 'mailpit-id-1')`,
      "insert into ops.alerts (rule, severity, notify_seq_enqueued, notify_tries) values ('backup_stale', 'critical', 1, 3)",
      "insert into ops.backup_runs (environment, started_at, finished_at, status, object_key, archive_bytes, duration_s, archive_sha256) values " +
        "('staging', now() - interval '3 hours', now() - interval '3 hours' + interval '4 minutes', 'ok', 'staging/2026-11-13T010203Z.tar.age', 4096, 240, repeat('b', 64))",
      "insert into ops.backup_runs (environment, started_at, status, error_code) values ('staging', now() - interval '1 hour', 'failed', 'drill_forced')",
    ]);
    const byRule = Object.fromEntries(r.alerts.map((a) => [a.rule, a]));
    expect(byRule.dead_letter).toMatchObject({ status: "resolved", notified: true, provider_id_present: true, unsent: false, notify_count: 1 });
    expect(byRule.backup_stale).toMatchObject({ status: "open", notified: false, provider_id_present: false, unsent: true, notify_tries: 3 });
    expect(Object.keys(byRule.dead_letter).sort()).toEqual([
      "count", "last_seen", "notified", "notify_count", "notify_tries", "opened", "provider_id_present", "resolved_at", "rule",
      "severity", "status", "unsent",
    ]);
    expect(r.backups.map((b) => [b.environment, b.status, b.archive_bytes, b.error_code])).toEqual([
      ["staging", "ok", 4096, null],
      ["staging", "failed", null, "drill_forced"],
    ]);
    expect(JSON.stringify(r)).not.toContain("tar.age");
    expect(checkOpsReport(r, ["alert-drill"]).ok).toBe(true);
  });
});

describe("ops.report_all: access", () => {
  it("definer with an empty search_path; no API role may execute it; PostgREST cannot reach it", async () => {
    const fn = "ops.report_all(integer)";
    expect(psql(`select prosecdef || '|' || array_to_string(proconfig, ',') from pg_proc where oid = '${fn}'::regprocedure`)).toEqual([
      'true|search_path=""',
    ]);
    for (const role of ["anon", "authenticated", "service_role"]) {
      expect(psql(`select has_function_privilege('${role}', '${fn}', 'execute')`), role).toEqual(["f"]);
    }
    expect(psql(`select coalesce(bool_or(a.grantee = 0), false) from pg_proc p, aclexplode(p.proacl) a where p.oid = '${fn}'::regprocedure`)).toEqual(["f"]);
    const { error } = await anonClient().rpc("report_all" as never, { p_hours: 48 } as never);
    expect(error).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// scripts/ops/ops-report.mjs against the real guard and report (psql in the local DB container instead of the pinned
// image; the arguments are the script's own, with the probe role's setup inserted after `begin`).
// ---------------------------------------------------------------------------------------------------------------------

const REF = "abcdefghijklmnopqrst";
const PW = ["Fixture", "Ro", "Pw", "not", "real"].join("-");
const PROBE = "zz_ops_report_probe";
const roUrl = (user: string) => `postgresql://${user}:${encodeURIComponent(PW)}@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`;
const VARS = { PATH: process.env.PATH, SUPABASE_PROJECT_REF_STAGING: REF, STAGING_DB_URL_RO: roUrl(`clinicos_drift_ro.${REF}`) };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ops-report-db-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

interface Call {
  args: string[];
  env: Record<string, string | undefined>;
}

/**
 * A spawn that runs the script's psql arguments in the local DB container as `postgres`. `begin read only` becomes
 * `begin`, then `setup`, then (unless `readOnly` is false) `set transaction read only`, then `set local role <probe>`
 * when `asProbe`. Everything stays inside the script's transaction, which it rolls back.
 */
function localPsql(opts: { setup?: string[]; asProbe?: boolean; readOnly?: boolean } = {}) {
  const calls: Call[] = [];
  const spawnImpl = (cmd: string, args: string[], spawnOpts: object) => {
    calls.push({ args, env: (spawnOpts as { env: Record<string, string | undefined> }).env });
    expect(cmd).toBe("docker");
    const psqlArgs = args.slice(args.indexOf("psql") + 1).flatMap((a) => {
      if (a !== "begin read only") return [a];
      const extra = [...(opts.setup ?? []), ...(opts.readOnly === false ? [] : ["set transaction read only"]), ...(opts.asProbe ? [`set local role ${PROBE}`] : [])];
      return [opts.setup || opts.asProbe || opts.readOnly === false ? "begin" : a, ...extra.flatMap((s) => ["-c", s])];
    });
    const r = spawnSync("docker", ["exec", localDbContainer(), "psql", "-U", "postgres", ...psqlArgs], { encoding: "utf8" });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
  };
  return { calls, spawnImpl };
}

/** The read-only role as the runbook creates it, with the 04-P10 grant (and `extra` grants), inside the transaction. */
const probeRole = (extra: string[] = [], reportGrant = true) => [
  `create role ${PROBE} with nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls`,
  `grant ${PROBE} to postgres with set true, inherit false`,
  `grant usage on schema public to ${PROBE}`,
  ...(reportGrant ? [`grant usage on schema ops to ${PROBE}`, `grant execute on function ops.report_all(integer) to ${PROBE}`] : []),
  ...extra,
];

describe("ops-report.mjs refuses credentials that are not read-only (real guard, local database)", () => {
  it("the postgres role (createrole, createdb, bypassrls) is refused before the report runs", () => {
    const p = localPsql();
    const out = path.join(tmp, "postgres.json");
    const r = runOpsReport({ vars: VARS, out, spawnImpl: p.spawnImpl });
    expect(r.exitCode).toBe(2);
    expect(r.lines).toEqual(["ops-report: REFUSED the credentials are not read-only (role_attributes); use the clinicos_drift_ro URL"]);
    expect(fs.existsSync(out)).toBe(false);
  });

  it.each([
    ["can write a table", [`grant insert on ops.heartbeats to ${PROBE}`], "table_write_privilege"],
    ["is a member of another role", [`create role ${PROBE}_parent nologin`, `grant ${PROBE}_parent to ${PROBE}`], "role_membership"],
    ["can create in a schema", [`grant create on schema public to ${PROBE}`], "create_privilege"],
  ])("a role that %s is refused (%s)", (_label, extra, reason) => {
    const p = localPsql({ setup: probeRole(extra), asProbe: true });
    const out = path.join(tmp, `${reason}.json`);
    const r = runOpsReport({ vars: VARS, out, spawnImpl: p.spawnImpl });
    expect(r.exitCode).toBe(2);
    expect(r.lines.join("\n")).toContain(`(${reason})`);
    expect(fs.existsSync(out)).toBe(false);
  });

  it("a transaction that is not read-only is refused", () => {
    const p = localPsql({ setup: probeRole(), asProbe: true, readOnly: false });
    const r = runOpsReport({ vars: VARS, out: path.join(tmp, "rw.json"), spawnImpl: p.spawnImpl });
    expect(r.exitCode).toBe(2);
    expect(r.lines.join("\n")).toContain("(transaction_not_read_only)");
  });

  it("the read-only role with the 04-P10 grant gets a report the checker accepts; no password or URL in argv", () => {
    const p = localPsql({ setup: probeRole(), asProbe: true });
    const out = path.join(tmp, "ok.json");
    const r = runOpsReport({ vars: VARS, out, spawnImpl: p.spawnImpl });
    expect(r.lines.join("\n")).not.toContain(PW);
    expect(r.exitCode).toBe(0);
    const written = JSON.parse(fs.readFileSync(out, "utf8")) as unknown;
    expect(checkOpsReport(written).ok).toBe(true);
    // The connection reached the container by variable name only.
    const [call] = p.calls;
    expect(call.args.join(" ")).not.toContain(PW);
    expect(call.args.join(" ")).not.toContain(encodeURIComponent(PW));
    expect(call.args.join(" ")).not.toContain("pooler.supabase.com");
    expect(call.args).toEqual(expect.arrayContaining(["-e", "PGPASSWORD", "-e", "PGHOST", "-e", "PGUSER"]));
    expect(call.env.PGPASSWORD).toBe(PW);
    expect(call.env.PGUSER).toBe(`clinicos_drift_ro.${REF}`);
    expect(Object.keys(call.env).filter((k) => !k.startsWith("PG")).sort()).toEqual(["PATH"]);
  });

  it("without the 04-P10 grant the script fails and names the grant", () => {
    const p = localPsql({ setup: probeRole([], false), asProbe: true });
    const r = runOpsReport({ vars: VARS, out: path.join(tmp, "nogrant.json"), spawnImpl: p.spawnImpl });
    expect(r.exitCode).toBe(2);
    expect(r.lines[0]).toContain("04-P10 grant");
  });

  it("the guard SQL itself passes for the probe role and fails for postgres (same session shape, rolled back)", () => {
    const ok = psqlSession(["begin", ...probeRole(), "set transaction read only", `set local role ${PROBE}`, READ_ONLY_GUARD_SQL, "select 'G|ok'", "rollback"]);
    expect(ok).toEqual(["G|ok"]);
    expect(() => psqlSession(["begin read only", READ_ONLY_GUARD_SQL, "rollback"])).toThrow(/ops_report_role_not_read_only: role_attributes/);
  });
});
