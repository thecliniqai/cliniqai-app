/**
 * V2-09e 09E-02 (R-20, step 3): a staging smoke timing run, driven by the product owner.
 *
 *   npm run perf:staging-smoke -- --base-url https://<staging host>          (headed: the PO signs in by hand, then it walks)
 *   npm run perf:staging-smoke -- --local [--base-url http://127.0.0.1:3100]  (how the executor checks it: loopback only, local synthetic login)
 *
 * Walks Today, Schedule (day and week), Patients, one patient, one consult, then one medicine search and one diagnosis search. It writes
 * nothing: every step is a page load, a click on a link or a GET. Per step it records the navigation-to-data-ready time (the app's own
 * `clinicos.data_ready` mark, set by `DataReady`), the `Server-Timing` of the app's data routes the step called, and the Web Vitals the
 * browser reported (LCP, CLS, FCP, TTFB). Output: `staging-smoke-<date>.json` and `.md` in `--out-dir` (default
 * `.planning/phases/09E-caching-speed/evidence`).
 *
 * `--local`: the base URL must be loopback; the login is the local synthetic one (`SMOKE_EMAIL` and `SMOKE_PASSWORD` in the shell, from
 * `npm run seed:local`), typed into the form; headless unless `--headed`. Agents never run it against staging. Without `--local` it accepts any non-loopback URL, opens a visible browser and waits (5 minutes) for the PO to sign in.
 * Reads no `.env` file and sends nothing but the page's own requests.
 */
import fs from "node:fs";
import path from "node:path";
import { chromium, type Page } from "@playwright/test";

const ROOT = path.resolve(__dirname, "../..");
const DEFAULT_OUT_DIR = ".planning/phases/09E-caching-speed/evidence";
const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const MARK = "clinicos.data_ready";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface Args {
  local: boolean;
  baseUrl: string;
  headed: boolean;
  outDir: string;
}

export function parseArgs(argv: string[]): { ok: true; args: Args } | { ok: false; error: string } {
  let local = false;
  let headed = false;
  let baseUrl: string | null = null;
  let outDir = DEFAULT_OUT_DIR;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--local") local = true;
    else if (arg === "--headed") headed = true;
    else if (arg === "--base-url" || arg === "--out-dir") {
      const value = argv[++i];
      if (!value || value.startsWith("-")) return { ok: false, error: `${arg} needs a value` };
      if (arg === "--base-url") baseUrl = value;
      else outDir = value;
    } else {
      return { ok: false, error: `refusing ${arg}: usage: staging-smoke [--local] [--base-url <url>] [--headed] [--out-dir <dir>]` };
    }
  }
  const url = baseUrl ?? (local ? "http://127.0.0.1:3100" : null);
  if (url === null) return { ok: false, error: "--base-url is required without --local" };
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return { ok: false, error: "--base-url is not a URL" };
  }
  if (local && !LOOPBACK.has(host)) return { ok: false, error: "--local refuses a base URL that is not loopback" };
  if (!local && LOOPBACK.has(host)) return { ok: false, error: "without --local the base URL must be the staging host, not loopback" };
  return { ok: true, args: { local, baseUrl: url.replace(/\/$/, ""), headed: local ? headed : true, outDir } };
}

interface Vitals {
  lcp: number | null;
  cls: number | null;
  fcp: number | null;
  ttfb: number | null;
}

interface RouteTiming {
  /** The route's path without query or ids. */
  route: string;
  serverTiming: Array<{ name: string; durationMs: number; description: string }>;
  ms: number;
}

export interface StepResult {
  step: string;
  kind: "load" | "click" | "api";
  status: "ok" | "skipped" | "failed";
  note?: string;
  dataReadyMs: number | null;
  vitals: Vitals | null;
  routes: RouteTiming[];
}

const INIT_SCRIPT = `
  (() => {
    const v = { lcp: null, cls: 0, fcp: null };
    try { new PerformanceObserver((l) => { const e = l.getEntries(); const last = e[e.length - 1]; if (last) v.lcp = last.startTime; }).observe({ type: "largest-contentful-paint", buffered: true }); } catch {}
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) v.cls += e.value; }).observe({ type: "layout-shift", buffered: true }); } catch {}
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === "first-contentful-paint") v.fcp = e.startTime; }).observe({ type: "paint", buffered: true }); } catch {}
    window.__smokeVitals = v;
  })();
`;

const pathOnly = (url: string) => new URL(url).pathname.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "[id]");

