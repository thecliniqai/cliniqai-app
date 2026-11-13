/**
 * V2-03 03-09b (P1-25, FT-07, R-7; T-03-02, T-03-03): the error sink in the live local stack (migration 000028).
 *
 * - `public.ops_ingest_error` through PostgREST as anon: a wrong or missing key writes nothing, the right key writes one
 *   row, a repeat on the same day is one row with `count = 2`, malformed or oversize input is refused, the stored message
 *   is re-scrubbed by the database, and past the daily cap the overflow counter increments instead of a row.
 * - `ops` is invisible to the API roles: anon/authenticated/service_role cannot select or insert, PostgREST serves no
 *   `error_events`, and the retention functions are executable by no API role.
 *
 * Temporary changes (cap 0, vault secret removed, an aged row) run inside one psql session's `begin … rollback`, so no
 * other test session sees them. Every row this file writes carries a random letter tag and is deleted afterwards.
 */
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { publicEnv } from "@/lib/env";
import { LOCAL_ERROR_INGEST_KEY } from "../setup/test-env";
import { psql, psqlSession } from "../helpers/sql";

const TAG = `sinkdb ${Array.from(randomBytes(12), (b) => String.fromCharCode(97 + (b % 26))).join("")}`;

function anon() {
  return createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function event(label: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    environment: "test",
    release: null,
    route_path: "/api/diag/error",
    route_type: "route",
    method: "POST",
    error_name: "SinkDbSpecError",
    error_code: "DIAG_SYNTHETIC",
    digest: null,
    message: `${TAG} ${label}`,
    frames: ["lib/observability/sink.ts:42"],
    request_id: crypto.randomUUID(),
    ...overrides,
  };
}

async function ingest(key: string | null, ev: unknown) {
  return anon().rpc("ops_ingest_error", { p_ingest_key: key, p_event: ev });
}

/** `count|message` of the rows whose message is exactly `${TAG} ${label}` (after the database's re-scrub). */
function rowsFor(label: string): string[] {
  return psql(`select count || '|' || message from ops.error_events where message = '${TAG} ${label}'`);
}

