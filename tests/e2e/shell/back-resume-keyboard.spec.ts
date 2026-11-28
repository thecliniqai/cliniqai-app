/**
 * In-app Back, keyboard-aware BottomBar and refresh on resume (V2-06 06-04b; PWA_STRATEGY §3.2, §3.3; 06-UI-SPEC §6).
 *
 * - Back is shown on a non-root screen below 1280 px and goes back through the in-app history; a deep link with no
 *   history goes to the nav parent instead of leaving the app; at 1280 it is hidden except in focus mode (the consult).
 * - At 360 px, focusing a text field hides the BottomBar; leaving it shows the bar again.
 * - A `visibilitychange` to visible on Today (a live view) triggers exactly one board read (`GET /api/today/board`, V2-09e 09E-03) and no RSC
 *   request; on Patients (a live view not on the client data layer) none of either.
 *
 * desktop-chrome (fine pointer) and pixel-7 (touch): both set their own viewport.
 */
import type { Page, Request } from "@playwright/test";
import { expect, test } from "../fixtures";
import { readRunData, storageStatePath } from "../support/run-data";
import { psql } from "../../helpers/sql";

test.use({ storageState: storageStatePath("owner") });

const back = (page: Page) => page.getByRole("button", { name: "Back", exact: true });
const bottomBar = (page: Page) => page.locator("[data-shell-nav=bottom-bar]");

test.beforeEach(({}, testInfo) => {
  test.skip(!["desktop-chrome", "pixel-7"].includes(testInfo.project.name), "desktop and touch only");
});

for (const width of [360, 820]) {
  test(`at ${width}px Back appears on a patient opened from Patients and returns there`, async ({ page }) => {
    const { tenantA } = readRunData();
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/patients");
    await expect(page.getByRole("main")).toBeVisible();
    await expect(back(page)).toHaveCount(0);
    await page.locator(`a[href="/patients/${tenantA.patientId}"]`).first().click();
    await page.waitForURL((url) => url.pathname === `/patients/${tenantA.patientId}`);
    await expect(back(page)).toBeVisible();
    await back(page).click();
    await page.waitForURL((url) => url.pathname === "/patients");
    await expect(back(page)).toHaveCount(0);
  });
}

test("a deep link with no in-app history: Back goes to the nav parent (never out of the app)", async ({ page }) => {
  const { tenantA } = readRunData();
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto(`/patients/${tenantA.patientId}`);
  await expect(back(page)).toBeVisible();
  await back(page).click();
  await page.waitForURL((url) => url.pathname === "/patients");
});

test("at 1280 px Back is hidden on a patient record and shown in focus mode (the consult)", async ({ page }) => {
  const { tenantA } = readRunData();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/patients/${tenantA.patientId}`);
  await expect(page.getByRole("main")).toBeVisible();
  await expect(back(page)).toHaveCount(0);
  await page.goto(`/consultation/${tenantA.visitId}`);
  await expect(back(page)).toBeVisible();
  // Focus mode: the Rail, not the Sidebar, at 1280.
  await expect(page.locator("[data-shell-nav=rail]")).toBeVisible();
  await expect(page.locator("[data-shell-nav=sidebar]")).toBeHidden();
});

test("at 360 px a focused text field hides the BottomBar; leaving it brings the bar back", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto("/patients");
  await expect(bottomBar(page)).toBeVisible();
  const search = page.getByRole("main").locator("input[type=text], input[type=search], input:not([type])").first();
  await search.focus();
  await expect(bottomBar(page)).toBeHidden();
  await page.getByRole("main").locator("h1").first().click();
  await expect(bottomBar(page)).toBeVisible();
});

/** RSC requests for `pathname` that are not prefetches (a `router.refresh()`). */
function countRefreshes(page: Page, pathname: string): () => number {
  let n = 0;
  page.on("request", (r: Request) => {
    const h = r.headers();
    if (new URL(r.url()).pathname === pathname && h["rsc"] === "1" && h["next-router-prefetch"] === undefined) n++;
  });
  return () => n;
}

/** Board reads of the client data layer (`GET /api/today/board`). */
function countBoardReads(page: Page): () => number {
  let n = 0;
  page.on("request", (r: Request) => {
    if (r.method() === "GET" && new URL(r.url()).pathname === "/api/today/board") n++;
  });
  return () => n;
}

async function resume(page: Page): Promise<void> {
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
}

/** `GET /api/live/state` calls (09E-04): what a resume on Today asks. */
function countStateReads(page: Page): () => number {
  let n = 0;
  page.on("request", (r: Request) => {
    if (r.method() === "GET" && new URL(r.url()).pathname === "/api/live/state") n++;
  });
  return () => n;
}

test("visibilitychange on Today asks for the live state (one call, no board read, no RSC refresh) and reads the board only when a version moved; on Patients nothing", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const today = countRefreshes(page, "/today");
  const board = countBoardReads(page);
  const state = countStateReads(page);
  await page.goto("/today");
  await expect(page.getByRole("main")).toBeVisible();
  await page.waitForLoadState("networkidle");
  // 09E-14a (flake F2): the page's own check on subscription is over only when the channel says so (the badge reads "Live" after the check that closes the gap
  // answered): a fixed 2.5 s wait let that check, which on a loaded stack arrives late, fall inside the counted window.
  await expect(page.locator("[data-live-status]")).toHaveText("Live", { timeout: 20_000 });
  await page.waitForTimeout(500);
  const loadBoard = board();
  const loadState = state();
  expect(today()).toBe(0);
  // The first state read is held for 1.2 s so that it is certainly in flight while the second resume (and any heartbeat) comes: a check made while one is out is
  // answered by it, so nothing else can be asked in that time, however slow or fast the stack is.
  await page.route("**/api/live/state", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    await route.continue();
  });
  await resume(page);
  await expect.poll(() => state() - loadState, { timeout: 5_000 }).toBe(1);
  await resume(page); // while the first read is out: no second request
  await page.waitForTimeout(600);
  expect(state() - loadState, "one state read for two resumes while the first is in flight").toBe(1);
  await page.waitForTimeout(800);
  await page.unroute("**/api/live/state");
  expect(board() - loadBoard, "nothing moved: the board is not read").toBe(0);
  expect(today(), "a resume on Today is never a render (RSC) request").toBe(0);

  // A version moves while the tab sleeps (its signal is no matter: the check also learns it): the next resume reads the board once.
  await page.waitForTimeout(1_500);
  psql(`update public.visits set estimated_duration_minutes = case when estimated_duration_minutes = 20 then 25 else 20 end where id = '${readRunData().tenantA.visitId}'`);
  await resume(page);
  await expect.poll(() => board() - loadBoard, { timeout: 5_000 }).toBe(1);
  await page.waitForTimeout(1_000);
  expect(board() - loadBoard, "one board read for one change, however it was learned").toBe(1);

  const patients = countRefreshes(page, "/patients");
  await page.goto("/patients");
  await expect(page.getByRole("main")).toBeVisible();
  await page.waitForLoadState("networkidle");
  await resume(page);
  await page.waitForTimeout(1_000);
  expect(patients()).toBe(0);
});