async function readVitals(page: Page): Promise<Vitals> {
  return page.evaluate(() => {
    const w = window as unknown as { __smokeVitals?: { lcp: number | null; cls: number; fcp: number | null } };
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    return { lcp: w.__smokeVitals?.lcp ?? null, cls: w.__smokeVitals ? Math.round(w.__smokeVitals.cls * 1000) / 1000 : null, fcp: w.__smokeVitals?.fcp ?? null, ttfb: nav ? nav.responseStart : null };
  });
}

/** The app's own data routes the page called since `since` (resource timing), with their Server-Timing. */
async function readRoutes(page: Page, since: number): Promise<RouteTiming[]> {
  const raw = await page.evaluate((from) => {
    return (performance.getEntriesByType("resource") as PerformanceResourceTiming[])
      .filter((e) => e.startTime >= from && new URL(e.name).pathname.startsWith("/api/"))
      .map((e) => ({ url: e.name, ms: e.responseEnd - e.startTime, serverTiming: e.serverTiming.map((s) => ({ name: s.name, durationMs: s.duration, description: s.description })) }));
  }, since);
  return raw.map((r) => ({ route: pathOnly(r.url), ms: Math.round(r.ms), serverTiming: r.serverTiming }));
}

async function waitForMark(page: Page): Promise<number | null> {
  try {
    await page.waitForFunction((name) => performance.getEntriesByName(name).length > 0, MARK, { timeout: 30_000 });
    return await page.evaluate((name) => Math.round(performance.getEntriesByName(name).slice(-1)[0]!.startTime), MARK);
  } catch {
    return null;
  }
}

async function loadStep(page: Page, base: string, step: string, pathAndQuery: string): Promise<StepResult> {
  try {
    await page.goto(`${base}${pathAndQuery}`, { waitUntil: "load" });
    const dataReadyMs = await waitForMark(page);
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
    return { step, kind: "load", status: dataReadyMs === null ? "failed" : "ok", note: dataReadyMs === null ? "no data-ready mark within 30 s" : undefined, dataReadyMs, vitals: await readVitals(page), routes: await readRoutes(page, 0) };
  } catch (err) {
    return { step, kind: "load", status: "failed", note: err instanceof Error ? err.name : "error", dataReadyMs: null, vitals: null, routes: [] };
  }
}

async function clickStep(page: Page, step: string, selector: string): Promise<StepResult> {
  const link = page.locator(selector).first();
  if ((await link.count()) === 0) return { step, kind: "click", status: "skipped", note: "no such link on the page (no data of that kind)", dataReadyMs: null, vitals: null, routes: [] };
  try {
    const before = await page.evaluate(() => performance.now());
    await page.evaluate((name) => performance.clearMarks(name), MARK);
    await link.click();
    await page.waitForFunction((name) => performance.getEntriesByName(name).length > 0, MARK, { timeout: 30_000 });
    const readyAt = await page.evaluate((name) => performance.getEntriesByName(name).slice(-1)[0]!.startTime, MARK);
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
    return { step, kind: "click", status: "ok", dataReadyMs: Math.round(readyAt - before), vitals: await readVitals(page), routes: await readRoutes(page, before) };
  } catch (err) {
    return { step, kind: "click", status: "failed", note: err instanceof Error ? err.name : "error", dataReadyMs: null, vitals: null, routes: [] };
  }
}

async function apiStep(page: Page, step: string, pathAndQuery: string): Promise<StepResult> {
  try {
    const result = await page.evaluate(async (target) => {
      const t0 = performance.now();
      const res = await fetch(target, { credentials: "same-origin" });
      await res.text();
      return { status: res.status, ms: performance.now() - t0, since: t0 };
    }, pathAndQuery);
    const routes = await readRoutes(page, result.since - 5);
    return { step, kind: "api", status: result.status === 200 ? "ok" : "failed", note: result.status === 200 ? undefined : `HTTP ${result.status}`, dataReadyMs: Math.round(result.ms), vitals: null, routes };
  } catch (err) {
    return { step, kind: "api", status: "failed", note: err instanceof Error ? err.name : "error", dataReadyMs: null, vitals: null, routes: [] };
  }
}