const sqlEvent = (label: string) => JSON.stringify(event(label)).replace(/'/g, "''");

afterAll(() => {
  psql(`delete from ops.error_events where message like '${TAG}%'`);
});

describe("ops_ingest_error: authentication (vault key hash)", () => {
  it("refuses a wrong key and writes nothing", async () => {
    const { error } = await ingest(`${LOCAL_ERROR_INGEST_KEY}x`, event("wrong key"));
    expect(error?.message).toBe("ingest_refused");
    expect(rowsFor("wrong key")).toEqual([]);
  });

  it("refuses a missing key and a short key", async () => {
    expect((await ingest(null, event("no key"))).error?.message).toBe("ingest_refused");
    expect((await ingest("short", event("no key"))).error?.message).toBe("ingest_refused");
    expect(rowsFor("no key")).toEqual([]);
  });

  it("refuses every call while the vault secret is absent", () => {
    const out = psqlSession([
      "begin",
      "delete from vault.secrets where name = 'ops_error_ingest_key_sha256'",
      `do $$ begin perform public.ops_ingest_error('${LOCAL_ERROR_INGEST_KEY}', '${sqlEvent("no secret")}'::jsonb);
         raise notice 'accepted'; exception when insufficient_privilege then null; end $$`,
      `select count(*) from ops.error_events where message = '${TAG} no secret'`,
      "rollback",
    ]);
    expect(out).toEqual(["0"]);
  });
});

describe("ops_ingest_error: rows", () => {
  it("the right key writes one row with the event's fields", async () => {
    const requestId = crypto.randomUUID();
    const { error } = await ingest(LOCAL_ERROR_INGEST_KEY, event("right key", { request_id: requestId }));
    expect(error).toBeNull();
    const [row] = psql(
      "select count, environment, route_path, route_type, method, error_name, error_code, frames::text, " +
        `request_id, fingerprint ~ '^[0-9a-f]{64}$', occurred_on = (now() at time zone 'UTC')::date ` +
        `from ops.error_events where message = '${TAG} right key'`,
    );
    expect(row).toBe(
      `1|test|/api/diag/error|route|POST|SinkDbSpecError|DIAG_SYNTHETIC|{lib/observability/sink.ts:42}|${requestId}|t|t`,
    );
  });

  it("the same fingerprint twice on one day is one row with count = 2 and the latest request id", async () => {
    const second = crypto.randomUUID();
    expect((await ingest(LOCAL_ERROR_INGEST_KEY, event("twice"))).error).toBeNull();
    expect((await ingest(LOCAL_ERROR_INGEST_KEY, event("twice", { request_id: second }))).error).toBeNull();
    expect(rowsFor("twice")).toEqual([`2|${TAG} twice`]);
    expect(psql(`select request_id from ops.error_events where message = '${TAG} twice'`)).toEqual([second]);
  });

  it("re-scrubs the message as a second line of defence (the shared rules: tests/observability/error-sink-scrub-db.spec.ts)", async () => {
    const raw = `${TAG} rescrub synthetic.person@example.com /r/x?phone=9000000031 id 9000000032`;
    expect((await ingest(LOCAL_ERROR_INGEST_KEY, event("x", { message: raw }))).error).toBeNull();
    const rows = psql(`select message from ops.error_events where message like '${TAG} rescrub%'`);
    // 03-13c: the database runs the app's rule list (path token, mobile), not only emails / queries / digit runs.
    expect(rows).toEqual([`${TAG} rescrub [EMAIL] /r/[TOKEN]?[QUERY] id [PHONE REDACTED]`]);
  });
});

describe("ops_ingest_error: refuses malformed or oversize input", () => {
  it.each<[string, Record<string, unknown> | unknown]>([
    // 03-13c: up to 2000 characters are accepted (scrubbed, then cut to 500); beyond that the event is refused.
    ["a message over 2000 characters", event("oversize", { message: `${TAG} oversize ${"m".repeat(2000)}` })],
    ["more than 20 frames", event("oversize", { frames: Array.from({ length: 21 }, (_, i) => `lib/a.ts:${i + 1}`) })],
    ["a frame that is not file:line", event("oversize", { frames: ["at handler (/srv/a.ts:1:2)"] })],
    ["an unknown key", { ...event("oversize"), headers: "cookie: x" }],
    ["a concrete path with a query string", event("oversize", { route_path: "/r/abc?phone=9000000033" })],
    ["a request id that is not a UUID", event("oversize", { request_id: "not-a-uuid" })],
    ["an unknown environment", event("oversize", { environment: "prod" })],
    ["a non-string field", event("oversize", { method: 7 })],
    ["no error name", event("oversize", { error_name: null })],
    ["a JSON array instead of an object", [event("oversize")]],
  ])("refuses %s", async (_label, ev) => {
    const { error } = await ingest(LOCAL_ERROR_INGEST_KEY, ev);
    expect(error?.message).toBe("invalid_event");
    expect(psql(`select count(*) from ops.error_events where message like '${TAG} oversize%'`)).toEqual(["0"]);
  });
});

describe("ops_ingest_error: daily cap (T-03-02)", () => {
  it("past the cap a new fingerprint increments the overflow counter instead of adding a row", () => {
    const today = "(now() at time zone 'UTC')::date";
    const out = psqlSession([
      "begin",
      `select coalesce((select dropped from ops.error_event_overflow where day = ${today}), 0)`,
      "create or replace function ops.error_sink_daily_cap() returns integer language sql stable set search_path = '' as $$ select 0 $$",
      `select public.ops_ingest_error('${LOCAL_ERROR_INGEST_KEY}', '${sqlEvent("capped")}'::jsonb)`,
      `select public.ops_ingest_error('${LOCAL_ERROR_INGEST_KEY}', '${sqlEvent("capped too")}'::jsonb)`,
      `select (select dropped from ops.error_event_overflow where day = ${today}) || '|' ||
              (select count(*) from ops.error_events where message like '${TAG} capped%')`,
      "rollback",
    ]);
    const before = Number(out[0]);
    // Each ingest prints an empty line for the void result, which the helper drops.
    expect(out.at(-1)).toBe(`${before + 2}|0`);
  });

  it("an existing fingerprint is still counted past the cap", async () => {
    expect((await ingest(LOCAL_ERROR_INGEST_KEY, event("repeat past cap"))).error).toBeNull();
    const out = psqlSession([
      "begin",
      "create or replace function ops.error_sink_daily_cap() returns integer language sql stable set search_path = '' as $$ select 0 $$",
      `select public.ops_ingest_error('${LOCAL_ERROR_INGEST_KEY}', '${sqlEvent("repeat past cap")}'::jsonb)`,
      `select count from ops.error_events where message = '${TAG} repeat past cap'`,
      "rollback",
    ]);
    expect(out.at(-1)).toBe("2");
  });

  it("the shipped cap is 500 new fingerprints per UTC day", () => {
    expect(psql("select ops.error_sink_daily_cap()")).toEqual(["500"]);
  });
});

describe("ops schema is invisible to the API roles", () => {
  it("anon, authenticated and service_role have no schema usage and no table privilege", () => {
    const rows = psql(
      "select r || '|' || has_schema_privilege(r, 'ops', 'usage') || '|' || " +
        "has_table_privilege(r, 'ops.error_events', 'select') || '|' || " +
        "has_table_privilege(r, 'ops.error_events', 'insert') || '|' || " +
        "has_table_privilege(r, 'ops.error_event_overflow', 'select') " +
        "from unnest(array['anon', 'authenticated', 'service_role']) r order by 1",
    );
    expect(rows).toEqual(["anon|false|false|false|false", "authenticated|false|false|false|false", "service_role|false|false|false|false"]);
  });

  it.each(["anon", "authenticated"])("%s cannot select from or insert into ops.error_events", (role) => {
    expect(() => psqlSession([`set role ${role}`, "select count(*) from ops.error_events"])).toThrow(/permission denied/);
    expect(() =>
      psqlSession([
        `set role ${role}`,
        "insert into ops.error_events (fingerprint, occurred_on, environment, error_name, message) " +
          `values (repeat('a', 64), current_date, 'test', 'X', '${TAG} direct')`,
      ]),
    ).toThrow(/permission denied/);
  });

  it("PostgREST serves no error_events, in public or in ops", async () => {
    const publicTable = await anon().from("error_events").select("*");
    expect(publicTable.error?.code).toBe("PGRST205");
    const opsTable = await anon().schema("ops").from("error_events").select("*");
    expect(opsTable.error?.code).toBe("PGRST106");
    expect(opsTable.data).toBeNull();
  });

  it("retention and cap functions are executable by no API role; ingest by anon and authenticated only", () => {
    const rows = psql(
      "select f || '|' || string_agg(r || '=' || has_function_privilege(r, f, 'execute'), ',' order by r) from " +
        "unnest(array['ops.purge_error_events(interval)', 'ops.error_events_size()', 'ops.error_sink_daily_cap()', " +
        "'public.ops_ingest_error(text, jsonb)']) f, unnest(array['anon', 'authenticated', 'service_role']) r " +
        "group by f order by f",
    );
    expect(rows).toEqual([
      "ops.error_events_size()|anon=false,authenticated=false,service_role=false",
      "ops.error_sink_daily_cap()|anon=false,authenticated=false,service_role=false",
      "ops.purge_error_events(interval)|anon=false,authenticated=false,service_role=false",
      "public.ops_ingest_error(text, jsonb)|anon=true,authenticated=true,service_role=false",
    ]);
  });

  it("ops_ingest_error is SECURITY DEFINER with search_path pinned to the empty string", () => {
    expect(
      psql(
        "select p.prosecdef::text || '|' || array_to_string(p.proconfig, ',') from pg_proc p " +
          "where p.oid = 'public.ops_ingest_error(text, jsonb)'::regprocedure",
      ),
    ).toEqual(['true|search_path="",lock_timeout=1s']);
  });
});

describe("retention (FT-07)", () => {
  it("purge deletes rows not seen within the window and refuses a window under a day", () => {
    const out = psqlSession([
      "begin",
      "insert into ops.error_events (fingerprint, occurred_on, first_seen, last_seen, environment, error_name, message) " +
        `values (repeat('b', 64), current_date - 200, now() - interval '200 days', now() - interval '200 days', 'test', 'X', '${TAG} aged')`,
      `select ops.purge_error_events() >= 1`,
      `select count(*) from ops.error_events where message = '${TAG} aged'`,
      "rollback",
    ]);
    expect(out).toEqual(["t", "0"]);
    expect(() => psql("select ops.purge_error_events(interval '1 hour')")).toThrow(/invalid_retention/);
  });

  it("size reports rows and bytes", () => {
    const [json] = psql("select ops.error_events_size()");
    const size = JSON.parse(json) as Record<string, unknown>;
    expect(Object.keys(size).sort()).toEqual(["bytes", "oldest_last_seen", "rows"]);
    expect(Number.isInteger(size.rows)).toBe(true);
    expect(Number(size.bytes)).toBeGreaterThan(0);
  });
});
