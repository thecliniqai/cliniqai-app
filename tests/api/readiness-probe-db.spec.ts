/**
 * V2-03 03-01 (P1-15, C50 g, ADR-0005 "Readiness") and 03-13c (M-PROBE: review A M-2, B M-1, B L-4):
 * `public.readiness_probe(p_expected_migration)` in the live catalog of the local stack (migration 000029).
 *
 * - anon executes it through PostgREST and gets booleans only: no count and no migration version; `schema_current`
 *   answers for the exact version asked (null for anything that is not six digits);
 * - authenticated, service_role and PUBLIC cannot execute it (/api/ready calls it as anon only);
 * - each flag is served by an index: with sequential scans disabled, no plan of the checks scans a queue table;
 * - 04-04 (R-41): four job flags (`jobs_backlog`, `jobs_dead_24h`, `runner_stale`, `alerts_critical_open`), booleans
 *   only; a seeded dead job flips `jobs_dead_24h`, a runner URL in Vault without a runner pass flips `runner_stale`, an
 *   open critical alert flips `alerts_critical_open`, a 6-minute-old due job flips `jobs_backlog` (rolled-back seeds);
 * - EXPECTED_MIGRATION (app/api/ready) is the newest file in supabase/migrations;
 * - SECURITY DEFINER with `search_path` pinned to the empty string;
 * - anon can execute no other SECURITY DEFINER function in `public` than the committed allowlist, so a later migration
 *   that leaves a new definer function open to anon (Supabase's default privileges grant EXECUTE to anon) fails here.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { publicEnv } from "@/lib/env";
import { EXPECTED_MIGRATION } from "@/app/api/ready/expected-migration";
import { psqlSession } from "../helpers/sql";

const ROOT = path.resolve(__dirname, "../..");

/** Every public SECURITY DEFINER function anon may execute, with the plan that opened it. */
const ANON_DEFINER_ALLOWLIST = [
  "consume_reschedule_token", // V2-01 (000020/000023): token-scoped reschedule
  "get_reschedule_context", // V2-01: token-scoped reschedule
  "ops_ingest_error", // V2-03 03-09b: error sink ingest, refused without the ingest key (vault hash)
  "readiness_probe", // V2-03 03-01, 03-13c: booleans only
  "resolve_share_token", // V2-01 (000020/000022): token-scoped share links
];

function psql(sql: string): string[] {
  const toml = fs.readFileSync(path.join(ROOT, "supabase/config.toml"), "utf8");
  const projectId = /^project_id\s*=\s*"([^"]+)"/m.exec(toml)?.[1];
  if (!projectId) throw new Error("project_id not found in supabase/config.toml");
  const out = execFileSync("docker", ["exec", `supabase_db_${projectId}`, "psql", "-U", "postgres", "-Atc", sql], {
    encoding: "utf8",
  });
  return out.trim().split("\n").filter(Boolean);
}

const SIGNATURE = "public.readiness_probe(text)";
const FLAGS = [
  "messages_backlog",
  "messages_failed_24h",
  "webhooks_backlog",
  "webhooks_failed_24h",
  // 04-04 (R-41)
  "jobs_backlog",
  "jobs_dead_24h",
  "runner_stale",
  "alerts_critical_open",
];

