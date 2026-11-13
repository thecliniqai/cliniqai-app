/**
 * V2-03 03-13d (review C L-1): the error sink's per-fingerprint flood bound. One bug whose message varies per request
 * would otherwise create a new `ops.error_events` fingerprint per request and use up the daily new-fingerprint cap.
 * Per instance and UTC day, one (route, error name, code) sends at most FLOOD_DISTINCT_PER_KEY distinct messages;
 * repeats and other routes still go through. The sink transport is injected (no database involved).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FLOOD_DISTINCT_PER_KEY, reportRequestError, resetSinkFloodState } from "@/lib/observability/sink";
import { LOCAL_ERROR_INGEST_KEY } from "../setup/test-env";

const CONTEXT = { routePath: "/api/v1/patients/[id]", routeType: "route" } as const;

beforeEach(() => {
  resetSinkFloodState();
  vi.stubEnv("ERROR_INGEST_KEY", LOCAL_ERROR_INGEST_KEY);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function okSink() {
  return vi.fn(async () => new Response(null, { status: 204 })) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

describe("error sink flood bound", () => {
  it(`one route's varying messages send at most ${FLOOD_DISTINCT_PER_KEY} events; the rest are dropped`, async () => {
    const sink = okSink();
    const outcomes: string[] = [];
    for (let i = 0; i < FLOOD_DISTINCT_PER_KEY + 40; i++) {
      const err = new SyntaxError(`Unexpected token x in JSON at position ${i}`);
      outcomes.push((await reportRequestError(err, { method: "POST" }, CONTEXT, { fetchImpl: sink })).outcome);
    }
    expect(sink).toHaveBeenCalledTimes(FLOOD_DISTINCT_PER_KEY);
    expect(outcomes.filter((o) => o === "dropped")).toHaveLength(40);
  });

  it("repeats of an admitted message and errors on other routes still go through", async () => {
    const sink = okSink();
    // One construction site, so a repeated message also has the same first frame (the fingerprint's other part).
    const errorAt = (i: number) => new SyntaxError(`position ${i}`);
    for (let i = 0; i < FLOOD_DISTINCT_PER_KEY + 5; i++) {
      await reportRequestError(errorAt(i), { method: "POST" }, CONTEXT, { fetchImpl: sink });
    }
    const repeat = await reportRequestError(errorAt(0), { method: "POST" }, CONTEXT, { fetchImpl: sink });
    const other = await reportRequestError(new SyntaxError("position 999"), { method: "GET" }, { routePath: "/api/health", routeType: "route" }, { fetchImpl: sink });
    expect(repeat.outcome).toBe("sent");
    expect(other.outcome).toBe("sent");
  });

  it("logs the drop once per key, without the message", async () => {
    const lines: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
      lines.push(String(chunk));
      return true;
    });
    const sink = okSink();
    for (let i = 0; i < FLOOD_DISTINCT_PER_KEY + 10; i++) {
      await reportRequestError(new SyntaxError(`flood ${i} for synthetic.flood@example.com`), { method: "POST" }, CONTEXT, { fetchImpl: sink });
    }
    const drops = lines.filter((l) => l.includes("observability.sink.flood_dropped"));
    expect(drops).toHaveLength(1);
    expect(lines.join("")).not.toContain("synthetic.flood@example.com");
  });
});
