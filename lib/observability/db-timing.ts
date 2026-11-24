import "server-only";

import { after } from "next/server";
import { requestScope } from "@/lib/auth/request-memo";
import { errorTag, log } from "@/lib/log";
import { isUuid, type CallKind, type LogFields, type TimingKind, type TimingOutcome } from "@/lib/log/fields";
import { REQUEST_ID_HEADER } from "@/lib/log/request-id";
import { isKnownRoutePattern } from "./route-patterns";
import { MAX_REQUEST_AGE_MS, ROUTE_HEADER, START_HEADER } from "./timing-headers";

/**
 * Server timing (V2-09e 09E-02, R-20, T-09E-17): what one request spent on its database and external calls, written once when it is
 * over and, for a Server Action or a route handler, as it goes. A slow screen or a stalled action on staging can then be placed from
 * the function log alone (the finding of 2026-11-23: a password save stalled inside our function and the log held nothing, because the
 * slow path wrote no line).
 *
 * One {@link RequestTiming} per request, kept on the same request scope as `lib/auth/request-memo.ts` (the request's header store):
 * a page and its layouts, a Server Action and the render after it, a route handler. It is never shared between requests. The request
 * client's `fetch` (`lib/supabase/server.ts`) and the timed external calls ({@link timedCall}) feed it; one `after()` per request
 * writes the final line, so it covers the whole streamed response.
 *
 * Lines (`lib/log`, closed fields; never a URL, query, id, name, row or error text):
 *  - `request.start`  (action and route only) route pattern, kind, action name, request id;
 *  - `request.call`   (action and route only, at most {@link MAX_CALL_LINES} a request) call kind, status, call_ms, outcome;
 *  - `request.timing` route pattern, kind, action name, status (route handlers), db_calls, db_ms (the calls' times added up),
 *    db_depth (the longest chain of calls that waited for one another), total_ms (from the proxy's start), outcome.
 *
 * Outcome: `error` when a call failed (it threw, or the server answered 5xx) or a route answered 5xx; `unfinished` when a call had not
 * ended when the response did; `refused` for a route's 4xx; else `ok`. A request that never ends writes `request.start` and the calls
 * that did end, so the missing `request.timing` and the last `request.call` show where it stopped.
 */

export const MAX_CALL_LINES = 200;
/** Interval store bound: a request cannot grow the accumulator without limit. */
const MAX_INTERVALS = 2000;

interface Interval {
  t0: number;
  t1: number;
}

export type TimingSink = (level: "info" | "warn", fields: LogFields) => void;

/** The longest chain of calls that waited for one another: greedy by end time; a call that starts exactly when another ends is sequential. */
export function depthOfIntervals(intervals: ReadonlyArray<Interval>): number {
  const byEnd = [...intervals].sort((a, b) => a.t1 - b.t1 || a.t0 - b.t0);
  let depth = 0;
  let lastEnd = -Infinity;
  for (const call of byEnd) {
    if (call.t0 >= lastEnd) {
      depth += 1;
      lastEnd = call.t1;
    }
  }
  return depth;
}

export interface CallResult {
  status?: number;
  error?: unknown;
}

export class RequestTiming {
  action: string | undefined;
  status: number | undefined;
  private intervals: Interval[] = [];
  private calls = 0;
  private dbMs = 0;
  private pending = 0;
  private failed = false;
  private callLines = 0;
  private started = false;
  private finished = false;

  constructor(
    readonly kind: TimingKind,
    readonly route: string | undefined,
    readonly requestId: string | undefined,
    readonly t0: number,
    private readonly sink: TimingSink = (level, fields) => log[level](fields),
    private readonly now: () => number = Date.now,
  ) {}

  private base(event: `${string}.${string}`): LogFields {
    return {
      event,
      requestId: this.requestId,
      route: this.route as `/${string}` | undefined,
      timing_kind: this.kind,
      action: this.action as Lowercase<string> | undefined,
    };
  }

  /** The `request.start` line of an action or a route (once). Pages write none. */
  start(): void {
    if (this.started || this.finished) return;
    this.started = true;
    if (this.kind === "page") return;
    this.sink("info", this.base("request.start"));
  }

  setAction(name: string): void {
    if (this.action === undefined) this.action = name;
  }

  setStatus(status: number): void {
    this.status = status;
  }

  /** Starts one call; the returned function ends it. */
  beginCall(kind: CallKind): (result: CallResult) => void {
    this.start();
    const t0 = this.now();
    this.pending += 1;
    let ended = false;
    return (result) => {
      if (ended) return;
      ended = true;
      const t1 = this.now();
      this.pending -= 1;
      this.calls += 1;
      this.dbMs += Math.max(0, t1 - t0);
      if (this.intervals.length < MAX_INTERVALS) this.intervals.push({ t0, t1 });
      const failedCall = result.error !== undefined || (result.status !== undefined && result.status >= 500);
      if (failedCall) this.failed = true;
      if (this.kind === "page" || this.finished || this.callLines >= MAX_CALL_LINES) return;
      this.callLines += 1;
      this.sink(failedCall ? "warn" : "info", {
        ...this.base("request.call"),
        call_kind: kind,
        call_ms: Math.max(0, t1 - t0),
        ...(result.status !== undefined ? { status: result.status } : {}),
        ...(result.error !== undefined ? { code: errorTag(result.error) } : {}),
        outcome: failedCall ? "error" : "ok",
      });
    };
  }

