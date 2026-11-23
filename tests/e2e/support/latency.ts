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
  /** The injected wait before the call was sent. */
  ms: number;
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
            ms: created.ms,
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

/**
 * Every recorded call (server and browser) that finished inside the window. Kong writes a call's access-log line when the call completes, so the
 * window between two Kong markers holds the calls that completed between them, whatever moment they began (`t1`, the arrival of the response, is
 * the completion as the app saw it, a millisecond or two after Kong's line).
 */
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
  return calls.filter((c) => c.t1 > 0 && c.t1 >= window.from && c.t1 <= window.to);
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
  /** Counts only once every on-screen match contains `text` (a result list narrowed to the one answer the last key asked for). */
  only?: boolean;
  /** The state is "no such element on screen" (a card that went away). */
  absent?: boolean;
  /** Counts only after the named mark was recorded (a "Saved" that was already on screen before the click does not count). */
  after?: string;
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
      const w = window as unknown as { __latency?: { t0: number | null; epoch: number; marks: Record<string, number>; stop: () => void } };
      w.__latency?.stop();
      const state = { t0: null as number | null, epoch: 0, marks: {} as Record<string, number>, stop: () => undefined as void };
      const onScreen = (el: Element) =>
        el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden" && !el.closest("[hidden]");
      const check = () => {
        if (state.t0 === null) return;
        // A mark that waits for another (`after`) is tried again once the other was recorded, in the same pass.
        let progressed = true;
        while (progressed) {
          progressed = false;
          for (const [name, spec] of Object.entries(wanted)) {
            if (name in state.marks) continue;
            if (spec.after && !(spec.after in state.marks)) continue;
            const matches = [...document.querySelectorAll(spec.selector)].filter((el) => onScreen(el));
            const hasText = (el: Element) => !spec.text || (el.textContent ?? "").includes(spec.text);
            const met = spec.absent
              ? matches.filter(hasText).length === 0
              : spec.only
                ? matches.length > 0 && matches.every(hasText)
                : matches.some(hasText);
            if (met) {
              state.marks[name] = Math.round((performance.now() - (state.t0 as number)) * 10) / 10;
              progressed = true;
            }
          }
        }
      };
      const observer = new MutationObserver(check);
      observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
      const onEvent = (event: Event) => {
        if (state.t0 !== null) return;
        if (when.key !== undefined && (event as KeyboardEvent).key !== when.key) return;
        state.t0 = event.timeStamp;
        state.epoch = performance.timeOrigin + event.timeStamp;
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

/** Epoch ms of the armed timer's zero (the click or key), for marks the runner takes itself (a server action's response). */
export async function timerEpoch(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __latency?: { epoch: number } }).__latency?.epoch ?? 0);
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

/**
 * Full load: `goto` → the page's first data element on screen, timed by the runner (a full load has no earlier moment inside the page to arm a
 * timer at), plus Navigation Timing `responseEnd` (the document fully streamed: the server's work). Polls on animation frames.
 */
export async function timeFullLoad(
  page: Page,
  url: string,
  data: MarkSpec,
  timeoutMs = 45_000,
): Promise<{ dataMs: number; responseEndMs: number }> {
  const t0 = Date.now();
  await page.goto(url, { waitUntil: "commit" });
  await page.waitForFunction(
    (spec) => {
      const onScreen = (el: Element) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden" && !el.closest("[hidden]");
      return [...document.querySelectorAll(spec.selector)].some((el) => onScreen(el) && (!spec.text || (el.textContent ?? "").includes(spec.text)));
    },
    data,
    { polling: "raf", timeout: timeoutMs },
  );
  const dataMs = Date.now() - t0;
  await page.waitForLoadState("load");
  const responseEndMs = await page.evaluate(() => Math.round((performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined)?.responseEnd ?? -1));
  return { dataMs, responseEndMs };
}

/**
 * The server actions' responses of a page, by arrival (epoch ms, runner clock): a POST carrying `next-action` is answered when the action
 * finished. For a save whose confirmed state has no DOM marker of its own, `confirmed = first response − the timer's zero`.
 */
export function watchActionResponses(page: Page): { firstSince: (epoch: number) => number | null; stop: () => void } {
  const seen: number[] = [];
  const onResponse = (response: { request(): { method(): string; headers(): Record<string, string> } }) => {
    const request = response.request();
    if (request.method() === "POST" && request.headers()["next-action"]) seen.push(Date.now());
  };
  page.on("response", onResponse);
  return {
    firstSince: (epoch) => seen.find((at) => at >= epoch) ?? null,
    stop: () => page.off("response", onResponse),
  };
}

/**
 * Records, in the page, when a state first shows (epoch ms from the page's own clock), for a change made by someone else (a second browser):
 * read it with {@link seenAt}. Install it before the other browser acts.
 */
export async function watchEpoch(page: Page, spec: MarkSpec): Promise<void> {
  await page.evaluate((wanted) => {
    const w = window as unknown as { __seenAt?: number; __seenStop?: () => void };
    w.__seenStop?.();
    w.__seenAt = undefined;
    const onScreen = (el: Element) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden" && !el.closest("[hidden]");
    const check = () => {
      if (w.__seenAt !== undefined) return;
      const hit = [...document.querySelectorAll(wanted.selector)].some((el) => onScreen(el) && (!wanted.text || (el.textContent ?? "").includes(wanted.text)));
      if (hit) w.__seenAt = performance.timeOrigin + performance.now();
    };
    const observer = new MutationObserver(check);
    observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    w.__seenStop = () => observer.disconnect();
  }, spec);
}

export async function seenAt(page: Page, timeoutMs = 45_000): Promise<number> {
  await page.waitForFunction(() => (window as unknown as { __seenAt?: number }).__seenAt !== undefined, undefined, { timeout: timeoutMs });
  return page.evaluate(() => (window as unknown as { __seenAt: number }).__seenAt);
}
