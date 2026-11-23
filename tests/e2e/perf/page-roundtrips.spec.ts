/**
 * V2-09d (request speed): Supabase round trips per page navigation and per server action, report-only.
 * Project `perf-roundtrips` only (`npm run perf:roundtrips`), never the PR lane (the PR-lane ceiling for the busiest
 * pages is `tests/e2e/shell/request-budget.spec.ts`).
 *
 * Runs inside the e2e run (the guarded server on 127.0.0.1:3100, the run's seeded tenant, the signed-in storage states
 * of the setup project). For each role and page: one warm-up load (first-hit costs such as the JWKS fetch are not a
 * per-navigation cost), then {@link SAMPLES} full loads, each counted between two Kong markers
 * (`support/kong-calls.ts`): the Supabase calls of the app server and of the browser, by path, and the navigation time
 * (Navigation Timing `responseEnd`: the document fully streamed, i.e. the server's work, and `loadEventEnd`). A full
 * load includes the shell's on-load `/api/session-status` check (the one fresh Auth + database check). Then
 * {@link SAMPLES} in-app (soft) navigations to the same page from another page (`router.push`, what a click on a link
 * does), counted the same way, with the time from the push until the network is idle. Then two server actions: the
 * receptionist's "Check in" on Today (fast path), counted from the click until the row is in Waiting, and (09D-01a, ruling
 * R-S) the owner's "Save printing settings" on /settings/clinic, an action on the closed list of sensitive actions
 * (`lib/auth/sensitive-actions.ts`: liveness, membership and access level from the database), counted from the click
 * until "Saved." shows. The values saved are the ones already stored (nothing changes).
 *
 * Output: a table on stdout and `test-results/perf-roundtrips/{summary.json,summary.md}`. Paths carry no ids or query
 * strings; synthetic data only. The test fails only on a broken measurement (a page that landed elsewhere, a missing
 * marker), never on a count.
 */
import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { ROOT } from "../support/app-env";
import { countKongCalls, type KongWindow } from "../support/kong-calls";
import { run } from "../support/m0-data";
import { storageStatePath, type E2eRole } from "../support/run-data";
import { seedBookedToday, todayName } from "../support/today-data";
import { filterToday, openToday, rowInLane, showLane } from "../support/today-page";

const OUT_DIR = path.join(ROOT, "test-results/perf-roundtrips");
const SAMPLES = 3;

interface PageRow {
  role: E2eRole;
  kind: "full load" | "in-app";
  label: string;
  landedOn: string;
  server: number[];
  browser: number[];
  responseEndMs: number[];
  loadMs: number[];
  serverByPath: Record<string, number>;
}

const rows: PageRow[] = [];
const actions: Array<{ role: E2eRole; label: string; server: number; browser: number; ms: number; serverByPath: Record<string, number> }> = [];

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

function pagesFor(role: E2eRole): Array<{ label: string; url: string }> {
  const { tenantA } = run();
  const pages = [
    { label: "/today", url: "/today" },
    { label: "/schedule (day)", url: "/schedule" },
    { label: "/schedule?view=week", url: "/schedule?view=week" },
    { label: "/patients", url: "/patients" },
    { label: "/patients/[id]", url: `/patients/${tenantA.patientId}` },
  ];
  if (role === "doctor") pages.push({ label: "/consultation/[id]", url: `/consultation/${tenantA.visitId}` });
  pages.push({ label: "/billing/register", url: "/billing/register" }, { label: "/settings/clinic", url: "/settings/clinic" });
  return pages;
}

async function navigationTiming(page: Page): Promise<{ responseEnd: number; loadEventEnd: number }> {
  return page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    return { responseEnd: Math.round(nav?.responseEnd ?? -1), loadEventEnd: Math.round(nav?.loadEventEnd ?? -1) };
  });
}

async function load(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: "load" });
  await page.waitForLoadState("networkidle");
}

/**
 * A client-side navigation (Next's `router.push`, as a link click does). Returns the ms from the push until the last RSC
 * response of the navigation ended (Resource Timing of the `_rsc` fetches: the server's work and the transfer), once the URL
 * is `url` and the network is idle; then waits a little longer so a late request is still inside the caller's count window.
 */
async function softNavigate(page: Page, url: string): Promise<number> {
  const target = new URL(url, page.url());
  const pushedAt = await page.evaluate((href) => {
    const at = performance.now();
    (window as unknown as { next: { router: { push(h: string): void } } }).next.router.push(href);
    return at;
  }, url);
  await page.waitForURL((u) => u.pathname === target.pathname && u.search === target.search);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(300);
  await page.waitForLoadState("networkidle");
  return page.evaluate((since) => {
    const ends = performance
      .getEntriesByType("resource")
      .filter((e) => e.startTime >= since && e.name.includes("_rsc="))
      .map((e) => (e as PerformanceResourceTiming).responseEnd);
    return ends.length ? Math.round(Math.max(...ends) - since) : -1;
  }, pushedAt);
}

