/**
 * V2-09e 09E-01: the latency lane's engine. One row = one measure of the budget table (`latency-budgets.ts`): a warm-up, then N samples, each
 * counted between two Kong markers (calls, server and browser), timed inside the page, and given its round-trip depth from the call intervals
 * the injection recorded (`support/latency.ts`). Calls and depth block against the row's ceiling (`ceilingOf`); milliseconds are reported only.
 *
 * Calibration (always enforced, every sample, at any N above 0): every recorded interval lasted at least the injected delay (less a 2 ms timer
 * allowance), and the recorded count equals Kong's, for the server and for the browser. Realtime socket upgrades are Kong lines that are not
 * request-response calls and are not delayed (the injection is HTTP only): they are counted apart (`realtime`), not in `calls`.
 *
 * Background requests are held while a window measures (the 09D-01a method): the `/api/health` liveness probe that gates every live refresh, and,
 * once the device holds its session-context cookie, the shell's `/api/session-status` check (its own row, `bg.session-status`) and the reference
 * catalogue sync (`/api/reference/**`, 09E-09).
 */
import fs from "node:fs";
import path from "node:path";
import type { BrowserContext, Page } from "@playwright/test";
import { expect } from "../fixtures";
import { ROOT } from "../support/app-env";
import { countKongCalls } from "../support/kong-calls";
import { callIntervals, depthOf, setSupabaseLatency, clearSupabaseLatency, resetLatencyRecords, waitForQuiet } from "../support/latency";
import { budgetRow, ceilingOf, type BudgetRow } from "./latency-budgets";

export const LATENCY_MS = Number(process.env.PERF_LATENCY_MS ?? 300);
export const SAMPLES = Number(process.env.PERF_LATENCY_SAMPLES ?? 5);
const OUT_DIR = path.join(ROOT, "test-results/perf-latency");
/** The timer allowance of the calibration (a Node timer can fire a millisecond early). */
const TIMER_ALLOWANCE_MS = 2;
const CONTEXT_COOKIE = "clinic_ctx";

export interface Sample {
  /** Supabase calls of the window, server and browser (Realtime socket upgrades apart). */
  calls: number;
  server: number;
  browser: number;
  realtime: number;
  /**
   * Requests the server makes on a clock of its own, counted apart from the step and left out of `calls` and `depth`: the JWKS refresh of the
   * session verifier (the cached key set expires; it shows in a sample or not by the time). `METHOD path` → count.
   */
  background: Record<string, number>;
  /** Longest chain of calls that waited for one another; null on the reference run (no delay, no intervals). */
  depth: number | null;
  recordedServer: number;
  recordedBrowser: number;
  recordedBackground: number;
  debugEdges?: string[];
  /** With PERF_LATENCY_DEBUG: every counted call as `from method path start-end` (ms from the step's start), the evidence for a depth that is over its ceiling. */
  chain?: string[];
  /** `METHOD path` → count, of the recorded server calls (a calibration failure names the paths that differ from Kong's). */
  recordedServerByPath: Record<string, number>;
  shortestMs: number | null;
  marks: Record<string, number | null>;
  /** RSC render requests the step caused (link prefetches excluded). */
  rsc: number;
  serverByPath: Record<string, number>;
  browserByPath: Record<string, number>;
}

export interface RowResult {
  id: string;
  kind: BudgetRow["kind"];
  budget: string;
  label: string;
  owner: string;
  /** The mark whose median is the row's time. */
  main: string;
  latencyMs: number;
  samples: Sample[];
  /** From the samples, never typed. */
  calls: { median: number; max: number };
  depth: { median: number; max: number } | null;
  ms: { median: number | null; max: number | null };
  targetMs: number | null;
  verdict: "within target" | "over target" | "no target";
  ceiling: { maxCalls: number; maxDepth: number; source: string } | null;
}

/** A server that has made no call for this long (twice the injected wait, and a margin) is done with a step. */
const QUIET_MS = Math.max(1_000, LATENCY_MS * 2 + 400);

/** Server requests that follow a timer, not the step (see {@link Sample.background}). */
const BACKGROUND_PATHS = ["/auth/v1/.well-known/jwks.json"];
const isBackgroundKey = (key: string) => BACKGROUND_PATHS.some((p) => key.endsWith(p));

