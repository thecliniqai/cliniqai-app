/**
 * V2-04 04-01 (T-04-03, T-04-10, R-7): who can touch the job queue (migration 000031), in the live local catalog.
 *
 * - anon and a signed-in clinic owner get 42501 from every runner RPC; the service role succeeds.
 * - PostgREST serves no `jobs` table (public or `ops`), and no API role has any privilege on `ops.jobs`,
 *   `ops.job_runner_runs` or the `ops` schema.
 * - `ops.enqueue_job` twice with one key → one row and the same id; a NULL dedupe key → 23502.
 * - Every new function is SECURITY DEFINER with `search_path=""`; the `ops` functions are executable by no API role.
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAdminClient } from "../helpers/supabase-admin";
import { psql, psqlSession } from "../helpers/sql";
import { seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import {
  anonClient,
  deleteJobs,
  deleteRunnerRuns,
  jobRows,
  letters,
  uniqueKind,
} from "./helpers";

const WORKER = `spec-grants-${letters(8)}`;
const KIND = uniqueKind("grants");
const ZERO = "00000000-0000-0000-0000-000000000000";

const PUBLIC_FUNCTIONS = [
  "public.claim_jobs(text[], integer, integer, text, integer)",
  "public.complete_job(uuid, uuid)",
  "public.fail_job(uuid, uuid, text, boolean, timestamp with time zone)",
  "public.release_job(uuid, uuid)",
  "public.jobs_runner_begin(text, text)",
  "public.jobs_runner_end(bigint, integer, integer, integer, integer, boolean, text)",
];
const OPS_FUNCTIONS = [
  "ops.enqueue_job(text, uuid, jsonb, text, timestamp with time zone, integer)",
  "ops.reap_jobs()",
  "ops.job_error_code(text)",
];

let owner: SeededTenant;

beforeAll(async () => {
  owner = await seedTenantWithOwner(`Jobs grants ${letters(6)}`);
});

afterAll(() => {
  deleteJobs([KIND]);
  deleteRunnerRuns(WORKER);
});

/** One call per runner RPC, with well-formed arguments, so only the privilege check can refuse it. */
async function callEveryRpc(
  db: SupabaseClient
): Promise<Record<string, string | null>> {
  const calls: Record<
    string,
    PromiseLike<{ error: { code?: string } | null }>
  > = {
    claim_jobs: db.rpc("claim_jobs", {
      p_kinds: [KIND],
      p_batch: 1,
      p_lease_seconds: 60,
      p_worker: WORKER,
    }),
    complete_job: db.rpc("complete_job", { p_id: ZERO, p_lease_token: ZERO }),
    fail_job: db.rpc("fail_job", {
      p_id: ZERO,
      p_lease_token: ZERO,
      p_error_code: "x",
      p_retryable: true,
    }),
    release_job: db.rpc("release_job", { p_id: ZERO, p_lease_token: ZERO }),
    jobs_runner_begin: db.rpc("jobs_runner_begin", {
      p_worker: WORKER,
      p_source: "test",
    }),
    jobs_runner_end: db.rpc("jobs_runner_end", {
      p_run_id: 0,
      p_claimed: 0,
      p_done: 0,
      p_retried: 0,
      p_dead: 0,
      p_ok: true,
      p_error_code: null,
    }),
  };
  const out: Record<string, string | null> = {};
  for (const [name, call] of Object.entries(calls))
    out[name] = (await call).error?.code ?? null;
  return out;
}

const ALL_DENIED = {
  claim_jobs: "42501",
  complete_job: "42501",
  fail_job: "42501",
  release_job: "42501",
  jobs_runner_begin: "42501",
  jobs_runner_end: "42501",
};

describe("runner RPCs: service role only", () => {
  it("anon gets 42501 from every runner RPC", async () => {
    expect(await callEveryRpc(anonClient())).toEqual(ALL_DENIED);
  });

  it("a signed-in clinic owner (authenticated) gets 42501 from every runner RPC", async () => {
    expect(
      await callEveryRpc(owner.client as unknown as SupabaseClient)
    ).toEqual(ALL_DENIED);
  });

  it("the service role may call them (a run row it opens can be closed)", async () => {
    const admin = getAdminClient();
    const claim = await admin.rpc("claim_jobs", {
      p_kinds: [KIND],
      p_batch: 1,
      p_lease_seconds: 60,
      p_worker: WORKER,
    });
    expect(claim.error).toBeNull();
    expect(claim.data).toEqual([]);
    expect(
      (await admin.rpc("complete_job", { p_id: ZERO, p_lease_token: ZERO }))
        .data
    ).toBe(false);
    const begin = await admin.rpc("jobs_runner_begin", {
      p_worker: WORKER,
      p_source: "test",
    });
    expect(begin.error).toBeNull();
    const end = await admin.rpc("jobs_runner_end", {
      p_run_id: begin.data as number,
      p_claimed: 0,
      p_done: 0,
      p_retried: 0,
      p_dead: 0,
      p_ok: true,
      p_error_code: null as unknown as string,
    });
    expect(end.error).toBeNull();
    expect(
      psql(
        `select source || '|' || ok || '|' || (finished_at is not null) from ops.job_runner_runs where id = ${Number(begin.data)}`
      )
    ).toEqual(["test|true|true"]);
  });

  it("refuses out-of-range claim arguments with 22023", async () => {
    const admin = getAdminClient();
    const base = {
      p_kinds: [KIND],
      p_batch: 1,
      p_lease_seconds: 60,
      p_worker: WORKER,
      p_per_tenant: 1,
    };
    for (const bad of [
      { p_batch: 0 },
      { p_batch: 101 },
      { p_lease_seconds: 9 },
      { p_lease_seconds: 901 },
      { p_per_tenant: 0 },
      { p_per_tenant: 101 },
      { p_kinds: [] as string[] },
      { p_worker: " " },
    ]) {
      expect(
        (await admin.rpc("claim_jobs", { ...base, ...bad })).error?.code
      ).toBe("22023");
    }
  });
});

