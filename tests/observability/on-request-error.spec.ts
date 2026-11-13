/**
 * V2-03 03-09b (P1-25, FT-07; T-03-03, T-03-14): `instrumentation.ts` `onRequestError` end to end against the local
 * stack's sink.
 *
 * An error carrying synthetic PII (a +91 mobile in a Postgres `Key (…)=(…)` detail, an email, a UUID) on a request whose
 * concrete path holds a share token and `?phone=…` lands as exactly one `ops.error_events` row: the message is scrubbed,
 * `route_path` is the route pattern, no query string or identifier appears in any column, and the export checker
 * passes the row. The one log line carries the request id and code, never the message. Without the ingest key nothing
 * is written; a failing sink never throws.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onRequestError } from "@/instrumentation";
import { reportRequestError } from "@/lib/observability/sink";
import { checkErrorExport } from "@/scripts/ops/check-error-export.mjs";
import { exportSql } from "@/scripts/ops/export-error-events.mjs";
import { LOCAL_ERROR_INGEST_KEY } from "../setup/test-env";
import { psql } from "../helpers/sql";

const PHONE = "+919000000041";
const EMAIL = "synthetic.onrequest@example.com";
/** A share-link-shaped synthetic token, assembled at runtime so secret scanners do not read it as a key. */
const TOKEN = ["k7Qp", "2xZ9", "mN4v", "B8sL", "1tR6"].join("");
const PATIENT_ID = "3f2b8c4e-1a2b-4c3d-8e9f-0123456789ab";

function syntheticError(): Error {
  const err = new Error(
    `duplicate key value violates unique constraint "patients_phone_key" Key (phone)=(${PHONE}) ` +
      `for ${EMAIL} patient ${PATIENT_ID}`,
  );
  return Object.assign(err, { code: "23505", digest: "2789455318" });
}

function request(requestId: string) {
  return {
    path: `/r/${TOKEN}?phone=${encodeURIComponent(PHONE)}&email=${encodeURIComponent(EMAIL)}`,
    method: "GET",
    headers: { "x-request-id": requestId, cookie: `sb-access-token=${TOKEN}`, "user-agent": "SyntheticAgentMarker" },
  };
}

const CONTEXT = {
  routerKind: "App Router",
  routePath: "/r/[token]",
  routeType: "route",
  revalidateReason: undefined,
} as const;

function rowsFor(requestId: string): Record<string, unknown>[] {
  const [json] = psql(exportSql([requestId]));
  return JSON.parse(json) as Record<string, unknown>[];
}

const created: string[] = [];

beforeEach(() => {
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  if (created.length) psql(`delete from ops.error_events where request_id in (${created.map((id) => `'${id}'`).join(",")})`);
  created.length = 0;
});

describe("onRequestError → ops.error_events", () => {
  it("writes one scrubbed row with the route pattern and no query string", async () => {
    vi.stubEnv("ERROR_INGEST_KEY", LOCAL_ERROR_INGEST_KEY);
    const requestId = crypto.randomUUID();
    created.push(requestId);
    const lines: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
      lines.push(String(chunk));
      return true;
    });

    await onRequestError(syntheticError(), request(requestId), CONTEXT);

    const rows = rowsFor(requestId);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.route_path).toBe("/r/[token]");
    expect(row.route_type).toBe("route");
    expect(row.method).toBe("GET");
    expect(row.error_name).toBe("Error");
    expect(row.error_code).toBe("23505");
    expect(row.digest).toBe("2789455318");
    expect(row.environment).toBe("test");
    expect(row.request_id).toBe(requestId);
    expect(row.message).toBe(
      'duplicate key value violates unique constraint "patients_phone_key" Key (phone)=([REDACTED]) ' +
        "for [EMAIL] patient [UUID]",
    );
    expect((row.frames as string[]).length).toBeGreaterThan(0);
    expect((row.frames as string[]).some((f) => f.startsWith("tests/observability/on-request-error.spec.ts:"))).toBe(true);

    const everything = JSON.stringify(row);
    for (const secret of [PHONE, "9000000041", EMAIL, TOKEN, PATIENT_ID, "?phone", "&email", "sb-access-token", "SyntheticAgentMarker"]) {
      expect(everything).not.toContain(secret);
    }
    expect(everything).not.toMatch(/\/(Users|home|srv)\//);
    expect(checkErrorExport(rows)).toEqual([]);

    // One log line: request id, route pattern and code; never the message.
    const logLines = lines.filter((l) => l.includes('"request.error"'));
    expect(logLines).toHaveLength(1);
    const logged = JSON.parse(logLines[0]) as Record<string, unknown>;
    expect(logged).toMatchObject({ level: "error", event: "request.error", requestId, route: "/r/[token]", code: "23505" });
    expect(logLines[0]).not.toContain("9000000041");
    expect(logLines[0]).not.toContain(EMAIL);
  });

  it("without ERROR_INGEST_KEY it logs but writes nothing", async () => {
    vi.stubEnv("ERROR_INGEST_KEY", undefined);
    const requestId = crypto.randomUUID();
    created.push(requestId);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const result = await reportRequestError(syntheticError(), request(requestId), CONTEXT);
    expect(result.outcome).toBe("disabled");
    expect(rowsFor(requestId)).toEqual([]);
  });

  it("a failing sink never throws and logs only the error tag", async () => {
    vi.stubEnv("ERROR_INGEST_KEY", LOCAL_ERROR_INGEST_KEY);
    const lines: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
      lines.push(String(chunk));
      return true;
    });
    const failing = (async () => {
      throw new TypeError(`fetch failed for ${EMAIL}`);
    }) as typeof fetch;
    const result = await reportRequestError(syntheticError(), request(crypto.randomUUID()), CONTEXT, {
      fetchImpl: failing,
    });
    expect(result.outcome).toBe("failed");
    const failure = lines.find((l) => l.includes("observability.sink.failed"));
    expect(failure).toBeDefined();
    expect(JSON.parse(failure!)).toMatchObject({ code: "TypeError" });
    expect(lines.join("")).not.toContain(EMAIL);
  });

  it("a refused ingest (wrong key) is reported as refused and writes nothing", async () => {
    vi.stubEnv("ERROR_INGEST_KEY", `${LOCAL_ERROR_INGEST_KEY}-wrong`);
    const requestId = crypto.randomUUID();
    created.push(requestId);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const result = await reportRequestError(syntheticError(), request(requestId), CONTEXT);
    expect(result.outcome).toBe("refused");
    expect(rowsFor(requestId)).toEqual([]);
  });

  it("does nothing outside the Node.js runtime", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");
    vi.stubEnv("ERROR_INGEST_KEY", LOCAL_ERROR_INGEST_KEY);
    const requestId = crypto.randomUUID();
    created.push(requestId);
    await onRequestError(syntheticError(), request(requestId), CONTEXT);
    expect(rowsFor(requestId)).toEqual([]);
  });
});
