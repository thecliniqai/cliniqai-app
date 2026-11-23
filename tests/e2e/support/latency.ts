/**
 * V2-09e 09E-01 (R-2 to R-4): the latency lane's runner side. Adds N ms to every Supabase call the app makes and records what the calls
 * did, so a screen's calls, its round-trip depth and its time can be measured at the cost a clinic pays on a hosted database.
 *
 * - Server: `server-latency.cjs` (preloaded into the e2e app server) delays every `fetch` to the local Supabase origin by N ms while the rule
 *   file {@link LATENCY_RULE_FILE} exists and appends `{t0, t1, method, path}` to {@link LATENCY_RECORD_FILE}.
 * - Browser: a `context.route` on the Supabase origin waits N ms, records the same, and passes the request on (`route.fallback()`, so the
 *   fixture's loopback guard still applies). HTTP only: the Realtime socket is not delayed, and the report says so.
 * - Depth ({@link depthOf}): the largest set of calls of a window whose intervals do not overlap, i.e. the longest chain of calls that waited for
 *   one another. With N injected, a parallel batch overlaps and a dependent call starts after its predecessor ended, so the number is deterministic.
 * - Timers: `armTimer`/`readTimer` time a click or a key to named DOM states inside the page (`performance.now()` and a MutationObserver
 *   installed before the trigger), so the numbers are not the runner's round trips.
 *
 * Local stack only; the paths carry no ids or query strings; synthetic data only.
 */
import fs from "node:fs";
import path from "node:path";
import type { BrowserContext, Page, Request } from "@playwright/test";
import { AUTH_DIR } from "./run-data";
import { LOCAL_SUPABASE_URL, ROOT } from "./app-env";

/** Read by `server-latency.cjs` (mtime-checked, no restart). Removed by global setup and by the run's teardown (the whole auth dir). */
export const LATENCY_RULE_FILE = path.join(AUTH_DIR, "latency.json");
/** Where the server appends its call intervals (JSON lines); the lane's own output, not part of the auth dir. */
export const LATENCY_RECORD_FILE = path.join(ROOT, "test-results/perf-latency/server-calls.jsonl");

export interface CallInterval {
  /** Epoch ms when the call was made (before its injected wait). */
  t0: number;
  /** Epoch ms when the response arrived. */
  t1: number;
  method: string;
  path: string;
  from: "server" | "browser";
}

/**
 * The depth of a set of call intervals: the largest number of calls that can be placed one after the other (greedy by end time; a call
 * that starts exactly when another ends counts as sequential). Empty is 0; one parallel batch is 1; a batch and then one call is 2.
 */
