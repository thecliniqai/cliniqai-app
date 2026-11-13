/**
 * V2-04 04-02 (roadmap "scheduler migration test on the local stack"; C22, R-12, R-16, R-17, R-32, A8; threats T-04-01,
 * T-04-02, T-04-18, T-04-20): migration 000033 in the live local catalog. CI tests this DB half only: the database
 * container cannot reach the app on a Linux runner (pitfall 6, R-21); the route half is run-route.spec.ts.
 *
 * - `cron.job` holds `jobs-kick`, `jobs-reap` and `cron-history-cleanup` exactly once, as `postgres`, with the
 *   expected schedules and commands; re-applying the migration file (rolled back) keeps one row per name and its id.
 * - `ops.kick_job_runner()` without Vault secrets returns NULL and queues nothing; with synthetic secrets (rolled back,
 *   so pg_net never sends) it queues one POST to the Vault URL with `Authorization: Bearer <secret>`, JSON
 *   `{"source":"pg_cron"}` and `timeout_milliseconds = 30000`; a non-https non-loopback URL, a URL with userinfo and a
 *   short or spaced secret raise `22023`.
 * - Exposure (R-16 as built, see the migration header): `net` is not reachable through the API for anon or a signed-in
 *   user; no function in an API schema references `net.`; only `ops.kick_job_runner()` reads `jobs_runner_secret`;
 *   no API role may execute the scheduler functions, use `cron`, or (anon/authenticated) read Vault.
 * - `ops.drill_enqueue` accepts `drill.*` kinds only, 1..500 jobs, spreads `run_at` evenly, empty payload, no tenant,
 *   key `drill:<kind>:<uuid>`; no API role may execute it.
 *
 * Synthetic secrets are random per run and compared, never printed. Every write is inside a rolled-back transaction.
 */