  outcome(): TimingOutcome {
    if (this.pending > 0) return "unfinished";
    if (this.failed || (this.status !== undefined && this.status >= 500)) return "error";
    if (this.status !== undefined && this.status >= 400) return "refused";
    return "ok";
  }

  /** The final line (once). */
  finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.sink("info", {
      ...this.base("request.timing"),
      ...(this.status !== undefined ? { status: this.status } : {}),
      db_calls: this.calls,
      db_ms: this.dbMs,
      db_depth: depthOfIntervals(this.intervals),
      total_ms: Math.max(0, this.now() - this.t0),
      outcome: this.outcome(),
    });
  }

  /** `Server-Timing` for a route handler's response: the database time and the whole time so far. */
  serverTimingHeader(): string {
    const app = Math.max(0, this.now() - this.t0);
    return `db;dur=${this.dbMs.toFixed(1)};desc="calls=${this.calls} depth=${depthOfIntervals(this.intervals)}", app;dur=${app.toFixed(1)}`;
  }
}

interface HeaderReader {
  get(name: string): string | null;
}

function readerOf(scope: object): HeaderReader | null {
  const candidate = scope as Partial<HeaderReader>;
  return typeof candidate.get === "function" ? (scope as HeaderReader) : null;
}

/** Route handlers: the paths of `app/api/**` and the sign-out route; everything else without a `next-action` header is a page render. */
function kindOf(reader: HeaderReader | null, route: string | undefined): TimingKind {
  if (reader?.get("next-action")) return "action";
  if (route !== undefined && (route.startsWith("/api/") || route === "/auth/signout")) return "route";
  return "page";
}

const BY_SCOPE = new WeakMap<object, RequestTiming>();

/**
 * The accumulator of the current request, created (and its `after()` registered) on first use. `null` outside a request scope (a
 * script, a job, a spec without a Next scope): nothing is timed there.
 */
export async function currentTiming(): Promise<RequestTiming | null> {
  const scope = await requestScope();
  if (!scope) return null;
  const known = BY_SCOPE.get(scope);
  if (known) return known;
  const reader = readerOf(scope);
  const routeHeader = reader?.get(ROUTE_HEADER) ?? null;
  const route = isKnownRoutePattern(routeHeader) ? routeHeader : undefined;
  const requestIdHeader = reader?.get(REQUEST_ID_HEADER) ?? null;
  const now = Date.now();
  const startHeader = Number(reader?.get(START_HEADER) ?? NaN);
  const t0 = Number.isFinite(startHeader) && startHeader <= now + 1000 && now - startHeader <= MAX_REQUEST_AGE_MS ? startHeader : now;
  const timing = new RequestTiming(kindOf(reader, route), route, isUuid(requestIdHeader) ? requestIdHeader.toLowerCase() : undefined, t0);
  BY_SCOPE.set(scope, timing);
  try {
    after(() => timing.finish());
  } catch {
    // Not in a place Next lets us schedule after the response (a static render, a cache scope): this request writes no final line.
  }
  // `request.start` is written by whoever first has something to say (the action's name, the first call, a route handler), so it
  // can carry the action's name.
  return timing;
}

/**
 * Names the Server Action that is running (`await markAction("auth.set_new_password_action")` as the first line of each exported
 * action). Lower-case machine words only, like every action name in the log. Never throws.
 */
export async function markAction(name: Lowercase<string>): Promise<void> {
  try {
    const timing = await currentTiming();
    timing?.setAction(name);
    timing?.start();
  } catch {
    // Timing never changes what an action does.
  }
}

/** The kind of a Supabase call, from its path only (the URL itself is never kept). */
export function supabaseCallKind(input: RequestInfo | URL): CallKind {
  let pathname = "";
  try {
    pathname = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url).pathname;
  } catch {
    return "other";
  }
  if (pathname.includes("/auth/v1/")) return "auth";
  if (pathname.includes("/rest/v1/rpc/")) return "rpc";
  if (pathname.includes("/rest/v1/")) return "rest";
  if (pathname.includes("/storage/v1/")) return "storage";
  return "other";
}

/** Wraps the request client's `fetch`: every Supabase call of the request is counted, timed and kept as an interval. */
export function timedFetch(inner: typeof fetch): typeof fetch {
  return async (input, init) => {
    let end: ((result: CallResult) => void) | null = null;
    try {
      end = (await currentTiming())?.beginCall(supabaseCallKind(input)) ?? null;
    } catch {
      end = null;
    }
    if (end === null) return inner(input, init);
    try {
      const response = await inner(input, init);
      end({ status: response.status });
      return response;
    } catch (err) {
      end({ error: err });
      throw err;
    }
  };
}

/**
 * Times one external call that is not a Supabase call (the breached-password range API, an email or message provider, an AI
 * provider). `status` is read from the result when it has one; a throw is an error call and is rethrown unchanged.
 */
export async function timedCall<T>(kind: CallKind, call: () => Promise<T>, statusOf?: (value: T) => number | undefined): Promise<T> {
  let end: ((result: CallResult) => void) | null = null;
  try {
    end = (await currentTiming())?.beginCall(kind) ?? null;
  } catch {
    end = null;
  }
  if (end === null) return call();
  try {
    const value = await call();
    end({ status: statusOf?.(value) });
    return value;
  } catch (err) {
    end({ error: err });
    throw err;
  }
}