const results: RowResult[] = [];
const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

// --- background requests ---------------------------------------------------------------------------------------------------------

export interface Holds {
  /** Refuse the shell's `/api/session-status` check while true. */
  status: boolean;
}

/**
 * Refuses the live-refresh probe for the whole test (unless `health` is false: the live row needs the refresh to run) and the status check
 * while `holds.status` is true.
 */
export async function holdBackground(page: Page, opts: { health?: boolean } = {}): Promise<Holds> {
  const holds: Holds = { status: false };
  if (opts.health !== false) await page.route("**/api/health", (route) => route.fulfill({ status: 503, body: "" }));
  await page.route("**/api/session-status", (route) => (holds.status ? route.fulfill({ status: 503, body: "" }) : route.fallback()));
  // V2-09e 09E-09 (R-5): the reference catalogue sync (after first paint, on resume) is the shell's own background work, not the step's: refused while a
  // window measures, like the status check (the device then answers from what it already holds, or the search route).
  await page.route("**/api/reference/**", (route) => (holds.status ? route.fulfill({ status: 503, body: "" }) : route.fallback()));
  return holds;
}

/** Seconds the device's session-context cookie is still good for (0 when it has none). */
export async function contextSecondsLeft(context: BrowserContext): Promise<number> {
  const cookie = (await context.cookies()).find((c) => c.name === CONTEXT_COOKIE && c.value !== "");
  if (!cookie) return 0;
  try {
    const payload = JSON.parse(Buffer.from(cookie.value.split(".")[0], "base64url").toString("utf8")) as { exp?: number };
    return Math.max(0, (payload.exp ?? 0) - Date.now() / 1000);
  } catch {
    return 0;
  }
}

/**
 * Makes sure the device holds a session-context cookie with time left (the zero-call fast paths hold only with one; only the shell's status
 * check issues it). Starts over without the cookie when it is close to its end.
 */
export async function ensureSessionContext(page: Page, context: BrowserContext, minSeconds = 150): Promise<void> {
  if ((await contextSecondsLeft(context)) >= minSeconds) return;
  await context.clearCookies({ name: CONTEXT_COOKIE });
  await page.goto("/today");
  await page.waitForLoadState("networkidle");
  await expect
    .poll(() => contextSecondsLeft(context), {
      message: "the shell's /api/session-status never issued the session-context cookie",
      intervals: [250, 500, 1_000],
      timeout: 45_000,
    })
    .toBeGreaterThan(minSeconds);
}

// --- one sample ------------------------------------------------------------------------------------------------------------------