import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { localDbContainer, psql } from "../helpers/sql";
import { seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { anonClient } from "./helpers";

const MIGRATION = path.resolve(__dirname, "../../supabase/migrations/000033_jobs_scheduler.sql");
const API_ROLES = ["anon", "authenticated", "service_role"] as const;
const SCHEDULER_FUNCTIONS = ["ops.kick_job_runner()", "ops.drill_enqueue(text, integer, interval, integer)"];
/** The local stack's own discard port: nothing listens, and the transaction is rolled back before pg_net sends. */
const LOOPBACK_URL = "http://127.0.0.1:9/api/jobs/run";

const EXPECTED_JOBS = [
  ["cron-history-cleanup", "15 0 * * *", "delete from cron.job_run_details where end_time < now() - interval '7 days'"],
  ["jobs-kick", "* * * * *", "select ops.kick_job_runner()"],
  ["jobs-reap", "* * * * *", "select ops.reap_jobs()"],
];

const sha = (value: string) => createHash("sha256").update(value).digest("hex");

/** Random hex: SQL-safe by construction. */
function syntheticSecret(bytes = 32): string {
  return randomBytes(bytes).toString("hex");
}

/** Only constant URLs from this file are interpolated; refuse anything with a quote. */
function lit(value: string): string {
  if (/['\\]/.test(value)) throw new Error("refusing to interpolate a quoted value");
  return `'${value}'`;
}

/** Statements that replace the runner secrets with the given ones for the rest of the (rolled-back) transaction. */
function withSecrets(url: string | null, secret: string | null): string[] {
  const out = ["delete from vault.secrets where name in ('jobs_runner_url', 'jobs_runner_secret')"];
  if (url !== null) out.push(`select vault.create_secret(${lit(url)}, 'jobs_runner_url') is not null`);
  if (secret !== null) out.push(`select vault.create_secret(${lit(secret)}, 'jobs_runner_secret') is not null`);
  return out;
}

/** Runs `statements` in one rolled-back transaction; returns psql's status, output and error text. */
function inRollback(statements: string[]): { status: number; stdout: string; stderr: string } {
  const args = ["exec", "-i", localDbContainer(), "psql", "-U", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-f", "-"];
  const input = ["begin;", ...statements.map((s) => `${s};`), "rollback;", ""].join("\n");
  const r = spawnSync("docker", args, { input, encoding: "utf8" });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function cronRows(): string[] {
  return psql(
    "select jobname || '|' || schedule || '|' || command || '|' || username || '|' || database from cron.job " +
      "where jobname in ('jobs-kick', 'jobs-reap', 'cron-history-cleanup') order by jobname",
  );
}

describe("000033: extensions and schedules", () => {
  it("installs pg_cron and pg_net (pg_net recorded in `extensions`)", () => {
    expect(psql("select extname || '|' || extnamespace::regnamespace from pg_extension where extname in ('pg_cron', 'pg_net') order by 1")).toEqual([
      "pg_cron|pg_catalog",
      "pg_net|extensions",
    ]);
  });

  it("cron.job holds the three schedules exactly once, owned by postgres", () => {
    expect(cronRows()).toEqual(EXPECTED_JOBS.map(([name, schedule, command]) => `${name}|${schedule}|${command}|postgres|postgres`));
    const [dupes] = psql("select count(*) from (select jobname from cron.job group by jobname having count(*) > 1) d");
    expect(dupes).toBe("0");
  });

  it("the test lane paused every schedule for this run (global setup; the teardown resumes them)", () => {
    expect(psql("select jobname || '=' || active from cron.job where jobname in ('jobs-kick', 'jobs-reap', 'cron-history-cleanup') order by jobname")).toEqual([
      "cron-history-cleanup=false",
      "jobs-kick=false",
      "jobs-reap=false",
    ]);
  });

  it("re-applying the migration (rolled back) keeps one row per name and the same job ids (A8)", () => {
    const before = psql("select jobname || '=' || jobid from cron.job order by jobname");
    const sql = fs.readFileSync(MIGRATION, "utf8");
    const r = inRollback([
      sql,
      "select 'after:' || string_agg(jobname || '=' || jobid, ',' order by jobname) from cron.job",
      "select 'count:' || count(*) from cron.job where jobname in ('jobs-kick', 'jobs-reap', 'cron-history-cleanup')",
    ]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain(`after:${before.join(",")}`);
    expect(r.stdout).toContain("count:3");
    expect(psql("select jobname || '=' || jobid from cron.job order by jobname")).toEqual(before);
  });
});

describe("000033: ops.kick_job_runner()", () => {
  it("without Vault secrets returns NULL and queues nothing", () => {
    for (const [url, secret] of [
      [null, null],
      [LOOPBACK_URL, null],
      [null, syntheticSecret()],
    ] as const) {
      const r = inRollback([
        ...withSecrets(url, secret),
        "select 'queued_before:' || count(*) from net.http_request_queue",
        "select 'kick:' || coalesce(ops.kick_job_runner()::text, 'null')",
        "select 'queued_after:' || count(*) from net.http_request_queue",
      ]);
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toContain("kick:null");
      const before = /queued_before:(\d+)/.exec(r.stdout)?.[1];
      expect(r.stdout).toContain(`queued_after:${before}`);
    }
  });

  it("with synthetic secrets queues one POST: Vault URL, bearer, JSON body, 30 s timeout (rolled back, never sent)", () => {
    const secret = syntheticSecret();
    const r = inRollback([
      ...withSecrets(LOOPBACK_URL, secret),
      "select set_config('spec.kick', ops.kick_job_runner()::text, true) is not null",
      "select 'id:' || current_setting('spec.kick')",
      "select 'row:' || q.method || '|' || q.url || '|' || q.timeout_milliseconds || '|' || " +
        "encode(sha256(convert_to(q.headers->>'Authorization', 'UTF8')), 'hex') || '|' || " +
        "(q.headers->>'Content-Type') || '|' || convert_from(q.body, 'UTF8') " +
        "from net.http_request_queue q where q.id = current_setting('spec.kick')::bigint",
    ]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^id:\d+$/m);
    const row = /^row:(.*)$/m.exec(r.stdout)?.[1];
    expect(row, "one queued request").toBeDefined();
    const [method, url, timeout, authDigest, contentType, body] = row!.split("|");
    expect(method).toBe("POST");
    expect(url).toBe(LOOPBACK_URL);
    expect(timeout).toBe("30000");
    expect(authDigest).toBe(sha(`Bearer ${secret}`));
    expect(contentType).toBe("application/json");
    expect(JSON.parse(body)).toEqual({ source: "pg_cron" });
    expect(r.stdout).not.toContain(secret);
    // Rolled back: the request never reached the queue the pg_net worker reads.
    const id = /^id:(\d+)$/m.exec(r.stdout)![1];
    expect(psql(`select count(*) from net.http_request_queue where id = ${Number(id)}`)).toEqual(["0"]);
  });

  it.each([
    ["https (any host)", "https://staging.example.org/api/jobs/run"],
    ["localhost", "http://localhost:3100/api/jobs/run"],
    ["the Docker host", "http://host.docker.internal:3100/api/jobs/run"],
  ])("accepts %s", (_label, url) => {
    const r = inRollback([...withSecrets(url, syntheticSecret()), "select 'kick:' || (ops.kick_job_runner() is not null)"]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("kick:true");
  });

  it.each([
    ["plain http to a public host", "http://staging.example.org/api/jobs/run", "jobs_runner_url_refused"],
    ["http to a private address", "http://10.0.0.5/api/jobs/run", "jobs_runner_url_refused"],
    ["userinfo in the authority", "https://user:pw@staging.example.org/api/jobs/run", "jobs_runner_url_refused"],
    ["a loopback name used as userinfo", "http://127.0.0.1@evil.example.org/x", "jobs_runner_url_refused"],
    ["whitespace", "https://staging.example.org/api/jobs/run x", "jobs_runner_url_refused"],
    ["another scheme", "ftp://staging.example.org/x", "jobs_runner_url_refused"],
  ])("refuses %s (22023, nothing queued)", (_label, url, reason) => {
    const r = inRollback([...withSecrets(url, syntheticSecret()), "select ops.kick_job_runner()"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain(`ERROR:  ${reason}`);
  });

  it.each([
    ["shorter than 32 characters", syntheticSecret(8)],
    ["with a space", `${syntheticSecret(16)} ${syntheticSecret(16)}`],
  ])("refuses a secret %s (22023), never echoing it", (_label, secret) => {
    const r = inRollback([...withSecrets(LOOPBACK_URL, secret), "select ops.kick_job_runner()"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("ERROR:  jobs_runner_secret_refused");
    expect(r.stderr).not.toContain(secret);
  });
});

describe("000033: exposure of net, Vault and the scheduler functions (R-16 as built, T-04-02)", () => {
  let owner: SeededTenant;
  beforeAll(async () => {
    owner = await seedTenantWithOwner("Scheduler exposure spec clinic");
  });

  it("PostgREST serves nothing of `net` to anon or a signed-in user (PGRST106)", async () => {
    // Untyped clients: `net` is (rightly) not in the generated API types.
    for (const client of [anonClient(), owner.client as unknown as SupabaseClient]) {
      const queue = await client.schema("net").from("http_request_queue").select("*").limit(1);
      expect(queue.error?.code).toBe("PGRST106");
      const post = await client.schema("net").rpc("http_post", { url: LOOPBACK_URL });
      expect(post.error?.code).toBe("PGRST106");
    }
  });

  it("no function in an API schema references net.; only ops.kick_job_runner() calls pg_net or reads the runner secret", () => {
    expect(
      psql(
        "select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace " +
          "where n.nspname in ('public', 'graphql_public', 'storage') and p.prosrc ~ '\\mnet\\.'",
      ),
    ).toEqual([]);
    const userSchemas = "n.nspname in ('public', 'private', 'ops', 'storage', 'graphql_public')";
    expect(psql(`select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace where ${userSchemas} and p.prosrc ~ 'net\\.http_'`)).toEqual([
      "ops.kick_job_runner()",
    ]);
    expect(psql(`select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace where ${userSchemas} and p.prosrc like '%jobs_runner_secret%'`)).toEqual([
      "ops.kick_job_runner()",
    ]);
  });

  it("no API role may execute the scheduler functions or use cron; anon and authenticated cannot read Vault", () => {
    for (const role of API_ROLES) {
      for (const fn of SCHEDULER_FUNCTIONS) {
        expect(psql(`select has_function_privilege('${role}', '${fn}', 'execute')`), `${role} ${fn}`).toEqual(["f"]);
      }
      expect(psql(`select has_schema_privilege('${role}', 'cron', 'usage')`), role).toEqual(["f"]);
    }
    for (const role of ["anon", "authenticated"]) {
      expect(psql(`select has_schema_privilege('${role}', 'vault', 'usage')`), role).toEqual(["f"]);
      expect(psql(`select has_table_privilege('${role}', 'vault.decrypted_secrets', 'select')`), role).toEqual(["f"]);
    }
  });

  it("both functions are SECURITY DEFINER with an empty search_path, owned by postgres", () => {
    expect(
      psql(
        "select p.oid::regprocedure || '|' || p.prosecdef || '|' || array_to_string(p.proconfig, ',') || '|' || " +
          "pg_get_userbyid(p.proowner) from pg_proc p where p.oid in " +
          "('ops.kick_job_runner()'::regprocedure, 'ops.drill_enqueue(text, integer, interval, integer)'::regprocedure) order by 1",
      ),
    ).toEqual([
      'ops.kick_job_runner()|true|search_path=""|postgres',
      'ops.drill_enqueue(text,integer,interval,integer)|true|search_path="",lock_timeout=2s|postgres',
    ].sort());
  });
});

describe("000033: ops.drill_enqueue (R-32)", () => {
  it("enqueues drill jobs spread evenly over the interval: empty payload, no tenant, drill:<kind>:<uuid> keys", () => {
    const r = inRollback([
      "select 'n:' || ops.drill_enqueue('drill.noop', 3, interval '10 minutes', 4)",
      "select 'row:' || extract(epoch from (run_at - now()))::int || '|' || payload::text || '|' || " +
        "coalesce(tenant_id::text, 'null') || '|' || max_attempts || '|' || status || '|' || " +
        "(dedupe_key ~ '^drill:drill\\.noop:[0-9a-f-]{36}$') from ops.jobs where kind = 'drill.noop' and created_at = now() order by run_at",
    ]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("n:3");
    expect(r.stdout.split("\n").filter((l) => l.startsWith("row:"))).toEqual([
      "row:0|{}|null|4|pending|true",
      "row:300|{}|null|4|pending|true",
      "row:600|{}|null|4|pending|true",
    ]);
  });

  it.each([
    ["a non-drill kind", "'message.send', 1", "drill_kind_refused"],
    ["a kind outside the kind shape", "'drill.No-op', 1", "drill_kind_refused"],
    ["0 jobs", "'drill.noop', 0", "drill_count_out_of_range"],
    ["501 jobs", "'drill.noop', 501", "drill_count_out_of_range"],
    ["a negative spread", "'drill.noop', 2, interval '-1 minute'", "drill_spread_out_of_range"],
    ["21 attempts", "'drill.noop', 1, interval '0', 21", "drill_max_attempts_out_of_range"],
  ])("refuses %s (22023)", (_label, args, reason) => {
    const r = inRollback([`select ops.drill_enqueue(${args})`]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain(`ERROR:  ${reason}`);
  });

  it("a session as an API role cannot call it", () => {
    for (const role of API_ROLES) {
      const r = inRollback([`set local role ${role}`, "select ops.drill_enqueue('drill.noop', 1)"]);
      expect(r.status, role).not.toBe(0);
      expect(r.stderr, role).toMatch(/permission denied for (schema ops|function drill_enqueue)/);
    }
  });
});