export function depthOf(intervals: ReadonlyArray<Pick<CallInterval, "t0" | "t1">>): number {
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

// --- the injection --------------------------------------------------------------------------------------------------------------

interface BrowserState {
  ms: number;
  records: CallInterval[];
}
const browserStates = new WeakMap<BrowserContext, BrowserState>();
const allBrowserStates = new Set<BrowserState>();
const pendingBrowserCalls = new WeakMap<Request, CallInterval>();

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const reportPath = (rawPath: string) => rawPath.split("?")[0].replace(UUID, ":id").replace(/\/\d+(?=\/|$)/g, "/:n");

/**
 * Adds `ms` to every Supabase call of the app server (rule file) and of this context's browser pages (route). `ms` of 0 is the reference
 * run: nothing is delayed and nothing is recorded (depth needs the delay). Calling it again with a new value changes the delay; no restart.
 */
export async function setSupabaseLatency(context: BrowserContext, ms: number): Promise<void> {
  if (!(ms >= 0)) throw new Error(`setSupabaseLatency: bad delay ${ms}`);
  if (ms === 0) {
    clearSupabaseLatency();
    const state = browserStates.get(context);
    if (state) state.ms = 0;
    return;
  }
  fs.mkdirSync(path.dirname(LATENCY_RULE_FILE), { recursive: true });
  fs.mkdirSync(path.dirname(LATENCY_RECORD_FILE), { recursive: true });
  fs.writeFileSync(LATENCY_RULE_FILE, `${JSON.stringify({ ms, record: LATENCY_RECORD_FILE })}\n`);
  let state = browserStates.get(context);
  if (!state) {
    const created: BrowserState = { ms, records: [] };
    state = created;
    browserStates.set(context, created);
    allBrowserStates.add(created);
    await context.route(
      (url) => url.origin === LOCAL_SUPABASE_URL,
      async (route) => {
        const request = route.request();
        if (created.ms > 0) {
          const call: CallInterval = {
            t0: Date.now(),
            t1: 0,
            method: request.method(),
            path: reportPath(new URL(request.url()).pathname),
            from: "browser",
          };
          created.records.push(call);
          pendingBrowserCalls.set(request, call);
          await new Promise((resolve) => setTimeout(resolve, created.ms));
        }
        await route.fallback();
      },
    );
    const done = (request: Request) => {
      const call = pendingBrowserCalls.get(request);
      if (call && call.t1 === 0) call.t1 = Date.now();
    };
    context.on("response", (response) => done(response.request()));
    context.on("requestfailed", done);
  }
  state.ms = ms;
}

/** Ends the server-side injection (the browser routes stay installed and pass through at 0 ms). */
export function clearSupabaseLatency(): void {
  fs.rmSync(LATENCY_RULE_FILE, { force: true });
}

/** The injected delay now in force, or 0. */
export function activeLatencyMs(): number {
  try {
    return (JSON.parse(fs.readFileSync(LATENCY_RULE_FILE, "utf8")) as { ms: number }).ms;
  } catch {
    return 0;
  }
}

export interface LatencyWindow {
  /** Epoch ms of the start of the measured stretch. */
  from: number;
  /** Epoch ms of its end. */
  to: number;
}

/** Every recorded call (server and browser) that began inside the window and has finished. */
export function callIntervals(window: LatencyWindow): CallInterval[] {
  const calls: CallInterval[] = [];
  if (fs.existsSync(LATENCY_RECORD_FILE)) {
    for (const line of fs.readFileSync(LATENCY_RECORD_FILE, "utf8").split("\n")) {
      if (!line) continue;
      try {
        const rec = JSON.parse(line) as Omit<CallInterval, "from">;
        calls.push({ ...rec, from: "server" });
      } catch {
        // a partial last line of a file still being appended to: not a call of this window
      }
    }
  }
  for (const state of allBrowserStates) calls.push(...state.records);
  return calls.filter((c) => c.t1 > 0 && c.t0 >= window.from && c.t0 <= window.to);
}

/** Starts a fresh record file (a lane run begins with no calls of an earlier run). */
export function resetLatencyRecords(): void {
  fs.mkdirSync(path.dirname(LATENCY_RECORD_FILE), { recursive: true });
  fs.writeFileSync(LATENCY_RECORD_FILE, "");
  for (const state of allBrowserStates) state.records.length = 0;
}

// --- the in-page timers ---------------------------------------------------------------------------------------------------------

/** A DOM state to wait for: an element matching `selector` (and containing `text` when given) that is on screen. */
export interface MarkSpec {
  selector: string;
  text?: string;
}

export interface TimerStart {
  /** The DOM event whose time is zero: a click, or a key press (`key` limits it to one key; the last character of a typeahead query). */
  event: "click" | "keydown";
  key?: string;
}

/**
 * Arms the in-page timer: from now, the first matching `start` event is time zero, and each mark records the first time its element is on
 * screen after that (`performance.now()` from a MutationObserver, before the next paint). Install it BEFORE the trigger.
 */
export async function armTimer(page: Page, marks: Record<string, MarkSpec>, start: TimerStart): Promise<void> {
  await page.evaluate(
    ({ marks: wanted, start: when }) => {
      const w = window as unknown as { __latency?: { t0: number | null; marks: Record<string, number>; stop: () => void } };
      w.__latency?.stop();
      const state = { t0: null as number | null, marks: {} as Record<string, number>, stop: () => undefined as void };
      const onScreen = (el: Element) =>
        el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden" && !el.closest("[hidden]");
      const check = () => {
        if (state.t0 === null) return;
        for (const [name, spec] of Object.entries(wanted)) {
          if (name in state.marks) continue;
          const hit = [...document.querySelectorAll(spec.selector)].find(
            (el) => onScreen(el) && (!spec.text || (el.textContent ?? "").includes(spec.text)),
          );
          if (hit) state.marks[name] = Math.round((performance.now() - state.t0) * 10) / 10;
        }
      };
      const observer = new MutationObserver(check);
      observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
      const onEvent = (event: Event) => {
        if (state.t0 !== null) return;
        if (when.key !== undefined && (event as KeyboardEvent).key !== when.key) return;
        state.t0 = event.timeStamp;
        // The state may already be on screen when the event is dispatched (an element already there does not count: only later changes do).
        queueMicrotask(check);
      };
      document.addEventListener(when.event, onEvent, { capture: true });
      state.stop = () => {
        observer.disconnect();
        document.removeEventListener(when.event, onEvent, { capture: true });
      };
      w.__latency = state;
    },
    { marks, start },
  );
}

/**
 * Waits until the named marks are all recorded (or the timeout) and returns each one's ms from the start event; a mark that never came is
 * null. Only the marks in `required` are waited for: an optional one (the skeleton of a page that answered too fast to show it) is read as is.
 */
export async function readTimer(page: Page, required: string[], timeoutMs = 30_000): Promise<Record<string, number | null>> {
  await page.waitForFunction(
    (names) => {
      const state = (window as unknown as { __latency?: { marks: Record<string, number> } }).__latency;
      return Boolean(state) && names.every((n) => n in state!.marks);
    },
    required,
    { timeout: timeoutMs },
  );
  return page.evaluate(() => {
    const state = (window as unknown as { __latency: { marks: Record<string, number>; stop: () => void } }).__latency;
    state.stop();
    return { ...state.marks } as Record<string, number | null>;
  });
}

/** Click (or key) → named states: arms, runs `trigger`, waits for `required`. The ms are measured inside the page. */
export async function timeMarks(
  page: Page,
  trigger: () => Promise<void>,
  marks: Record<string, MarkSpec>,
  required: string[],
  start: TimerStart = { event: "click" },
  timeoutMs = 30_000,
): Promise<Record<string, number | null>> {
  await armTimer(page, marks, start);
  await trigger();
  const result = await readTimer(page, required, timeoutMs);
  for (const name of Object.keys(marks)) result[name] ??= null;
  return result;
}

/** Click → the page's first data element: the `skeleton` (the route skeleton, when one shows) and `data` marks of a navigation. */
export const SKELETON: MarkSpec = { selector: '[role="status"][aria-label="Loading"], [data-route-skeleton]' };

export async function timeToVisible(
  page: Page,
  trigger: () => Promise<void>,
  data: MarkSpec,
  timeoutMs = 30_000,
): Promise<{ skeletonMs: number | null; dataMs: number }> {
  const marks = await timeMarks(page, trigger, { skeleton: SKELETON, data }, ["data"], { event: "click" }, timeoutMs);
  return { skeletonMs: marks.skeleton ?? null, dataMs: marks.data as number };
}

/** The last key of a typeahead query → the listbox's first option showing `expected`: ms inside the page. */
export async function timeToOption(page: Page, press: () => Promise<void>, key: string, expected: string, timeoutMs = 30_000): Promise<number> {
  const marks = await timeMarks(page, press, { option: { selector: '[role="option"]', text: expected } }, ["option"], { event: "keydown", key }, timeoutMs);
  return marks.option as number;
}
