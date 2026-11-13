/**
 * V2-03 03-01 (P1-15, C50 g, ADR-0005 "Readiness") and 03-13c (M-PROBE: review A M-2, B M-1, B L-4):
 * `public.readiness_probe(p_expected_migration)` in the live catalog of the local stack (migration 000029).
 *
 * - anon executes it through PostgREST and gets booleans only: no count and no migration version; `schema_current`
 *   answers for the exact version asked (null for anything that is not six digits);
 * - authenticated, service_role and PUBLIC cannot execute it (/api/ready calls it as anon only);
 * - each flag is served by an index: with sequential scans disabled, no plan of the four checks scans a queue table;
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
const FLAGS = ["messages_backlog", "messages_failed_24h", "webhooks_backlog", "webhooks_failed_24h"];

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
    ];
    for (const check of checks) {
      const plan = psql(`begin; set local enable_seqscan = off; explain select exists (${check}); rollback;`).join("\n");
      expect(plan, check).not.toMatch(/Seq Scan/);
    }
    // The function body runs exactly these four predicates.
    const def = psql(`select pg_get_functiondef('${SIGNATURE}'::regprocedure)`).join("\n");
    expect(def).not.toMatch(/count\(/i);
    expect(def).not.toMatch(/max\(/i);
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