function writeReport(): void {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const lines = [
    `| Role | Navigation | Page | Server calls (median of ${SAMPLES}) | Browser calls | responseEnd ms (full load) / ms push → last RSC byte (in-app) | load ms | Server calls by path (last sample) |`,
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows.map((r) => {
      const byPath = Object.entries(r.serverByPath)
        .sort((a, b) => b[1] - a[1])
        .map(([k, n]) => `${k} ×${n}`)
        .join("; ");
      const landed = r.landedOn === r.label.split(" ")[0] || r.label.includes("[id]") || r.label.includes("?") ? "" : ` → ${r.landedOn}`;
      const loadMs = r.kind === "full load" ? String(median(r.loadMs)) : "";
      return `| ${r.role} | ${r.kind} | ${r.label}${landed} | ${median(r.server)} | ${median(r.browser)} | ${median(r.responseEndMs)} | ${loadMs} | ${byPath} |`;
    }),
    "",
    "| Role | Server action | Server calls | Browser calls | ms (click → done) | Server calls by path |",
    "| --- | --- | --- | --- | --- | --- |",
    ...actions.map(
      (a) =>
        `| ${a.role} | ${a.label} | ${a.server} | ${a.browser} | ${a.ms} | ${Object.entries(a.serverByPath)
          .sort((x, y) => y[1] - x[1])
          .map(([k, n]) => `${k} ×${n}`)
          .join("; ")} |`,
    ),
  ];
  fs.writeFileSync(path.join(OUT_DIR, "summary.md"), `${lines.join("\n")}\n`);
  fs.writeFileSync(path.join(OUT_DIR, "summary.json"), `${JSON.stringify({ samples: SAMPLES, pages: rows, actions }, null, 2)}\n`);
  console.log(`\n${lines.join("\n")}\n`);
}

test.describe.configure({ mode: "serial" });

for (const role of ["receptionist", "doctor"] as const) {
  test.describe(`${role}: page round trips`, () => {
    test.use({ storageState: storageStatePath(role) });

    test(`${role}: Supabase calls per full page load`, async ({ page }) => {
      test.setTimeout(10 * 60_000);
      for (const { label, url } of pagesFor(role)) {
        await load(page, url); // warm-up
        const row: PageRow = { role, kind: "full load", label, landedOn: "", server: [], browser: [], responseEndMs: [], loadMs: [], serverByPath: {} };
        for (let i = 0; i < SAMPLES; i++) {
          const window: KongWindow = await countKongCalls(() => load(page, url));
          const timing = await navigationTiming(page);
          row.server.push(window.server);
          row.browser.push(window.browser);
          row.responseEndMs.push(timing.responseEnd);
          row.loadMs.push(timing.loadEventEnd);
          row.serverByPath = window.serverByPath;
        }
        row.landedOn = new URL(page.url()).pathname;
        // A signed-in page must not have bounced to sign-in (that would measure the login page).
        expect(row.landedOn, `${role} ${label}`).not.toBe("/login");
        rows.push(row);
      }
    });

    test(`${role}: Supabase calls per in-app navigation`, async ({ page }) => {
      test.setTimeout(10 * 60_000);
      for (const { label, url } of pagesFor(role)) {
        // A page this role is redirected away from (measured as a full load above) is not an in-app destination.
        const full = rows.find((r) => r.role === role && r.kind === "full load" && r.label === label);
        if (full && full.landedOn !== new URL(url, "http://x").pathname) continue;
        // From another page of the app (Today, or Patients for Today itself), as a click in the navigation does.
        const from = url === "/today" ? "/patients" : "/today";
        await load(page, from);
        await softNavigate(page, url); // warm-up
        const row: PageRow = { role, kind: "in-app", label, landedOn: "", server: [], browser: [], responseEndMs: [], loadMs: [], serverByPath: {} };
        for (let i = 0; i < SAMPLES; i++) {
          await load(page, from);
          let ms = 0;
          const window: KongWindow = await countKongCalls(async () => {
            ms = await softNavigate(page, url);
          });
          row.server.push(window.server);
          row.browser.push(window.browser);
          row.responseEndMs.push(ms);
          row.serverByPath = window.serverByPath;
        }
        row.landedOn = new URL(page.url()).pathname;
        expect(row.landedOn, `${role} ${label}`).not.toBe("/login");
        rows.push(row);
      }
    });
  });
}

test.describe("receptionist: server action round trips", () => {
  test.use({ storageState: storageStatePath("receptionist") });

  test("receptionist: Check in on Today", async ({ page }) => {
    test.setTimeout(3 * 60_000);
    const name = todayName("PerfCheckIn");
    await seedBookedToday(name);
    await openToday(page);
    await page.waitForLoadState("networkidle");
    await filterToday(page, name);
    await showLane(page, "Booked");
    const row = rowInLane(page, "booked", name);
    await expect(row).toBeVisible();
    const button = row.getByRole("button", { name: `Check in ${name}` });
    let ms = 0;
    const window = await countKongCalls(async () => {
      const started = Date.now();
      await button.click();
      await showLane(page, "Waiting");
      await expect(rowInLane(page, "waiting", name)).toBeVisible({ timeout: 20_000 });
      ms = Date.now() - started;
    });
    actions.push({ role: "receptionist", label: "Check in (Today)", server: window.server, browser: window.browser, ms, serverByPath: window.serverByPath });
  });
});

test.describe("owner: a sensitive server action's round trips (09D-01a, ruling R-S)", () => {
  test.use({ storageState: storageStatePath("owner") });

  test("owner: Save printing settings on /settings/clinic", async ({ page, context }) => {
    test.setTimeout(3 * 60_000);
    await page.goto("/settings/clinic");
    await page.waitForLoadState("networkidle");
    // The device's session-context cookie is in place (the shell's status check), so the fast path would answer from it.
    await expect.poll(async () => (await context.cookies()).some((c) => c.name === "clinic_ctx"), { timeout: 15_000 }).toBe(true);
    const card = page.locator("[data-rx-print-settings]");
    await expect(card).toBeVisible();
    let ms = 0;
    const window = await countKongCalls(async () => {
      const started = Date.now();
      await card.getByRole("button", { name: "Save printing settings" }).click();
      await expect(card.getByText(/Saved\. New prescriptions use this paper/)).toBeVisible({ timeout: 20_000 });
      ms = Date.now() - started;
    });
    actions.push({ role: "owner", label: "Save printing settings (sensitive)", server: window.server, browser: window.browser, ms, serverByPath: window.serverByPath });
  });
});

test.afterAll(() => writeReport());
