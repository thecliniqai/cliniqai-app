/**
 * V2-03 03-01 (P1-15, C50 g, ADR-0005 "Readiness"): `public.readiness_probe()` in the live catalog of the local stack
 * (migration 000025).
 *
 * - anon (and authenticated) can execute it through PostgREST; it returns booleans and counts only.
 * - SECURITY DEFINER with `search_path` pinned to the empty string.
 * - anon can execute no other SECURITY DEFINER function in `public` than the committed allowlist, so a later migration
 *   that leaves a new definer function open to anon (Supabase's default privileges grant EXECUTE to anon) fails here.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { publicEnv } from "@/lib/env";

const ROOT = path.resolve(__dirname, "../..");

/** Every public SECURITY DEFINER function anon may execute, with the plan that opened it. */
const ANON_DEFINER_ALLOWLIST = [
  "consume_reschedule_token", // V2-01 (000020/000023): token-scoped reschedule
  "get_reschedule_context", // V2-01: token-scoped reschedule
  "ops_ingest_error", // V2-03 03-09b: error sink ingest, refused without the ingest key (vault hash)
  "readiness_probe", // V2-03 03-01: counts only
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

describe("readiness_probe() (migration 000025)", () => {
  it("anon executes it through PostgREST and gets booleans and counts only", async () => {
    const anon = createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await anon.rpc("readiness_probe");
    expect(error).toBeNull();
    const body = data as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual([
      "db",
      "latest_migration",
      "messages_failed_24h",
      "messages_pending",
      "webhooks_failed_24h",
      "webhooks_pending",
    ]);
    expect(body.db).toBe(true);
    for (const key of ["messages_pending", "messages_failed_24h", "webhooks_pending", "webhooks_failed_24h"]) {
      expect(Number.isInteger(body[key]), key).toBe(true);
    }
    expect(body.latest_migration).toMatch(/^\d{6}$/);
  });

  it("is SECURITY DEFINER with search_path pinned to the empty string", () => {
    const [row] = psql(
      "select p.prosecdef::text || '|' || array_to_string(p.proconfig, ',') from pg_proc p " +
        "where p.oid = 'public.readiness_probe()'::regprocedure",
    );
    expect(row).toBe('true|search_path=""');
  });

  it("anon and authenticated may execute it; PUBLIC may not", () => {
    const [row] = psql(
      "select has_function_privilege('anon', 'public.readiness_probe()', 'execute')::text || '|' || " +
        "has_function_privilege('authenticated', 'public.readiness_probe()', 'execute')::text || '|' || " +
        "coalesce((select bool_or(a.grantee = 0)::text from pg_proc p, aclexplode(p.proacl) a " +
        "where p.oid = 'public.readiness_probe()'::regprocedure), 'false')",
    );
    expect(row).toBe("true|true|false");
  });

  it("anon can execute no other SECURITY DEFINER function in public", () => {
    const rows = psql(
      "select distinct p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef " +
        "and has_function_privilege('anon', p.oid, 'execute') order by 1",
    );
    expect(rows).toEqual(ANON_DEFINER_ALLOWLIST);
  });
});
