/**
 * V2-06 06-04a step 2 (R-3; T-06-09, T-06-10): `reportClientRenderError` against the live local stack's error sink.
 *
 * A member's report becomes one `ops.error_events` row with `error_name = client.<name>`, the route pattern,
 * `route_type = render` and nothing else (empty message and frames; no method, digest or request id). 06-09a M-ERRCAP:
 * only listed class names and the dashboard's own route patterns are kept; anything else (identifier-shaped, made up,
 * PHI-shaped free text) is stored as `client.Error` / `/` and never appears in a row or a log line. A repeat within a
 * minute is dropped without a log line or write (C L-1); the first report over the per-instance key cap writes one
 * counter line (C L-2). Extra keys are ignored; an oversize name or route, no session and no membership are refused
 * with `{ ok: false }` and write nothing. The guard legs of the manifest entry run in
 * tests/security/guard-actions.spec.ts as well.
 *
 * `createClient()` from `@/lib/supabase/server` returns the leg's real client (anonymous or a seeded user's JWT client).
 * Client rows are no longer taggable (closed names and routes), so every `client.%` row of the `test` environment is
 * deleted before each case and afterwards (only this file and the guard spec write them; runs hold the stack lock).
 */
import { createClient } from "@supabase/supabase-js";
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { publicEnv } from "@/lib/env";
import { CLIENT_ERROR_NAMES, CLIENT_KEYS_PER_DAY, CLIENT_REPEAT_WINDOW_MS, resetClientKeyState } from "@/lib/observability/client-render-event";
import { CLIENT_ROUTE_PATTERNS } from "@/lib/observability/client-routes";
import { resetSinkFloodState } from "@/lib/observability/sink";
import { LOCAL_ERROR_INGEST_KEY } from "../setup/test-env";
import { psql } from "../helpers/sql";
import { createUnlinkedUser, seedTenantWithOwner } from "../helpers/tenants";

const slot = vi.hoisted((): { client: unknown } => ({ client: null }));

vi.mock("@/lib/supabase/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/server")>();
  return { ...actual, createClient: async () => slot.client };
});

vi.mock("next/headers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/headers")>();
  const store = { get: () => undefined, getAll: () => [], has: () => false, set: () => undefined, delete: () => undefined };
  return { ...actual, cookies: async () => store };
});

const { reportClientRenderError } = await import("@/features/observability/actions");

/** Lower-case letters only (identifier-free), used to build made-up names that must never be stored. */
const TAG = Array.from(randomBytes(10), (b) => String.fromCharCode(97 + (b % 26))).join("");
const name = (label: string) => `${label}Spec${TAG}`;
const CLEAN = "environment = 'test' and error_name like 'client.%'";

interface Row {
  error_name: string;
  route_path: string | null;
  route_type: string | null;
  method: string | null;
  digest: string | null;
  error_code: string | null;
  message: string;
  frames: string[];
  request_id: string | null;
  count: number;
  environment: string;
}

function rows(where: string): Row[] {
  const [json] = psql(`select coalesce(json_agg(e), '[]'::json) from (
    select error_name, route_path, route_type, method, digest, error_code, message, frames, request_id, count, environment
      from ops.error_events where ${where}) e`);
  return JSON.parse(json) as Row[];
}
const byName = (n: string) => rows(`error_name = 'client.${n}'`);
const at = (n: string, route: string) => rows(`error_name = 'client.${n}' and route_path = '${route}'`);
/** Every line the action logged since the spies were installed. */
const logged = () =>
  [...vi.mocked(process.stdout.write).mock.calls, ...vi.mocked(process.stderr.write).mock.calls].map((c) => String(c[0])).join("");

let ownerClient: unknown;
let outsiderClient: unknown;

beforeAll(async () => {
  ownerClient = (await seedTenantWithOwner(`Client Error Spec ${TAG}`)).client;
  outsiderClient = (await createUnlinkedUser()).client;
});

