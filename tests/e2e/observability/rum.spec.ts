/**
 * V2-09e 09E-02 (R-20, decision 10; T-09E-14, T-09E-17): observability without a vendor, end to end, on desktop-chrome and pixel-7.
 *
 *   - Real-user monitoring: a doctor opens Today, goes to Patients with a click, opens a consult and runs a diagnosis search. Every beacon the page
 *     sends to `POST /api/rum` holds only closed-list words and numbers (no uuid, no path, no text); `ops.rum_daily` (read as postgres on loopback)
 *     gains the screens and metrics those steps produce, with this project's device class, and holds no tenant, user, URL or id.
 *   - Server timing: the diagnosis search route answers with `Server-Timing: db;dur;desc="calls=<n> depth=<d>", app;dur` (also read through
 *     `PerformanceResourceTiming.serverTiming`), and the e2e server's log holds one `request.timing` line for that request whose `db_calls` equals the
 *     number of Supabase calls Kong logged for it. The lines carry no query, uuid or text.
 * Synthetic data only.
 */
import { expect, test } from "../fixtures";
import { awaitHydrated } from "../support/hydrated";
import { countKongCalls } from "../support/kong-calls";
import { run, seedPatient, seedVisit, testTag } from "../support/m0-data";
import { retireOwnDoctor, seedOwnDoctor, signInAsOwnDoctor } from "../support/own-doctor";
import { storageStatePath, type RunUser } from "../support/run-data";
import { logOffset, readLogFrom, SERVER_STDERR_LOG, SERVER_STDOUT_LOG } from "../support/server-log";
import { psql } from "../../helpers/sql";
import { SAVE_ROWS } from "../perf/latency-saves";

test.use({ storageState: storageStatePath("doctor") });

let ownDoctor: RunUser | null = null;
test.afterEach(async () => {
  if (ownDoctor) await retireOwnDoctor(ownDoctor);
  ownDoctor = null;
});

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const SCREENS = ["today", "schedule", "patients", "patient", "consult", "visits", "billing", "settings", "staff", "other"];
const METRICS = ["lcp", "inp", "cls", "ttfb", "fcp", "nav_data_ready", "load_data_ready", "search_server", "search_device", "save_reversible", "save_confirmed", "finish_confirmed", "live_reread", "live_dropped", "live_reconnect"];
const DEVICES = ["phone", "tablet", "desktop"];
const NETS = ["slow-2g", "2g", "3g", "4g", "unknown"];

function counts(): Map<string, number> {
  const out = new Map<string, number>();
  for (const line of psql("select screen || '|' || metric || '|' || device, sum(count) from ops.rum_daily group by 1")) {
    const parts = line.split("|");
    out.set(parts.slice(0, 3).join("|"), Number(parts[3]));
  }
  return out;
}

