/**
 * V2-09e 09E-02 (R-20): `Server-Timing` on route handlers (`lib/observability/server-timing.ts`). The header holds counts, depth and
 * milliseconds only; the handler's answer is otherwise untouched; outside a request nothing is added.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const scope = vi.hoisted(() => ({ current: null as object | null, afters: [] as Array<() => void | Promise<void>> }));
vi.mock("next/headers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/headers")>();
  return { ...actual, headers: async () => scope.current ?? {} };
});
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: (fn: () => void | Promise<void>) => void scope.afters.push(fn) };
});

import { NextResponse } from "next/server";
import { timedFetch } from "@/lib/observability/db-timing";
import { timedRoute, withServerTiming } from "@/lib/observability/server-timing";
import { ROUTE_HEADER } from "@/lib/observability/timing-headers";

const FORMAT = /^db;dur=\d+\.\d;desc="calls=\d+ depth=\d+", app;dur=\d+\.\d$/;

function requestScope(route: string): object {
  const map = new Map([[ROUTE_HEADER, route]]);
  return { get: (name: string) => map.get(name.toLowerCase()) ?? null };
}

beforeEach(() => {
  scope.current = requestScope("/api/terminology/diagnoses");
  scope.afters = [];
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});
afterEach(() => vi.restoreAllMocks());

describe("Server-Timing on a route handler", () => {
  it("is db;dur;desc=calls depth, then app;dur, and counts the calls the handler made", async () => {
    const inner = vi.fn(async () => new Response("{}", { status: 200 }));
    const handler = timedRoute(async () => {
      await timedFetch(inner)("http://127.0.0.1:54321/rest/v1/rpc/search_diagnoses");
      await timedFetch(inner)("http://127.0.0.1:54321/rest/v1/rpc/my_entitlements");
      return NextResponse.json({ results: [] }, { status: 200 });
    });
    const res = await handler();
    const header = res.headers.get("Server-Timing")!;
    expect(header).toMatch(FORMAT);
    expect(header).toContain('desc="calls=2 depth=2"');
    expect(await res.json()).toEqual({ results: [] });
    expect(res.status).toBe(200);
  });

  it("records the answer's status for the final line", async () => {
    const written: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((c) => (written.push(String(c)), true));
    vi.spyOn(process.stderr, "write").mockImplementation((c) => (written.push(String(c)), true));
    await timedRoute(async () => NextResponse.json({ error: "Forbidden" }, { status: 403 }))();
    for (const fn of scope.afters) await fn();
    const lines = written.map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(lines.find((l) => l.event === "request.start")).toMatchObject({ timing_kind: "route", route: "/api/terminology/diagnoses" });
    expect(lines.find((l) => l.event === "request.timing")).toMatchObject({ status: 403, outcome: "refused", db_calls: 0 });
  });

  it("passes the handler's arguments through and does not catch its errors", async () => {
    const seen: unknown[] = [];
    const handler = timedRoute(async (a: string, b: { params: Promise<{ id: string }> }) => {
      seen.push(a, await b.params);
      throw new Error("handler failed");
    });
    await expect(handler("x", { params: Promise.resolve({ id: "1" }) })).rejects.toThrow("handler failed");
    expect(seen).toEqual(["x", { id: "1" }]);
  });

  it("adds no timing and changes nothing when the request has no header reader (the response goes back as it came)", async () => {
    scope.current = null;
    const nothing = vi.fn(() => new Response(null, { status: 204 }));
    // A scope that is no header store at all: nothing to time.
    const res = await withServerTiming(nothing());
    expect(res.status).toBe(204);
  });

  it("leaves an immutable response alone instead of throwing", async () => {
    const immutable = new Response(null, { status: 200 });
    Object.defineProperty(immutable, "headers", { value: new Proxy(new Headers(), { get: (t, p) => (p === "set" ? () => { throw new TypeError("immutable"); } : Reflect.get(t, p).bind?.(t) ?? Reflect.get(t, p)) }) });
    await expect(withServerTiming(immutable)).resolves.toBe(immutable);
  });
});