export function renderMarkdown(date: string, base: string, local: boolean, steps: StepResult[]): string {
  const rows = steps.map((s) => {
    const v = s.vitals;
    const route = s.routes.map((r) => `${r.route} ${r.serverTiming.map((t) => `${t.name} ${Math.round(t.durationMs)} ms${t.description ? ` (${t.description})` : ""}`).join(", ") || `${r.ms} ms`}`).join("; ");
    return `| ${s.step} | ${s.status}${s.note ? ` (${s.note})` : ""} | ${s.dataReadyMs ?? ""} | ${v?.lcp !== null && v ? Math.round(v.lcp!) : ""} | ${v?.cls ?? ""} | ${v?.fcp !== null && v ? Math.round(v.fcp!) : ""} | ${v?.ttfb !== null && v ? Math.round(v.ttfb!) : ""} | ${route} |`;
  });
  return [
    `# Staging smoke ${date}${local ? " (local run)" : ""}`,
    "",
    `Base: ${local ? "loopback (local stack)" : "staging"}. Steps read only. Times in ms; data ready is the app's own \`clinicos.data_ready\` mark (a load: from navigation start; a click: from the click).`,
    "",
    "| step | result | data ready | LCP | CLS | FCP | TTFB | data routes (Server-Timing) |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |",
    ...rows,
    "",
  ].join("\n");
}

async function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(`staging-smoke: ${parsed.error}`);
    return 1;
  }
  const { args } = parsed;
  const browser = await chromium.launch({ headless: !args.headed });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript(INIT_SCRIPT);
  const page = await context.newPage();
  const steps: StepResult[] = [];
  try {
    await page.goto(`${args.baseUrl}/login`);
    if (args.local) {
      const email = process.env.SMOKE_EMAIL;
      const password = process.env.SMOKE_PASSWORD;
      if (!email || !password) {
        console.error("staging-smoke: --local needs SMOKE_EMAIL and SMOKE_PASSWORD in the shell (a synthetic login from `npm run seed:local`)");
        return 1;
      }
      await page.getByLabel(/^Email/).fill(email);
      await page.getByLabel(/^Password/).fill(password);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
    } else {
      console.log("staging-smoke: sign in by hand in the browser window; the walk starts when you reach the app (5 minutes).");
    }
    await page.waitForURL((url) => !["/login", "/forgot-password"].includes(url.pathname), { timeout: 300_000 });

    steps.push(await loadStep(page, args.baseUrl, "Today", "/today"));
    steps.push(await clickStep(page, "Today to one consult (link)", 'a[href^="/consultation/"]'));
    steps.push(await loadStep(page, args.baseUrl, "Schedule day", "/schedule?view=day"));
    steps.push(await loadStep(page, args.baseUrl, "Schedule week", "/schedule?view=week"));
    steps.push(await loadStep(page, args.baseUrl, "Patients", "/patients"));
    const patientHref = await page.locator('a[href^="/patients/"]').evaluateAll((links) =>
      links.map((l) => (l as HTMLAnchorElement).getAttribute("href") ?? "").find((h) => /^\/patients\/[0-9a-f-]{36}$/i.test(h)) ?? null,
    );
    steps.push(
      patientHref && UUID.test(patientHref.split("/")[2] ?? "")
        ? await clickStep(page, "Patients to one patient (link)", `a[href="${patientHref}"]`)
        : { step: "Patients to one patient (link)", kind: "click", status: "skipped", note: "no patient in the list", dataReadyMs: null, vitals: null, routes: [] },
    );
    steps.push(await apiStep(page, "Medicine search (GET)", "/api/prescriptions/medicines?q=para"));
    steps.push(await apiStep(page, "Diagnosis search (GET)", "/api/terminology/diagnoses?q=fever"));
  } finally {
    await browser.close();
  }

  const date = new Date().toISOString().slice(0, 10);
  const outDir = path.resolve(ROOT, args.outDir);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `staging-smoke-${date}.json`), `${JSON.stringify({ date, local: args.local, steps }, null, 2)}\n`);
  fs.writeFileSync(path.join(outDir, `staging-smoke-${date}.md`), renderMarkdown(date, args.baseUrl, args.local, steps));
  const failed = steps.filter((s) => s.status === "failed");
  const measured = steps.filter((s) => s.status === "ok").length;
  console.log(`staging-smoke: ${measured} measured, ${steps.filter((s) => s.status === "skipped").length} skipped, ${failed.length} failed; wrote ${path.relative(ROOT, outDir)}/staging-smoke-${date}.{json,md}`);
  return failed.length > 0 || measured < 4 ? 1 : 0;
}

if (require.main === module) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      console.error(`staging-smoke: ${err instanceof Error ? err.name : "error"}`);
      process.exitCode = 1;
    },
  );
}