beforeEach(() => {
  psql(`delete from ops.error_events where ${CLEAN}`);
  resetSinkFloodState();
  resetClientKeyState();
  vi.stubEnv("ERROR_INGEST_KEY", LOCAL_ERROR_INGEST_KEY);
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  slot.client = ownerClient;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

afterAll(() => {
  psql(`delete from ops.error_events where ${CLEAN}`);
});

describe("reportClientRenderError → ops.error_events", () => {
  it("a member's report is one row with the class name and route pattern and nothing else; a repeat after a minute counts", async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    expect(await reportClientRenderError({ name: "TypeError", route: "/diag/client-error" })).toEqual({ ok: true });

    expect(at("TypeError", "/diag/client-error")).toEqual([
      {
        error_name: "client.TypeError",
        route_path: "/diag/client-error",
        route_type: "render",
        method: null,
        digest: null,
        error_code: null,
        message: "",
        frames: [],
        request_id: null,
        count: 1,
        environment: "test",
      },
    ]);

    clock.mockReturnValue(now + CLIENT_REPEAT_WINDOW_MS);
    expect(await reportClientRenderError({ name: "TypeError", route: "/diag/client-error" })).toEqual({ ok: true });
    expect(at("TypeError", "/diag/client-error").map((r) => r.count)).toEqual([2]);
  });

  it("C L-1: a repeat within a minute writes nothing and logs nothing", async () => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    expect(await reportClientRenderError({ name: "RangeError", route: "/queue" })).toEqual({ ok: true });
    const lines = logged().split("\n").filter((l) => l.includes('"event":"client.render_error"')).length;
    for (let i = 0; i < 5; i++) expect(await reportClientRenderError({ name: "RangeError", route: "/queue" })).toEqual({ ok: true });
    expect(at("RangeError", "/queue").map((r) => r.count)).toEqual([1]);
    expect(logged().split("\n").filter((l) => l.includes('"event":"client.render_error"')).length).toBe(lines);
  });

  it("an identifier-shaped or unlisted name (Error123456, a made-up class) is stored as client.Error", async () => {
    expect(await reportClientRenderError({ name: "Error123456", route: "/queue" })).toEqual({ ok: true });
    expect(await reportClientRenderError({ name: name("Made"), route: "/patients" })).toEqual({ ok: true });
    expect(at("Error", "/queue")).toHaveLength(1);
    expect(at("Error", "/patients")).toHaveLength(1);
    expect(rows(`error_name like '%123456%' or error_name like '%${TAG}%'`)).toEqual([]);
  });

  it.each([
    ["a UUID segment", `/patients/${randomUUID()}`],
    ["a 6+ digit segment", "/x/1234567"],
    ["an email segment", "/x/someone@example.com"],
    ["a query string", "/patients?phone=9000000000"],
    ["a made-up static route", `/spec-${TAG}/[id]`],
  ])("a route with %s is stored as /", async (_label, route) => {
    expect(await reportClientRenderError({ name: "SyntaxError", route })).toEqual({ ok: true });
    expect(byName("SyntaxError").map((r) => r.route_path)).toEqual(["/"]);
  });

  it("M-2 reproduction: PHI-shaped free text in the name and route reaches neither the row nor the log", async () => {
    const phi = { name: "Ravi_Kumar_ph_98765-43210", route: "/patients/[Ravi_Kumar_98765_43210]" };
    expect(await reportClientRenderError(phi)).toEqual({ ok: true });
    expect(await reportClientRenderError({ name: "Asha.Rao.F.52.HbA1c-9.8", route: "/patients/asha-rao/hiv-positive" })).toEqual({
      ok: true,
    });
    expect(rows(CLEAN).map((r) => `${r.error_name} ${r.route_path}`)).toEqual(["client.Error /"]);
    expect(rows(`error_name ~* 'ravi|asha|98765' or route_path ~* 'ravi|asha|98765|hiv'`)).toEqual([]);
    expect(logged()).not.toMatch(/Ravi|Asha|98765|hiv/i);
  });

  it("C L-2: the first report over the instance's daily key cap writes one counter line; later ones write nothing", async () => {
    vi.stubEnv("ERROR_INGEST_KEY", undefined); // the counting is per instance; no rows needed
    const keys = CLIENT_ROUTE_PATTERNS.flatMap((route) => CLIENT_ERROR_NAMES.map((n) => ({ name: n, route })));
    for (const key of keys.slice(0, CLIENT_KEYS_PER_DAY)) expect(await reportClientRenderError(key)).toEqual({ ok: true });
    const capLines = () => logged().split("\n").filter((l) => l.includes('"event":"observability.sink.client_cap_reached"'));
    expect(capLines()).toEqual([]);
    for (const key of keys.slice(CLIENT_KEYS_PER_DAY, CLIENT_KEYS_PER_DAY + 3)) {
      expect(await reportClientRenderError(key)).toEqual({ ok: true });
    }
    expect(capLines()).toHaveLength(1);
    expect(JSON.parse(capLines()[0]!)).toMatchObject({ count: CLIENT_KEYS_PER_DAY });
  });

  it("a 300-character route is refused by the schema and writes nothing", async () => {
    expect(await reportClientRenderError({ name: "ReferenceError", route: `/${"a".repeat(299)}` })).toEqual({ ok: false });
    expect(byName("ReferenceError")).toEqual([]);
  });

  it("an 81-character name is refused and writes nothing", async () => {
    const n = `A${TAG}${"a".repeat(80)}`.slice(0, 81);
    expect(await reportClientRenderError({ name: n, route: "/" })).toEqual({ ok: false });
    expect(rows(CLEAN)).toEqual([]);
  });

  it("extra keys (a message, frames, acting ids) are ignored: only the name and route are stored", async () => {
    const withExtra = {
      name: "AbortError",
      route: "/queue",
      message: "free text +919000000000",
      frames: ["app/x.tsx:1"],
      digest: "abc123",
      tenant_id: randomUUID(),
    } as unknown as { name: string; route: string };
    expect(await reportClientRenderError(withExtra)).toEqual({ ok: true });
    expect(byName("AbortError")).toMatchObject([{ route_path: "/queue", message: "", frames: [], digest: null }]);
  });

  it("no session: refused, nothing written", async () => {
    slot.client = createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    expect(await reportClientRenderError({ name: "TypeError", route: "/queue" })).toEqual({ ok: false });
    expect(rows(CLEAN)).toEqual([]);
  });

  it("signed in without a clinic membership: refused, nothing written", async () => {
    slot.client = outsiderClient;
    expect(await reportClientRenderError({ name: "TypeError", route: "/queue" })).toEqual({ ok: false });
    expect(rows(CLEAN)).toEqual([]);
  });

  it("without the ingest key the report is accepted and nothing is written (sink disabled)", async () => {
    vi.stubEnv("ERROR_INGEST_KEY", undefined);
    expect(await reportClientRenderError({ name: "TypeError", route: "/queue" })).toEqual({ ok: true });
    expect(rows(CLEAN)).toEqual([]);
  });
});
