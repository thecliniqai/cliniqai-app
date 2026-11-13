/**
 * V2-03 03-13c (03-13-REVIEW-TRIAGE.md M-SCRUB, DB half; review C M-2/L-3/L-4/L-5, review B L-2/L-3; migration 000029):
 * the database's second-line scrub in `public.ops_ingest_error`, driven by the shared vectors
 * `tests/fixtures/scrub-vectors.json` that the app scrubber (lib/observability/scrub.ts) also runs. Every event goes in
 * through PostgREST as anon with the ingest key (the sink's real path) and is read back from `ops.error_events`.
 *
 * - messages: the stored message contains none of `absent`, all of `kept`, is one line and at most 500 characters;
 * - benign text is stored word-for-word;
 * - error_name / error_code: stored exactly as `stored`, or (null) the code is NULL and the name is `Error`;
 * - route_path: a route pattern is kept; a concrete path is stored as NULL (or the event refused for bad characters);
 * - the scrub runs before the cut: a scrub that lengthens text no longer breaks the column CHECK (B L-2), and a cut
 *   cannot split a phone number the scrub would have caught;
 * - hostile 2000-character inputs are scrubbed in bounded time.
 */
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it } from "vitest";
import { publicEnv } from "@/lib/env";
import { LOCAL_ERROR_INGEST_KEY } from "../setup/test-env";
import { psql } from "../helpers/sql";

type Vectors = {
  messages: Array<{ id: string; input: string; absent: string[]; kept: string[] }>;
  benign: string[];
  fields: Array<{ id: string; field: "error_name" | "error_code"; input: string; stored: string | null }>;
  routes: { accept: string[]; reject: string[] };
};

const VECTORS = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../fixtures/scrub-vectors.json"), "utf8"),
) as Vectors;

const requestIds: string[] = [];

function anon() {
  return createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Ingests one event with a fresh request id and returns the stored row (or the RPC error). */
async function ingestAndRead(overrides: Record<string, unknown>) {
  const requestId = crypto.randomUUID();
  requestIds.push(requestId);
  const { error } = await anon().rpc("ops_ingest_error", {
    p_ingest_key: LOCAL_ERROR_INGEST_KEY,
    p_event: {
      environment: "test",
      route_path: "/api/diag/error",
      route_type: "route",
      method: "POST",
      error_name: "ScrubDbSpecError",
      error_code: "DIAG_SYNTHETIC",
      message: "scrub db spec",
      frames: ["lib/observability/sink.ts:42"],
      request_id: requestId,
      ...overrides,
    },
  });
  if (error) return { error: error.message, row: null };
  const [json] = psql(
    "select json_build_object('message', message, 'error_name', error_name, 'error_code', error_code, " +
      `'route_path', route_path) from ops.error_events where request_id = '${requestId}'`,
  );
  return {
    error: null,
    row: JSON.parse(json) as { message: string; error_name: string; error_code: string | null; route_path: string | null },
  };
}

afterAll(() => {
  if (requestIds.length > 0) {
    psql(`delete from ops.error_events where request_id in (${requestIds.map((id) => `'${id}'`).join(", ")})`);
  }
});

describe("ops_ingest_error second scrub: shared message vectors", () => {
  it.each(VECTORS.messages.map((v) => [v.id, v] as const))("message %s", async (_id, vector) => {
    const { error, row } = await ingestAndRead({ message: vector.input });
    expect(error).toBeNull();
    for (const value of vector.absent) expect(row!.message).not.toContain(value);
    for (const value of vector.kept) expect(row!.message).toContain(value);
    expect(row!.message).not.toContain("\n");
    expect(row!.message.length).toBeLessThanOrEqual(500);
  });

  it.each(VECTORS.benign)("benign text is stored word-for-word: %s", async (text) => {
    const { error, row } = await ingestAndRead({ message: text });
    expect(error).toBeNull();
    expect(row!.message).toBe(text);
  });
});

describe("ops_ingest_error second scrub: error_name, error_code, route_path", () => {
  it.each(VECTORS.fields.map((v) => [v.id, v] as const))("field %s", async (_id, vector) => {
    const { error, row } = await ingestAndRead({ [vector.field]: vector.input });
    expect(error).toBeNull();
    if (vector.field === "error_name") expect(row!.error_name).toBe(vector.stored ?? "Error");
    else expect(row!.error_code).toBe(vector.stored);
  });

  it.each(VECTORS.routes.accept)("route pattern kept: %s", async (route) => {
    const { error, row } = await ingestAndRead({ route_path: route });
    expect(error).toBeNull();
    expect(row!.route_path).toBe(route);
  });

  it.each(VECTORS.routes.reject)("concrete or malformed route not stored: %s", async (route) => {
    const { error, row } = await ingestAndRead({ route_path: route });
    if (error) expect(error).toBe("invalid_event");
    else expect(row!.route_path).toBeNull();
  });
});

describe("ops_ingest_error second scrub: cut after the scrub (review B L-2)", () => {
  it("a 498-character message the scrub lengthens is stored (cut to 500), not refused by the column CHECK", async () => {
    const { error, row } = await ingestAndRead({ message: "?a ".repeat(166).trimEnd() });
    expect(error).toBeNull();
    expect(row!.message.length).toBe(500);
    expect(row!.message.startsWith("?[QUERY]")).toBe(true);
  });

  it("a message over 2000 characters is refused before any work", async () => {
    const { error } = await ingestAndRead({ message: "m".repeat(2001) });
    expect(error).toBe("invalid_event");
  });

  it("hostile 2000-character inputs are scrubbed in bounded time", async () => {
    const hostile = [
      "Key (".repeat(400),
      "+91 ".repeat(500),
      "a.a.".repeat(499) + "@x",
      "1-".repeat(1000),
      "(((".repeat(666),
      `${"a1".repeat(999)}!`,
    ];
    const started = Date.now();
    for (const message of hostile) {
      const { error, row } = await ingestAndRead({ message: message.slice(0, 2000) });
      expect(error).toBeNull();
      expect(row!.message.length).toBeLessThanOrEqual(500);
    }
    expect(Date.now() - started).toBeLessThan(10_000);
  });
});
