/**
 * V2-06 06-04a step 2 (R-3; T-06-09, T-06-10): `reportClientRenderError` against the live local stack's error sink.
 *
 * A member's report becomes one `ops.error_events` row with `error_name = client.<name>`, the route pattern,
 * `route_type = render` and nothing else (empty message and frames; no method, digest or request id). An
 * identifier-shaped name is stored as `client.Error`; a concrete route (UUID, 6+ digits) as `/`; extra keys are ignored;
 * an oversize name or route, no session and no membership are refused with `{ ok: false }` and write nothing. The guard legs of the
 * manifest entry run in tests/security/guard-actions.spec.ts as well.
 *
 * `createClient()` from `@/lib/supabase/server` returns the leg's real client (anonymous or a seeded user's JWT client).
 * Every row this file writes carries a random tag in its name or route and is deleted afterwards.
 */
import { createClient } from "@supabase/supabase-js";
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { publicEnv } from "@/lib/env";
import { resetClientKeyState } from "@/lib/observability/client-render-event";
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

/** Lower-case letters only: valid in a class name and in a static route segment. */
const TAG = Array.from(randomBytes(10), (b) => String.fromCharCode(97 + (b % 26))).join("");
const name = (label: string) => `${label}Spec${TAG}`;

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

let ownerClient: unknown;
let outsiderClient: unknown;

beforeAll(async () => {
  ownerClient = (await seedTenantWithOwner(`Client Error Spec ${TAG}`)).client;
  outsiderClient = (await createUnlinkedUser()).client;
});

beforeEach(() => {
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
  psql(`delete from ops.error_events where error_name like 'client.%Spec${TAG}' or route_path like '/spec-${TAG}%'`);
});

describe("reportClientRenderError → ops.error_events", () => {
  it("a member's report is one row with the class name and route pattern and nothing else; a repeat counts", async () => {
    const n = name("Render");
    expect(await reportClientRenderError({ name: n, route: "/diag/client-error" })).toEqual({ ok: true });

    expect(byName(n)).toEqual([
      {
        error_name: `client.${n}`,
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

    expect(await reportClientRenderError({ name: n, route: "/diag/client-error" })).toEqual({ ok: true });
    expect(byName(n).map((r) => r.count)).toEqual([2]);
  });

  it("an identifier-shaped name (Error123456) is stored as client.Error", async () => {
    const route = `/spec-${TAG}/[id]`;
    expect(await reportClientRenderError({ name: "Error123456", route })).toEqual({ ok: true });
    expect(rows(`route_path = '${route}'`).map((r) => r.error_name)).toEqual(["client.Error"]);
    expect(rows(`error_name like '%123456%'`)).toEqual([]);
  });

  it.each([
    ["a UUID segment", "Uuid", `/patients/${randomUUID()}`],
    ["a 6+ digit segment", "Digits", "/x/1234567"],
    ["an email segment", "Email", "/x/someone@example.com"],
    ["a query string", "Query", "/patients?phone=9000000000"],
  ])("a route with %s is stored as /", async (_label, label, route) => {
    const n = name(label);
    expect(await reportClientRenderError({ name: n, route })).toEqual({ ok: true });
    expect(byName(n).map((r) => r.route_path)).toEqual(["/"]);
  });

  it("a 300-character route is refused by the schema and writes nothing", async () => {
    const n = name("TooLong");
    expect(await reportClientRenderError({ name: n, route: `/${"a".repeat(299)}` })).toEqual({ ok: false });
    expect(byName(n)).toEqual([]);
  });

  it("an 81-character name is refused and writes nothing", async () => {
    const n = `A${TAG}${"a".repeat(80)}`.slice(0, 81);
    expect(await reportClientRenderError({ name: n, route: "/" })).toEqual({ ok: false });
    expect(byName(n)).toEqual([]);
  });

  it("extra keys (a message, frames, acting ids) are ignored: only the name and route are stored", async () => {
    const n = name("Extra");
    const withExtra = {
      name: n,
      route: "/queue",
      message: "free text +919000000000",
      frames: ["app/x.tsx:1"],
      digest: "abc123",
      tenant_id: randomUUID(),
    } as unknown as { name: string; route: string };
    expect(await reportClientRenderError(withExtra)).toEqual({ ok: true });
    expect(byName(n)).toMatchObject([{ route_path: "/queue", message: "", frames: [], digest: null }]);
  });

  it("no session: refused, nothing written", async () => {
    slot.client = createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const n = name("Anon");
    expect(await reportClientRenderError({ name: n, route: "/queue" })).toEqual({ ok: false });
    expect(byName(n)).toEqual([]);
  });

  it("signed in without a clinic membership: refused, nothing written", async () => {
    slot.client = outsiderClient;
    const n = name("Outsider");
    expect(await reportClientRenderError({ name: n, route: "/queue" })).toEqual({ ok: false });
    expect(byName(n)).toEqual([]);
  });

  it("without the ingest key the report is accepted and nothing is written (sink disabled)", async () => {
    vi.stubEnv("ERROR_INGEST_KEY", undefined);
    const n = name("NoKey");
    expect(await reportClientRenderError({ name: n, route: "/queue" })).toEqual({ ok: true });
    expect(byName(n)).toEqual([]);
  });
});