/** Runs `body` between two Kong markers; returns its calls, its depth and the marks it returned. */
export async function measure(
  page: Page,
  holds: Holds,
  body: () => Promise<Record<string, number | null>>,
  idle: "network" | "quiet" = "network",
): Promise<Sample> {
  let rsc = 0;
  const onRequest = (request: { headers(): Record<string, string> }) => {
    const headers = request.headers();
    if (headers["rsc"] === "1" && headers["next-router-prefetch"] !== "1") rsc += 1;
  };
  page.on("request", onRequest);
  holds.status = true;
  let from = 0;
  const timing: { endAt?: number } = {};
  let marks: Record<string, number | null> = {};
  try {
    const kong = await countKongCalls(async () => {
      from = Date.now();
      marks = await body();
      if (idle === "network") await page.waitForLoadState("networkidle");
      // The server's own tail (work queued with after(), a refresh the response caused) is part of the step.
      if (LATENCY_MS > 0) await waitForQuiet(QUIET_MS);
    }, 1_200, timing);
    // The window closed when the end marker went out: a call that completed after it belongs to the next window (Kong's count stops there too).
    const to = timing.endAt ?? Date.now();
    const realtimeOf = (byPath: Record<string, number>) =>
      Object.entries(byPath).reduce((n, [key, count]) => (key.includes("/realtime/v1/websocket") ? n + count : n), 0);
    const realtime = realtimeOf(kong.browserByPath);
    const everyInterval = LATENCY_MS > 0 ? callIntervals({ from, to }) : [];
    const intervals = everyInterval.filter((c) => !BACKGROUND_PATHS.includes(c.path));
    const background = Object.fromEntries(Object.entries(kong.serverByPath).filter(([key]) => isBackgroundKey(key)));
    const backgroundKong = Object.values(background).reduce((n, count) => n + count, 0);
    const serverByPath = Object.fromEntries(Object.entries(kong.serverByPath).filter(([key]) => !isBackgroundKey(key)));
    return {
      calls: kong.server - backgroundKong + kong.browser - realtime,
      server: kong.server - backgroundKong,
      browser: kong.browser - realtime,
      realtime,
      background,
      depth: LATENCY_MS > 0 ? depthOf(intervals) : null,
      recordedServer: intervals.filter((c) => c.from === "server").length,
      recordedBrowser: intervals.filter((c) => c.from === "browser").length,
      recordedBackground: everyInterval.length - intervals.length,
      chain: process.env.PERF_LATENCY_DEBUG ? [...intervals].sort((a, b) => a.t0 - b.t0).map((c) => `${c.from} ${c.method} ${c.path} ${c.t0 - from}-${c.t1 - from}`) : undefined,
      debugEdges: process.env.PERF_LATENCY_DEBUG ? callIntervals({ from: from - 5000, to: to + 5000 }).filter((c) => c.t1 < from + 200 || c.t1 > to - 200).map((c) => `${c.from} ${c.method} ${c.path} t1-from=${c.t1 - from} t1-to=${c.t1 - to}`) : undefined,
      recordedServerByPath: intervals
        .filter((c) => c.from === "server")
        .reduce<Record<string, number>>((acc, c) => {
          const key = `${c.method} ${c.path}`;
          acc[key] = (acc[key] ?? 0) + 1;
          return acc;
        }, {}),
      shortestMs: everyInterval.length ? Math.min(...everyInterval.map((c) => c.t1 - c.t0)) : null,
      marks,
      rsc,
      serverByPath,
      browserByPath: Object.fromEntries(Object.entries(kong.browserByPath).filter(([key]) => !key.includes("/realtime/v1/websocket"))),
    };
  } finally {
    holds.status = false;
    page.off("request", onRequest);
  }
}

/** The calibration of one sample (empty = good). */
export function calibrationProblems(s: Sample): string[] {
  if (LATENCY_MS === 0) return [];
  const problems: string[] = [];
  if (s.recordedServer !== s.server) {
    const keys = new Set([...Object.keys(s.recordedServerByPath), ...Object.keys(s.serverByPath)]);
    const differ = [...keys].filter((k) => (s.recordedServerByPath[k] ?? 0) !== (s.serverByPath[k] ?? 0)).map((k) => `${k} recorded ${s.recordedServerByPath[k] ?? 0}, Kong ${s.serverByPath[k] ?? 0}`);
    problems.push(`recorded ${s.recordedServer} server calls, Kong counted ${s.server} (${differ.join("; ")})${s.debugEdges ? ` EDGES ${JSON.stringify(s.debugEdges)}` : ""}`);
  }
  const backgroundKong = Object.values(s.background).reduce((n, count) => n + count, 0);
  if (s.recordedBackground !== backgroundKong) problems.push(`recorded ${s.recordedBackground} background calls, Kong counted ${backgroundKong}`);
  if (s.recordedBrowser !== s.browser) problems.push(`recorded ${s.recordedBrowser} browser calls, Kong counted ${s.browser}`);
  if (s.shortestMs !== null && s.shortestMs < LATENCY_MS - TIMER_ALLOWANCE_MS) problems.push(`a call lasted ${s.shortestMs} ms, under the injected ${LATENCY_MS} ms`);
  return problems;
}

// --- one row ---------------------------------------------------------------------------------------------------------------------