describe("the ops tables are not reachable through any API role", () => {
  it("PostgREST serves no jobs table, in public or in ops", async () => {
    const admin = getAdminClient() as unknown as SupabaseClient;
    const pub = await admin.from("jobs").select("*").limit(1);
    expect(pub.data).toBeNull();
    expect(pub.error?.code).toBe("PGRST205");
    const ops = await admin.schema("ops").from("jobs").select("*").limit(1);
    expect(ops.data).toBeNull();
    expect(ops.error?.code).toBe("PGRST106");
  });

  it("anon, authenticated and service_role have no privilege on the ops schema or the queue tables", () => {
    const rows = psql(
      "select r || '|' || has_schema_privilege(r, 'ops', 'usage') || '|' || " +
        "has_table_privilege(r, 'ops.jobs', 'select,insert,update,delete,truncate,references,trigger') || '|' || " +
        "has_table_privilege(r, 'ops.job_runner_runs', 'select,insert,update,delete,truncate,references,trigger') || '|' || " +
        "has_sequence_privilege(r, 'ops.job_runner_runs_id_seq', 'usage,select,update') " +
        "from unnest(array['anon', 'authenticated', 'service_role']) r order by r"
    );
    expect(rows).toEqual([
      "anon|false|false|false|false",
      "authenticated|false|false|false|false",
      "service_role|false|false|false|false",
    ]);
    expect(
      psql(
        "select relrowsecurity from pg_class where oid in ('ops.jobs'::regclass, 'ops.job_runner_runs'::regclass)"
      )
    ).toEqual(["t", "t"]);
    expect(
      psql(
        "select count(*) from pg_policy where polrelid in ('ops.jobs'::regclass, 'ops.job_runner_runs'::regclass)"
      )
    ).toEqual(["0"]);
  });
});

describe("enqueue dedupe (R-7)", () => {
  it("ops.enqueue_job twice with one key → one row and the same id", () => {
    const key = `${KIND}:dedupe`;
    const first = psql(
      `select ops.enqueue_job('${KIND}', null, '{"n": 1}'::jsonb, '${key}')`
    )[0];
    const second = psql(
      `select ops.enqueue_job('${KIND}', null, '{"n": 2}'::jsonb, '${key}')`
    )[0];
    expect(second).toBe(first);
    expect(
      psql(
        `select count(*) || '|' || max(payload->>'n') from ops.jobs where dedupe_key = '${key}'`
      )
    ).toEqual(["1|1"]);
  });

  it("a NULL dedupe key is refused with 23502 (insert and enqueue)", () => {
    const out = psqlSession([
      "create temp table codes (via text, state text)",
      `do $$ begin insert into ops.jobs (kind, dedupe_key) values ('${KIND}', null);
         exception when others then insert into codes values ('insert', sqlstate); end $$`,
      `do $$ begin perform ops.enqueue_job('${KIND}', null, '{}'::jsonb, null);
         exception when others then insert into codes values ('enqueue', sqlstate); end $$`,
      "select via || '|' || state from codes order by via",
    ]);
    expect(out).toEqual(["enqueue|23502", "insert|23502"]);
    expect(jobRows(KIND).length).toBe(1); // only the dedupe row above
  });

  it("refuses a malformed kind and a non-object or oversize payload (23514)", () => {
    const out = psqlSession([
      "create temp table codes (n int, state text)",
      ...[
        `'Test.Upper', null, '{}'::jsonb, 'k1'`,
        `'nodot', null, '{}'::jsonb, 'k2'`,
        `'${KIND}', null, '[1]'::jsonb, 'k3'`,
        `'${KIND}', null, jsonb_build_object('x', repeat('a', 5000)), 'k4'`,
      ].map(
        (args, i) =>
          `do $$ begin perform ops.enqueue_job(${args}); exception when others then insert into codes values (${i}, sqlstate); end $$`
      ),
      "select string_agg(state, ',' order by n) from codes",
    ]);
    expect(out).toEqual(["23514,23514,23514,23514"]);
  });
});

describe("catalog: definer functions with a pinned search_path, ops functions closed", () => {
  it('every new function is SECURITY DEFINER with search_path=""', () => {
    const rows = psql(
      "select p.oid::regprocedure::text || '|' || p.prosecdef || '|' || " +
        `('search_path=""' = any(p.proconfig)) from pg_proc p ` +
        `where p.oid in (${[...PUBLIC_FUNCTIONS, ...OPS_FUNCTIONS].map((f) => `'${f}'::regprocedure`).join(", ")}) order by 1`
    );
    expect(rows).toHaveLength(PUBLIC_FUNCTIONS.length + OPS_FUNCTIONS.length);
    expect(rows.every((r) => r.endsWith("|true|true"))).toBe(true);
  });

  it("public runner RPCs: service_role only; ops functions: no API role", () => {
    const check = (fn: string) =>
      psql(
        `select string_agg(has_function_privilege(r, '${fn}', 'execute')::text, ',' order by r) ` +
          "from unnest(array['anon', 'authenticated', 'service_role']) r"
      )[0];
    for (const fn of PUBLIC_FUNCTIONS)
      expect([fn, check(fn)]).toEqual([fn, "false,false,true"]);
    for (const fn of OPS_FUNCTIONS)
      expect([fn, check(fn)]).toEqual([fn, "false,false,false"]);
  });
});