test("real users: the beacons hold only closed words and numbers, and ops.rum_daily gains the screens and metrics of the steps", async ({ page }, testInfo) => {
  test.slow();
  const device = testInfo.project.name === "pixel-7" ? "phone" : "desktop";
  // The test's own doctor: `POST /api/rum` limits each user to 10 batches a minute, and every page this test leaves sends one, so a user shared with the
  // other specs and the other device project would be limited mid-test (429, found by the repeat run).
  const own = await seedOwnDoctor("rum");
  ownDoctor = own;
  await signInAsOwnDoctor(page, own);
  const before = counts();
  const bodies: string[] = [];
  page.on("request", (req) => {
    if (req.method() === "POST" && new URL(req.url()).pathname === "/api/rum") bodies.push(req.postData() ?? "");
  });

  // Today, then a click to Patients (nav_data_ready), then a consult with a diagnosis search (search_server).
  // 09E-10: with the diagnosis catalogue on the device the search makes no request; this test measures the server path, so the catalogue stays off
  // the device (the device path's `search_device` is recorded by tests/e2e/reference/diagnoses-local.spec.ts).
  await page.route("**/api/reference/**", (route) => route.abort());
  await page.goto("/today");
  await awaitHydrated(page, "#main");
  await expect.poll(() => page.evaluate(() => performance.getEntriesByName("clinicos.data_ready").length), { timeout: 15_000 }).toBeGreaterThan(0);
  await page.goto("/today"); // a clean first screen of this document for the click below
  await awaitHydrated(page, "#main");
  const nav = device === "phone" ? page.getByRole("navigation").getByRole("link", { name: /^Patients$/ }).first() : page.getByRole("link", { name: /^Patients$/ }).first();
  // A link clicked before React attached its handler is a full page load, not the in-app navigation measured here.
  await expect.poll(() => nav.evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactProps$"))), { timeout: 15_000 }).toBe(true);
  await nav.click();
  await page.waitForURL((u) => u.pathname === "/patients");
  // Two marks in this document: Today's, and Patients' (the click's end).
  await expect.poll(() => page.evaluate(() => performance.getEntriesByName("clinicos.data_ready").length), { timeout: 15_000 }).toBeGreaterThanOrEqual(2);

  const { tenantA } = run();
  const patient = await seedPatient(tenantA.id, tenantA.users.owner.id, `E2E Synthetic RUM ${testTag()}`);
  const visitId = await seedVisit({ tenantId: tenantA.id, patientId: patient.id, doctorId: own.id, createdBy: tenantA.users.receptionist.id, status: "in_consultation" });
  await page.goto(`/consultation/${visitId}`);
  await expect(page.getByLabel("History of Present Illness & Clinical Notes")).toBeVisible();
  await awaitHydrated(page);
  const search = page.locator('input[placeholder*="Search diagnosis name"]');
  await search.click();
  const answered = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/terminology/diagnoses" && r.request().url().includes("q=fever"), { timeout: 15_000 });
  await search.pressSequentially("fever", { delay: 40 });
  await answered;
  await expect(page.getByRole("option").first()).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(300); // the answer is applied and its timing recorded in the next ticks

  // The page goes away: the batch leaves as a beacon.
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await expect.poll(() => bodies.length, { timeout: 10_000 }).toBeGreaterThan(0);

  await testInfo.attach("beacons", { body: bodies.join("\n"), contentType: "text/plain" });
  const samples = bodies.flatMap((b) => {
    const parsed = JSON.parse(b) as { samples: Array<Record<string, unknown>> };
    expect(Object.keys(parsed), "a batch holds only `samples`").toEqual(["samples"]);
    return parsed.samples;
  });
  expect(samples.length).toBeGreaterThan(0);
  for (const s of samples) {
    expect(Object.keys(s).sort()).toEqual(["device", "metric", "net", "screen", "value"]);
    expect(SCREENS).toContain(s.screen);
    expect(METRICS).toContain(s.metric);
    expect(DEVICES).toContain(s.device);
    expect(NETS).toContain(s.net);
    expect(typeof s.value === "number" && Number.isFinite(s.value) && s.value >= 0).toBe(true);
  }
  const wire = bodies.join("\n");
  expect(wire, "no uuid in any beacon").not.toMatch(UUID);
  expect(wire).not.toContain(visitId);
  expect(wire).not.toContain("fever");
  expect(wire).not.toContain("/consultation");
  expect(new Set(samples.map((s) => s.device))).toEqual(new Set([device]));

  // The database gained those rows (the server answers 204 asynchronously: poll).
  const gained = (screen: string, metric: string) => (counts().get(`${screen}|${metric}|${device}`) ?? 0) - (before.get(`${screen}|${metric}|${device}`) ?? 0);
  const seen = `beacons held: ${samples.map((s) => `${s.screen}/${s.metric}/${s.device}`).join(" ")}`;
  await expect.poll(() => gained("consult", "search_server"), { timeout: 15_000, message: `the diagnosis search's real-user timing; ${seen}` }).toBeGreaterThanOrEqual(1);
  expect(gained("today", "load_data_ready"), seen).toBeGreaterThanOrEqual(1);
  expect(gained("patients", "nav_data_ready"), seen).toBeGreaterThanOrEqual(1);
  expect(gained("consult", "load_data_ready"), seen).toBeGreaterThanOrEqual(1);

  // Nothing identifying in the table: closed words, a day and numbers.
  const [shape] = psql(`select coalesce(bool_and(screen = any(array['today','schedule','patients','patient','consult','visits','billing','settings','staff','other'])
      and device = any(array['phone','tablet','desktop']) and net = any(array['slow-2g','2g','3g','4g','unknown'])
      and metric ~ '^[a-z_]+$'), false) from ops.rum_daily`);
  expect(shape).toBe("t");
  const [columns] = psql("select string_agg(attname, ',' order by attnum) from pg_attribute where attrelid = 'ops.rum_daily'::regclass and attnum > 0 and not attisdropped");
  expect(columns).toBe("day,environment,release,screen,metric,device,net,bucket,count");
});

test("saves by risk class: an Rx line records save_reversible, an allergy save save_confirmed, sign and finish finish_confirmed; the beacons hold no id or text", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "the saves are the latency lane's, which runs on desktop-chrome");
  test.slow();
  const bodies: string[] = [];
  page.on("request", (req) => {
    if (req.method() === "POST" && new URL(req.url()).pathname === "/api/rum") bodies.push(req.postData() ?? "");
  });
  const gainedOf = (metric: string) => counts().get(`consult|${metric}|desktop`) ?? 0;
  const before = { reversible: gainedOf("save_reversible"), confirmed: gainedOf("save_confirmed"), finish: gainedOf("finish_confirmed") };
  for (const id of ["save.D.add-rx-line", "save.D.allergies", "save.D.sign-finish"]) {
    const row = SAVE_ROWS.find((r) => r.id === id)!;
    const state = await row.prepare(page);
    await row.act(page, state);
    // The batch leaves as a beacon when the page goes away.
    await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  }
  await expect.poll(() => gainedOf("save_reversible") - before.reversible, { timeout: 20_000, message: "the Rx line's real-user timing" }).toBeGreaterThanOrEqual(1);
  await expect.poll(() => gainedOf("save_confirmed") - before.confirmed, { timeout: 20_000, message: "the allergy save's real-user timing" }).toBeGreaterThanOrEqual(1);
  await expect.poll(() => gainedOf("finish_confirmed") - before.finish, { timeout: 20_000, message: "sign and finish's real-user timing" }).toBeGreaterThanOrEqual(1);
  const wire = bodies.join("\n");
  expect(wire, "no uuid in any beacon").not.toMatch(UUID);
  expect(wire).not.toContain("/consultation");
  expect(wire).not.toMatch(/Perfrx|PerfSign|PerfAllergy/i);
});

