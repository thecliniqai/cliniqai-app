/**
 * V2-09e 09E-02 (R-20, T-09E-17): the per-request timing accumulator (`lib/observability/db-timing.ts`) and the lines it writes.
 *
 * - one accumulator per request scope, never shared between requests; one `after()` per request;
 * - calls are counted, their time added up and their depth taken from the intervals (a parallel batch is one level);
 * - the lines hold only allow-listed fields: a route pattern from the generated list, numbers and closed words; a spoofed route
 *   header, a URL, a query, an id or an error message never reaches a line;
 * - an action and a route write `request.start` and one `request.call` per call; a stalled call shows as `unfinished`.
 * One request scope = one `headers()` object (a fake here, as Next resolves it once per request). Synthetic values only.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

const scope = vi.hoisted(() => ({ current: null as object | null, afters: [] as Array<() => void | Promise<void>> }));

vi.mock("next/headers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/headers")>();
  return { ...actual, headers: async () => scope.current ?? {} };
});
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: (fn: () => void | Promise<void>) => void scope.afters.push(fn) };
});

import { currentTiming, depthOfIntervals, markAction, RequestTiming, supabaseCallKind, timedCall, timedFetch, MAX_CALL_LINES } from "@/lib/observability/db-timing";
import { ROUTE_HEADER, START_HEADER } from "@/lib/observability/timing-headers";
import { REQUEST_ID_HEADER } from "@/lib/log/request-id";
import { sanitiseFields, type LogFields } from "@/lib/log/fields";

const REQUEST_ID = "0f0e0d0c-0b0a-4908-8706-050403020100";
const PATIENT = "11111111-2222-4333-8444-555555555555";

function request(headers: Record<string, string>): object {
  const map = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { get: (name: string) => map.get(name.toLowerCase()) ?? null };
}

let stdout: MockInstance;
let stderr: MockInstance;

function written(): Array<Record<string, unknown>> {
  return [...stdout.mock.calls, ...stderr.mock.calls].map((c) => JSON.parse(String(c[0])) as Record<string, unknown>);
}
const linesOf = (event: string) => written().filter((l) => l.event === event);

async function runAfters() {
  const pending = scope.afters.splice(0);
  for (const fn of pending) await fn();
}

beforeEach(() => {
  scope.current = null;
  scope.afters = [];
  stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});
afterEach(() => vi.restoreAllMocks());

describe("depthOfIntervals", () => {
  const call = (t0: number, t1: number) => ({ t0, t1 });
  it("is 0 for none, 1 for one parallel batch, 2 for a batch and a call that waited for it", () => {
    expect(depthOfIntervals([])).toBe(0);
    expect(depthOfIntervals([call(0, 300), call(1, 301), call(2, 302)])).toBe(1);
    expect(depthOfIntervals([call(0, 300), call(0, 305), call(305, 610)])).toBe(2);
  });
  it("counts an end equal to a start as sequential and a start before the other's end as parallel", () => {
    expect(depthOfIntervals([call(0, 300), call(300, 600)])).toBe(2);
    expect(depthOfIntervals([call(0, 300), call(299, 599)])).toBe(1);
  });
});

describe("RequestTiming: counts, time, depth and outcome", () => {
  function fixture(kind: "page" | "action" | "route" = "page") {
    let clock = 1_000;
    const lines: Array<{ level: string; fields: LogFields }> = [];
    const timing = new RequestTiming(kind, "/patients/[id]", REQUEST_ID, 1_000, (level, fields) => lines.push({ level, fields }), () => clock);
    return { timing, lines, tick: (ms: number) => void (clock += ms) };
  }

  it("a sequential chain of three calls and one parallel pair: calls 5, db_ms the times added up, depth 4", () => {
    const { timing, lines, tick } = fixture();
    const run = (ms: number) => {
      const end = timing.beginCall("rest");
      tick(ms);
      end({ status: 200 });
    };
    run(100);
    run(50);
    const a = timing.beginCall("rest");
    const b = timing.beginCall("rpc");
    tick(80);
    a({ status: 200 });
    b({ status: 200 });
    run(20);
    timing.finish();
    const final = lines.find((l) => l.fields.event === "request.timing")!.fields;
    expect(final).toMatchObject({ db_calls: 5, db_ms: 100 + 50 + 80 + 80 + 20, db_depth: 4, total_ms: 250, outcome: "ok", timing_kind: "page" });
  });

  it("a page writes only the final line; an action writes request.start and a request.call per call", () => {
    const page = fixture("page");
    page.timing.beginCall("rest")({ status: 200 });
    page.timing.finish();
    expect(page.lines.map((l) => l.fields.event)).toEqual(["request.timing"]);

    const action = fixture("action");
    action.timing.setAction("auth.set_new_password_action");
    action.timing.beginCall("auth")({ status: 200 });
    action.timing.beginCall("rest")({ status: 200 });
    action.timing.finish();
    expect(action.lines.map((l) => l.fields.event)).toEqual(["request.start", "request.call", "request.call", "request.timing"]);
    expect(action.lines[0]!.fields).toMatchObject({ timing_kind: "action", action: "auth.set_new_password_action", route: "/patients/[id]" });
    expect(action.lines[1]!.fields).toMatchObject({ call_kind: "auth", status: 200, outcome: "ok" });
  });

  it("the final line is written once, and a call that ends after it writes nothing", () => {
    const { timing, lines } = fixture("route");
    const late = timing.beginCall("rest");
    timing.finish();
    timing.finish();
    late({ status: 200 });
    expect(lines.filter((l) => l.fields.event === "request.timing")).toHaveLength(1);
    expect(lines.filter((l) => l.fields.event === "request.call")).toHaveLength(0);
  });

  it("outcome: a call still running at the end is unfinished; a thrown call or a 5xx is error; a route's 4xx is refused", () => {
    const stalled = fixture("action");
    stalled.timing.beginCall("auth");
    stalled.timing.finish();
    expect(stalled.lines.at(-1)!.fields).toMatchObject({ outcome: "unfinished", db_calls: 0 });

    const thrown = fixture("action");
    thrown.timing.beginCall("auth")({ error: new TypeError("fetch failed: secret-row-value") });
    thrown.timing.finish();
    expect(thrown.lines.at(-1)!.fields.outcome).toBe("error");
    const callLine = thrown.lines.find((l) => l.fields.event === "request.call")!;
    expect(callLine.level).toBe("warn");
    expect(callLine.fields).toMatchObject({ outcome: "error", code: "TypeError" });
    expect(JSON.stringify(thrown.lines)).not.toContain("secret-row-value");

    const serverError = fixture("page");
    serverError.timing.beginCall("rest")({ status: 503 });
    serverError.timing.finish();
    expect(serverError.lines.at(-1)!.fields.outcome).toBe("error");

    const refused = fixture("route");
    refused.timing.setStatus(403);
    refused.timing.finish();
    expect(refused.lines.at(-1)!.fields).toMatchObject({ outcome: "refused", status: 403 });
  });

  it(`writes at most ${MAX_CALL_LINES} call lines for one request, and still counts every call`, () => {
    const { timing, lines } = fixture("action");
    for (let i = 0; i < MAX_CALL_LINES + 25; i++) timing.beginCall("rest")({ status: 200 });
    timing.finish();
    expect(lines.filter((l) => l.fields.event === "request.call")).toHaveLength(MAX_CALL_LINES);
    expect(lines.at(-1)!.fields.db_calls).toBe(MAX_CALL_LINES + 25);
  });

  it("the Server-Timing header reads db;dur;desc and app;dur", () => {
    const { timing, tick } = fixture("route");
    const end = timing.beginCall("rest");
    tick(40);
    end({ status: 200 });
    tick(10);
    expect(timing.serverTimingHeader()).toBe('db;dur=40.0;desc="calls=1 depth=1", app;dur=50.0');
  });
});

describe("one accumulator per request", () => {
  it("shares one accumulator inside a request scope, registers one after(), and starts a new one for the next request", async () => {
    scope.current = request({ [ROUTE_HEADER]: "/today", [REQUEST_ID_HEADER]: REQUEST_ID });
    const a = await currentTiming();
    const again = await currentTiming();
    expect(again).toBe(a);
    expect(scope.afters).toHaveLength(1);

    scope.current = request({ [ROUTE_HEADER]: "/today" });
    const b = await currentTiming();
    expect(b).not.toBe(a);
    expect(scope.afters).toHaveLength(2);
  });

  it("two requests running at once never see each other's calls", async () => {
    const one = request({ [ROUTE_HEADER]: "/today" });
    const two = request({ [ROUTE_HEADER]: "/schedule" });
    const inner = vi.fn(async () => new Response("{}", { status: 200 }));
    const fetchOne = timedFetch(inner);
    scope.current = one;
    await fetchOne("http://127.0.0.1:54321/rest/v1/appointments");
    await fetchOne("http://127.0.0.1:54321/rest/v1/visits");
    scope.current = two;
    await timedFetch(inner)("http://127.0.0.1:54321/rest/v1/patients");
    await runAfters();
    const finals = linesOf("request.timing");
    expect(finals.map((l) => [l.route, l.db_calls])).toEqual([["/today", 2], ["/schedule", 1]]);
  });

  it("outside a request scope nothing is timed and the call goes through untouched", async () => {
    scope.current = { not: "headers" } as object; // a scope without `get`: still a scope
    const inner = vi.fn(async () => new Response("{}", { status: 200 }));
    const res = await timedFetch(inner)("http://127.0.0.1:54321/rest/v1/x");
    expect(res.status).toBe(200);
    expect(inner).toHaveBeenCalledTimes(1);
  });

  it("the route comes only from the generated list: a spoofed or id-bearing header is ignored", async () => {
    scope.current = request({ [ROUTE_HEADER]: `/patients/${PATIENT}` });
    expect((await currentTiming())!.route).toBeUndefined();
    scope.current = request({ [ROUTE_HEADER]: "/consultation/[id]" });
    expect((await currentTiming())!.route).toBe("/consultation/[id]");
  });

  it("the start comes from the proxy only when it is a plausible recent instant", async () => {
    const now = Date.now();
    scope.current = request({ [START_HEADER]: String(now - 4_000) });
    expect((await currentTiming())!.t0).toBe(now - 4_000);
    scope.current = request({ [START_HEADER]: String(now - 3_600_000) });
    expect(Math.abs((await currentTiming())!.t0 - now)).toBeLessThan(1000);
    scope.current = request({ [START_HEADER]: String(now + 3_600_000) });
    expect(Math.abs((await currentTiming())!.t0 - now)).toBeLessThan(1000);
  });

  it("the kind follows the request: next-action is an action, /api is a route, the rest are pages", async () => {
    scope.current = request({ "next-action": "40abc", [ROUTE_HEADER]: "/patients" });
    expect((await currentTiming())!.kind).toBe("action");
    scope.current = request({ [ROUTE_HEADER]: "/api/patients/search" });
    expect((await currentTiming())!.kind).toBe("route");
    scope.current = request({ [ROUTE_HEADER]: "/patients" });
    expect((await currentTiming())!.kind).toBe("page");
  });
});

describe("what the lines can hold", () => {
  it("a Supabase call is kept by its kind and status only: no URL, query, id or body reaches a line", async () => {
    scope.current = request({ [ROUTE_HEADER]: "/api/patients/search", [REQUEST_ID_HEADER]: REQUEST_ID });
    const inner = vi.fn(async () => new Response("{}", { status: 200 }));
    await timedFetch(inner)(`http://127.0.0.1:54321/rest/v1/patients?phone=eq.919000000001&id=eq.${PATIENT}`);
    await timedFetch(inner)("http://127.0.0.1:54321/auth/v1/user");
    await runAfters();
    const all = JSON.stringify(written());
    expect(all).not.toContain(PATIENT);
    expect(all).not.toContain("919000000001");
    expect(all).not.toContain("patients?");
    expect(all).not.toContain("127.0.0.1");
    expect(linesOf("request.call").map((l) => l.call_kind)).toEqual(["rest", "auth"]);
  });

  it("every key of every line is on the allow-list, whatever the caller passes", () => {
    const loose = sanitiseFields({
      event: "request.timing",
      timing_kind: "page",
      route: `/patients/${PATIENT}`,
      db_calls: 3,
      db_ms: 12.4,
      call_kind: "https://example.test/x?token=abc",
      outcome: "ok",
      url: "/patients?phone=9",
      message: "row value",
    });
    expect(Object.keys(loose).sort()).toEqual(["db_calls", "db_ms", "event", "outcome", "timing_kind"]);
    expect(loose.db_ms).toBe(12);
  });

  it("the call kind comes from the path of the Supabase URL", () => {
    expect(supabaseCallKind("http://x.test/auth/v1/user")).toBe("auth");
    expect(supabaseCallKind("http://x.test/rest/v1/rpc/my_fn")).toBe("rpc");
    expect(supabaseCallKind("http://x.test/rest/v1/visits?select=*")).toBe("rest");
    expect(supabaseCallKind("http://x.test/storage/v1/object/a")).toBe("storage");
    expect(supabaseCallKind("not a url")).toBe("other");
    expect(supabaseCallKind(new URL("http://x.test/other"))).toBe("other");
  });
});

describe("a stalled action shows where it stopped (the 2026-11-23 staging finding)", () => {
  it("writes request.start and the calls that ended; the stalled call is unfinished in the final line", async () => {
    scope.current = request({ "next-action": "40abc", [ROUTE_HEADER]: "/forgot-password", [REQUEST_ID_HEADER]: REQUEST_ID });
    await markAction("auth.set_new_password_action");
    const quick = vi.fn(async () => new Response("{}", { status: 200 }));
    await timedFetch(quick)("http://127.0.0.1:54321/auth/v1/user");
    const stalled = timedFetch(() => new Promise<Response>(() => undefined))("http://127.0.0.1:54321/auth/v1/user");
    void stalled;
    await new Promise((resolve) => setTimeout(resolve, 5));
    await runAfters();
    expect(linesOf("request.start")).toHaveLength(1);
    expect(linesOf("request.start")[0]).toMatchObject({ action: "auth.set_new_password_action", timing_kind: "action", route: "/forgot-password" });
    expect(linesOf("request.call")).toHaveLength(1);
    expect(linesOf("request.timing")[0]).toMatchObject({ outcome: "unfinished", db_calls: 1, action: "auth.set_new_password_action" });
  });

  it("an external call is timed with its kind, and a throw is rethrown unchanged", async () => {
    scope.current = request({ [ROUTE_HEADER]: "/api/auth/send-email", [REQUEST_ID_HEADER]: REQUEST_ID });
    expect(await timedCall("email", async () => 7, () => 202)).toBe(7);
    await expect(timedCall("pwned", async () => Promise.reject(new RangeError("boom")))).rejects.toThrow("boom");
    await runAfters();
    expect(linesOf("request.call").map((l) => [l.call_kind, l.outcome])).toEqual([["email", "ok"], ["pwned", "error"]]);
    expect(linesOf("request.timing")[0]).toMatchObject({ db_calls: 2, outcome: "error" });
  });
});