export interface RowRun<S> {
  id: string;
  /** The mark whose median is the row's time (`data`, `option`, `confirmed`, `visible`). */
  main: string;
  page: Page;
  context: BrowserContext;
  holds: Holds;
  /** Not measured: put the page where the step starts (and seed the sample's own data). */
  prepare: () => Promise<S>;
  /** Measured: the click or the key, and the waits that end the measure; returns the marks (ms inside the page). */
  act: (state: S) => Promise<Record<string, number | null>>;
  /** Samples after the warm-up (default {@link SAMPLES}). */
  samples?: number;
  /** A per-sample step before `prepare`, e.g. a signed-in role change. */
  sessionContext?: boolean;
  /**
   * What "the page is idle" means. "network" (default): Playwright's network idle. "quiet": no Supabase call finished for a while (a live screen keeps a
   * channel and a liveness probe going, so the network is never idle for as long as Playwright wants).
   */
  idle?: "network" | "quiet";
}

/** Warm-up, then N measured samples; records the row for the report and enforces calibration and the ceilings. */
export async function runRow<S>(run: RowRun<S>): Promise<RowResult> {
  const row = budgetRow(run.id);
  const count = run.samples ?? SAMPLES;
  await setSupabaseLatency(run.context, LATENCY_MS);
  const samples: Sample[] = [];
  for (let i = -1; i < count; i++) {
    if (run.sessionContext !== false) await ensureSessionContext(run.page, run.context);
    const state = await run.prepare();
    // Nothing from the preparation may still be on its way: Kong logs a call when it completes, so one still running at the start marker would count in the window.
    if (run.idle !== "quiet") await run.page.waitForLoadState("networkidle");
    if (LATENCY_MS > 0) await waitForQuiet(QUIET_MS);
    const sample = await measure(run.page, run.holds, () => run.act(state), run.idle);
    if (i < 0) continue; // the warm-up: first-hit costs (JWKS, a cold route) are not a per-step cost
    const problems = calibrationProblems(sample);
    expect(problems, `${run.id} sample ${i + 1}: the latency calibration failed`).toEqual([]);
    samples.push(sample);
  }
  const result = summarise(row, run.main, samples);
  results.push(result);
  enforce(result);
  return result;
}

function summarise(row: BudgetRow, main: string, samples: Sample[]): RowResult {
  const times = samples.map((s) => s.marks[main]).filter((m): m is number => typeof m === "number");
  const medianMs = times.length ? median(times) : null;
  const ceil = ceilingOf(row.id);
  return {
    id: row.id,
    kind: row.kind,
    budget: row.budget,
    label: row.label,
    owner: row.owner,
    main,
    latencyMs: LATENCY_MS,
    samples,
    calls: { median: median(samples.map((s) => s.calls)), max: Math.max(...samples.map((s) => s.calls)) },
    depth: LATENCY_MS > 0 ? { median: median(samples.map((s) => s.depth ?? 0)), max: Math.max(...samples.map((s) => s.depth ?? 0)) } : null,
    ms: { median: medianMs, max: times.length ? Math.max(...times) : null },
    targetMs: row.targetMs ?? null,
    verdict: row.targetMs === undefined || medianMs === null ? "no target" : medianMs <= row.targetMs ? "within target" : "over target",
    ceiling: ceil ? { maxCalls: ceil.maxCalls, maxDepth: ceil.maxDepth, source: ceil.source } : null,
  };
}

/** Calls and depth block (R-4); only at an injected delay above 0 (the reference run reports calls only). */
function enforce(result: RowResult): void {
  // 09E-08 (R-11, B-7): a save causes no RSC page request (blocking, any delay): `maxRsc` of the row, 0 by default.
  const row = budgetRow(result.id);
  if (row.kind === "save") {
    result.samples.forEach((s, i) => expect(s.rsc, `${result.id} sample ${i + 1}: RSC page requests the save caused (max ${row.maxRsc ?? 0})`).toBeLessThanOrEqual(row.maxRsc ?? 0));
  }
  if (!result.ceiling || LATENCY_MS === 0) return;
  const { maxCalls, maxDepth, source } = result.ceiling;
  result.samples.forEach((s, i) => {
    const where = `${result.id} sample ${i + 1} (ceiling from ${source})`;
    expect(s.calls, `${where}: Supabase calls ${JSON.stringify({ server: s.serverByPath, browser: s.browserByPath })}`).toBeLessThanOrEqual(maxCalls);
    expect(s.depth ?? 0, `${where}: round-trip depth${s.chain ? ` CHAIN ${JSON.stringify(s.chain)}` : ""}`).toBeLessThanOrEqual(maxDepth);
  });
}