function client(key: string) {
  return createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

describe("readiness_probe(p_expected_migration) (migrations 000025, 000029)", () => {
  it("anon executes it through PostgREST and gets booleans only (no count, no version)", async () => {
    const { data, error } = await client(publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).rpc("readiness_probe", {
      p_expected_migration: EXPECTED_MIGRATION,
    });
    expect(error).toBeNull();
    const body = data as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["db", ...FLAGS, "schema_current"].sort());
    expect(body.db).toBe(true);
    expect(body.schema_current).toBe(true);
    for (const key of FLAGS) expect(typeof body[key], key).toBe("boolean");
    expect(Object.values(body).every((v) => typeof v === "boolean")).toBe(true);
  });

  it("schema_current answers only for the exact six-digit version asked", async () => {
    const anon = client(publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
    const ask = async (v: unknown) =>
      ((await anon.rpc("readiness_probe", { p_expected_migration: v as string })).data as Record<string, unknown>)
        .schema_current;
    expect(await ask("999999")).toBe(false);
    expect(await ask("00002")).toBeNull();
    expect(await ask("000029 or true")).toBeNull();
    expect(await ask(null)).toBeNull();
    expect(((await anon.rpc("readiness_probe")).data as Record<string, unknown>).schema_current).toBeNull();
  });

  it("EXPECTED_MIGRATION is the newest migration file (bump it with every new migration)", () => {
    const newest = fs
      .readdirSync(path.join(ROOT, "supabase/migrations"))
      .map((f) => /^([0-9]{6})_[a-z0-9_]+\.sql$/.exec(f)?.[1])
      .filter((v): v is string => v !== undefined)
      .sort()
      .at(-1);
    expect(EXPECTED_MIGRATION).toBe(newest);
  });

  it("each flag is an indexed check: with sequential scans off, no plan scans a queue table", () => {
    const checks = [
      "select 1 from public.communication_queue q where q.status in ('pending', 'processing') and q.next_retry_at < now() - interval '15 minutes'",
      "select 1 from public.communication_queue q where q.status in ('failed', 'dead_letter') and q.updated_at >= now() - interval '24 hours'",
      "select 1 from public.webhook_delivery_queue w where w.status = 'pending' and w.next_retry_at < now() - interval '15 minutes'",
      "select 1 from public.webhook_delivery_queue w where w.status = 'failed' and w.updated_at >= now() - interval '24 hours'",
      // 04-04 (R-41)
      "select 1 from ops.jobs j where j.status = 'pending' and j.run_at < now() - interval '5 minutes'",
      "select 1 from ops.jobs j where j.status = 'dead' and j.finished_at >= now() - interval '24 hours'",
      "select 1 from ops.job_runner_runs r where r.started_at > now() - interval '5 minutes' and r.ok and r.source = 'pg_cron'",
      "select 1 from vault.secrets v where v.name = 'jobs_runner_url'",
      "select 1 from ops.alerts a where a.status = 'open' and a.severity = 'critical'",
    ];
    for (const check of checks) {
      const plan = psql(`begin; set local enable_seqscan = off; explain select exists (${check}); rollback;`).join("\n");
      expect(plan, check).not.toMatch(/Seq Scan/);
    }
    // The function body runs exactly these predicates.
    const def = psql(`select pg_get_functiondef('${SIGNATURE}'::regprocedure)`).join("\n");
    expect(def).not.toMatch(/count\(/i);
    expect(def).not.toMatch(/max\(/i);
  });

  it("04-04: each job flag answers its condition (seeded in a rolled-back session), never a count", () => {
    const probe = "select 'P|' || public.readiness_probe(null)::text";
    const flags = (seed: string[]): Record<string, unknown> => {
      const lines = psqlSession([
        "begin",
        "delete from ops.jobs",
        "delete from ops.job_runner_runs",
        "delete from ops.alerts",
        "delete from vault.secrets where name = 'jobs_runner_url'",
        ...seed,
        probe,
        "rollback",
      ]);
      const line = lines.find((l) => l.startsWith("P|"));
      return JSON.parse(line!.slice(2)) as Record<string, unknown>;
    };
    const quiet = flags([]);
    expect(quiet).toMatchObject({ jobs_backlog: false, jobs_dead_24h: false, runner_stale: false, alerts_critical_open: false });

    const dead = flags([
      "insert into ops.jobs (kind, dedupe_key, status, attempts, finished_at) values ('test.ready_dead', 'ready:' || gen_random_uuid(), 'dead', 1, now())",
    ]);
    expect(dead).toMatchObject({ jobs_dead_24h: true, jobs_backlog: false });
    expect(flags([
      "insert into ops.jobs (kind, dedupe_key, status, attempts, finished_at) values ('test.ready_dead', 'ready:' || gen_random_uuid(), 'dead', 1, now() - interval '25 hours')",
    ]).jobs_dead_24h).toBe(false);

    expect(flags(["insert into ops.jobs (kind, dedupe_key, run_at) values ('test.ready_due', 'ready:' || gen_random_uuid(), now() - interval '6 minutes')"]).jobs_backlog).toBe(true);
    expect(flags(["insert into ops.jobs (kind, dedupe_key, run_at) values ('test.ready_due', 'ready:' || gen_random_uuid(), now() - interval '4 minutes')"]).jobs_backlog).toBe(false);

    const vault = "select vault.create_secret('https://runner.example.invalid/api/jobs/run', 'jobs_runner_url')";
    expect(flags([vault]).runner_stale).toBe(true);
    expect(
      flags([vault, "insert into ops.job_runner_runs (worker, source, started_at, ok) values ('test:ready', 'pg_cron', now() - interval '1 minute', true)"])
        .runner_stale,
    ).toBe(false);
    // 04-07b (review A L-5): a manual (or test) pass does not hide a broken scheduler.
    for (const source of ["manual", "test"]) {
      expect(
        flags([vault, `insert into ops.job_runner_runs (worker, source, started_at, ok) values ('test:ready', '${source}', now() - interval '1 minute', true)`])
          .runner_stale,
        source,
      ).toBe(true);
    }

    expect(flags(["insert into ops.alerts (rule, severity) values ('backup_stale', 'critical')"]).alerts_critical_open).toBe(true);
    expect(flags(["insert into ops.alerts (rule, severity) values ('dead_letter', 'warn')"]).alerts_critical_open).toBe(false);
    for (const body of [quiet, dead]) {
      expect(Object.values(body).every((v) => typeof v === "boolean" || v === null)).toBe(true);
      expect(JSON.stringify(Object.values(body))).not.toMatch(/\d/);
    }
  });

  it("is SECURITY DEFINER with search_path pinned to the empty string", () => {
    const [row] = psql(
      "select p.prosecdef::text || '|' || array_to_string(p.proconfig, ',') from pg_proc p " +
        `where p.oid = '${SIGNATURE}'::regprocedure`,
    );
    expect(row).toBe('true|search_path=""');
  });

  it("only anon may execute it; authenticated, service_role and PUBLIC may not; the 000025 overload is gone", () => {
    const [row] = psql(
      `select has_function_privilege('anon', '${SIGNATURE}', 'execute')::text || '|' || ` +
        `has_function_privilege('authenticated', '${SIGNATURE}', 'execute')::text || '|' || ` +
        `has_function_privilege('service_role', '${SIGNATURE}', 'execute')::text || '|' || ` +
        "coalesce((select bool_or(a.grantee = 0)::text from pg_proc p, aclexplode(p.proacl) a " +
        `where p.oid = '${SIGNATURE}'::regprocedure), 'false')`,
    );
    expect(row).toBe("true|false|false|false");
    expect(psql("select count(*) from pg_proc where proname = 'readiness_probe'")).toEqual(["1"]);
  });

  it("anon can execute no other SECURITY DEFINER function in public", () => {
    const rows = psql(
      "select distinct p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef " +
        "and has_function_privilege('anon', p.oid, 'execute') order by 1",
    );
    expect(rows).toEqual(ANON_DEFINER_ALLOWLIST);
  });
});