test("server timing: the route answers Server-Timing and its request.timing line matches Kong's count", async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "the call count does not depend on the device; one project keeps Kong's window quiet");
  test.slow();
  await page.goto("/today");
  await awaitHydrated(page, "#main");
  await page.goto("about:blank");
  // The page that just went away flushed its real-user batch (a request to `/api/rum`, which reads the session and writes through Kong too): wait until
  // Kong sees nothing from the server for a moment, so the window below holds only the route under test.
  await expect
    .poll(async () => (await countKongCalls(async () => undefined, 600)).server, { timeout: 20_000, message: "the server is quiet before the window" })
    .toBe(0);

  const stdout0 = logOffset(SERVER_STDOUT_LOG);
  const stderr0 = logOffset(SERVER_STDERR_LOG);
  let answer: { requestId: string; header: string } | null = null;
  const kong = await countKongCalls(async () => {
    const res = await context.request.get("/api/terminology/diagnoses?q=fever&specialty=general");
    expect(res.status()).toBe(200);
    answer = { requestId: res.headers()["x-request-id"] ?? "", header: res.headers()["server-timing"] ?? "" };
  }, 1500);
  expect(answer).not.toBeNull();
  const { requestId, header } = answer!;
  expect(requestId).toMatch(UUID);
  expect(header).toMatch(/^db;dur=\d+(\.\d)?;desc="calls=\d+ depth=\d+", app;dur=\d+(\.\d)?$/);
  const headerCalls = Number(/calls=(\d+)/.exec(header)![1]);
  const headerDepth = Number(/depth=(\d+)/.exec(header)![1]);

  // The line is written after the response: poll the server's own log.
  let timing: Record<string, unknown> | undefined;
  await expect
    .poll(
      () => {
        const text = readLogFrom(SERVER_STDOUT_LOG, stdout0) + readLogFrom(SERVER_STDERR_LOG, stderr0);
        const lines = text.split("\n").filter((l) => l.includes(requestId) && l.includes('"event":"request.'));
        timing = lines.map((l) => JSON.parse(l) as Record<string, unknown>).find((l) => l.event === "request.timing");
        return timing !== undefined;
      },
      { timeout: 10_000, message: "the request.timing line" },
    )
    .toBe(true);
  expect(timing).toMatchObject({ timing_kind: "route", route: "/api/terminology/diagnoses", outcome: "ok", status: 200 });
  expect(timing!.db_calls, `the line's calls equal Kong's count for the request (${JSON.stringify(kong.serverByPath)})`).toBe(kong.server);
  expect(headerCalls).toBe(kong.server);
  expect(timing!.db_depth).toBe(headerDepth);
  expect(timing!.db_depth as number).toBeGreaterThanOrEqual(1);
  expect(typeof timing!.total_ms).toBe("number");

  // Every line of the request holds closed fields only: no query, no uuid but the request id, no text.
  const mine = (readLogFrom(SERVER_STDOUT_LOG, stdout0) + readLogFrom(SERVER_STDERR_LOG, stderr0)).split("\n").filter((l) => l.includes(requestId));
  expect(mine.length).toBeGreaterThanOrEqual(2); // request.start and request.timing (and a request.call per Supabase call)
  for (const line of mine) {
    expect(line).not.toContain("fever");
    expect(line).not.toContain("?");
    expect(line.replace(requestId, "")).not.toMatch(UUID);
  }

  // The browser reads the same header through the Performance API.
  await page.goto("/today");
  await awaitHydrated(page, "#main");
  const serverTiming = await page.evaluate(async () => {
    // An observer, not getEntries: the page's resource buffer (250 entries) is already full of chunks and prefetches, and a full buffer drops new entries.
    const seen = new Promise<PerformanceResourceTiming>((resolve, reject) => {
      const observer = new PerformanceObserver((list) => {
        const hit = (list.getEntries() as PerformanceResourceTiming[]).find((e) => e.name.includes("/api/terminology/diagnoses"));
        if (hit) {
          observer.disconnect();
          resolve(hit);
        }
      });
      observer.observe({ type: "resource" });
      setTimeout(() => reject(new Error("no resource entry for the diagnosis search")), 10_000);
    });
    // The entry is added once the body has been read.
    await (await fetch("/api/terminology/diagnoses?q=fever&specialty=general", { credentials: "same-origin" })).text();
    const entry = await seen;
    return entry.serverTiming.map((s) => ({ name: s.name, duration: s.duration, description: s.description }));
  });
  expect(serverTiming.map((s) => s.name)).toEqual(["db", "app"]);
  expect(serverTiming[0]!.description).toMatch(/^calls=\d+ depth=\d+$/);
});