// --- the report ------------------------------------------------------------------------------------------------------------------

export function resetLane(): void {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  resetLatencyRecords();
}

const fmt = (n: number | null | undefined) => (n === null || n === undefined ? "n/a" : String(Math.round(n)));
const byPathText = (byPath: Record<string, number>) =>
  Object.entries(byPath)
    .sort((a, b) => b[1] - a[1])
    .map(([key, n]) => `${key} x${n}`)
    .join("; ");

/** `summary.json` and `summary.md` of the lane (what ran in this process), and the step summary table on stdout. */
export function writeReport(): void {
  if (!results.length) return;
  fs.mkdirSync(OUT_DIR, { recursive: true });
  // PERF_LATENCY_MERGE=<summary.json of an earlier run at the same delay and samples>: this run's rows replace theirs by id, so one row that had to
  // be measured again (after its cause was fixed) joins the others without typing or re-running them. Anything else is refused.
  let merged: RowResult[] = [...results];
  const mergeFrom = process.env.PERF_LATENCY_MERGE;
  if (mergeFrom) {
    const prior = JSON.parse(fs.readFileSync(mergeFrom, "utf8")) as { latencyMs: number; samples: number; rows: RowResult[] };
    if (prior.latencyMs !== LATENCY_MS || prior.samples !== SAMPLES) {
      throw new Error(`PERF_LATENCY_MERGE: ${mergeFrom} was taken at ${prior.latencyMs} ms with ${prior.samples} samples, not ${LATENCY_MS} ms with ${SAMPLES}`);
    }
    const mine = new Set(results.map((r) => r.id));
    merged = [...prior.rows.filter((r) => !mine.has(r.id)), ...results];
  }
  const ordered = merged.sort((a, b) => a.id.localeCompare(b.id));
  const header = [
    `| Row | Budget | Calls (median / max) | Depth (median / max) | ms (median / max) | Target ms | Verdict | Skeleton ms | RSC | Owner | Server calls by path (last sample) |`,
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  const lines = ordered.map((r) => {
    const last = r.samples[r.samples.length - 1];
    return [
      `| ${r.id}`,
      r.budget,
      `${r.calls.median} / ${r.calls.max}`,
      r.depth ? `${r.depth.median} / ${r.depth.max}` : "n/a",
      `${fmt(r.ms.median)} / ${fmt(r.ms.max)}`,
      fmt(r.targetMs),
      r.verdict,
      fmt(median(r.samples.map((s) => s.marks.skeleton).filter((m): m is number => typeof m === "number")) ?? null),
      String(median(r.samples.map((s) => s.rsc))),
      r.owner,
      `${byPathText(last.serverByPath)}${Object.keys(last.browserByPath).length ? ` | browser: ${byPathText(last.browserByPath)}` : ""} |`,
    ].join(" | ");
  });
  const md = [
    `Latency lane: ${LATENCY_MS} ms added to every Supabase call, ${SAMPLES} samples after one warm-up (desktop-chrome).`,
    "Calls and depth block on a rise over the row's ceiling; milliseconds are medians, reported only. The Realtime socket is not delayed (HTTP only).",
    "",
    ...header,
    ...lines,
    "",
  ].join("\n");
  fs.writeFileSync(path.join(OUT_DIR, "summary.md"), md);
  fs.writeFileSync(
    path.join(OUT_DIR, "summary.json"),
    `${JSON.stringify({ latencyMs: LATENCY_MS, samples: SAMPLES, note: "Realtime socket upgrades are not delayed and are counted apart (realtime), not in calls", rows: ordered }, null, 2)}\n`,
  );
  console.log(`\n${md}`);
  const stepSummary = process.env.GITHUB_STEP_SUMMARY;
  if (stepSummary) fs.appendFileSync(stepSummary, `\n### Latency budgets (${LATENCY_MS} ms)\n\n${md}\n`);
}

export function endLane(): void {
  clearSupabaseLatency();
}
