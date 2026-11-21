/**
 * Today, live (V2-08 08-03a, P1-29, R-10; TEST_STRATEGY journey 5 part 1; PWA §3.2, §3.8).
 *
 * - check-in is exactly ONE user action (the `ux` count), the row moves to Waiting at once and the database has the
 *   waiting visit and its token;
 * - a check-in on one screen reaches another browser of the clinic through the private Realtime channel within 2 s;
 * - with the Realtime socket refused (`page.routeWebSocket`) the board still updates, by polling every 20 s;
 * - the screen is never replaced when the connection drops (carried from the V2-07 merge): offline, or with the server
 *   unreachable while the browser still says it is online, a refresh is not attempted, the rows stay and no navigation
 *   happens; once the server answers again the board catches up.
 * Synthetic data only; tenant A is shared, so every row is found by its own unique name.
 */
import type { Page } from "@playwright/test";
import { expect, test, routeLoopbackOnly } from "../fixtures";
import { E2E_BASE_URL } from "../support/app-env";
import { storageStatePath } from "../support/run-data";
import { seedBookedToday, seedWaitingToday, tokensOfVisit, todayName, visitStatusOf } from "../support/today-data";
import { countRscRequests, openToday, rowInLane, rowOf, showLane } from "../support/today-page";

test.use({ storageState: storageStatePath("receptionist") });

const POLL_MS = 20_000;
const liveStatus = (page: Page) => page.locator("[data-live-status]");

/**
 * Refuses the Realtime socket; resolves once the page has asked for it, i.e. once the board's live hook is running (its
 * timers exist). The fake clock may only be advanced after that: advanced earlier, the interval would start after the time
 * had already passed.
 */
async function refuseRealtime(page: Page): Promise<{ started: Promise<void> }> {
  let asked!: () => void;
  const started = new Promise<void>((resolve) => (asked = resolve));
  await page.routeWebSocket(/\/realtime\//, (ws) => {
    asked();
    void ws.close({ code: 1008, reason: "refused by the spec" });
  });
  return { started };
}

test("@golden check-in is one action: the row moves to Waiting at once; the database has the waiting visit and its token", async ({ page, ux }) => {
  ux.flow("today-check-in", "Receptionist checks a booked patient in from Today");
  const { visitId, name } = await seedBookedToday();
  await openToday(page);
  await showLane(page, "Booked");
  const row = rowOf(page, name);
  await expect(row).toBeVisible();
  await expect(row).toContainText(/\d{1,2}:\d{2}\s?(am|pm)/i);

  await ux.click(row.getByRole("button", { name: `Check in ${name}` }), "Check in");
  ux.done();

  await expect.poll(() => visitStatusOf(visitId), { timeout: 20_000 }).toBe("waiting");
  expect(await tokensOfVisit(visitId)).toHaveLength(1);
  expect(ux.counts()?.actions, "one user action").toBe(1);
  expect(ux.counts()?.keystrokes, "no typing").toBe(0);

  await showLane(page, "Waiting");
  const waiting = rowInLane(page, "waiting", name);
  await expect(waiting).toBeVisible();
  await expect(waiting.locator("[data-token-chip]")).toContainText(/\d+/);
  await expect(rowInLane(page, "booked", name)).toHaveCount(0);
});

test("@golden a check-in on one screen reaches another browser of the clinic within 2 s (private Realtime channel)", async ({ page, browser }) => {
  const { visitId, name } = await seedBookedToday();
  await openToday(page);
  await expect(liveStatus(page)).toHaveText("Live", { timeout: 20_000 });

  const blocked: string[] = [];
  const other = await browser.newContext({
    baseURL: E2E_BASE_URL,
    serviceWorkers: "block",
    storageState: storageStatePath("owner"),
    viewport: { width: 1280, height: 900 },
  });
  await routeLoopbackOnly(other, blocked);
  try {
    const observer = await other.newPage();
    await openToday(observer);
    await expect(liveStatus(observer)).toHaveText("Live", { timeout: 20_000 });
    await expect(rowInLane(observer, "booked", name)).toBeVisible();

    await showLane(page, "Booked");
    await rowOf(page, name).getByRole("button", { name: `Check in ${name}` }).click();
    await expect.poll(() => visitStatusOf(visitId), { timeout: 20_000 }).toBe("waiting");

    // The change is committed: the other screen shows it in Waiting within 2 s, with no reload of its own.
    await expect(rowInLane(observer, "waiting", name)).toBeVisible({ timeout: 2_000 });
    await expect(rowInLane(observer, "booked", name)).toHaveCount(0);
    await expect(observer.locator("[data-today-announcer]")).toContainText(`${name}, checked in`, { timeout: 7_000 });
  } finally {
    await other.close();
  }
  expect(blocked).toEqual([]);
});

test("Realtime refused: the board says so and still updates, by polling every 20 s", async ({ page }) => {
  await page.clock.install();
  const { started } = await refuseRealtime(page);
  await openToday(page);
  await expect(page.locator("[data-today-board]")).toBeVisible();
  await started;

  const walkIn = await seedWaitingToday(todayName("Polled"));
  await showLane(page, "Waiting");
  await expect(rowOf(page, walkIn.name)).toHaveCount(0);

  // The channel never joins: after its 10 s join timeout the board reports polling, and a poll tick brings the new row.
  await page.clock.runFor(POLL_MS + 1_000);
  await expect(liveStatus(page)).toHaveText("Updating every 20 s", { timeout: 10_000 });
  await expect(rowInLane(page, "waiting", walkIn.name)).toBeVisible({ timeout: 15_000 });
});

test.describe("the screen is never replaced when the connection drops", () => {
  test("offline: the poll does not refresh, the rows stay, nothing navigates; back online the board catches up", async ({ page, context }) => {
    await page.clock.install();
    const { started } = await refuseRealtime(page);
    const visit = await seedWaitingToday(todayName("Offline"));
    await openToday(page);
    await started;
    await showLane(page, "Waiting");
    await expect(rowOf(page, visit.name)).toBeVisible();
    const rowsText = () => page.locator("[data-queue-row]:visible").evaluateAll((els) => els.map((el) => (el as HTMLElement).innerText.split("\n").filter((l) => !l.startsWith("You're offline")).join("|")));
    const before = await rowsText();

    let navigations = 0;
    page.on("framenavigated", () => (navigations += 1));
    const rsc = countRscRequests(page);
    await context.setOffline(true);
    await expect(page.locator("[data-offline-banner] p")).toBeVisible();
    await page.clock.runFor(POLL_MS * 2 + 1_000);

    expect(rsc(), "no render request was sent while offline").toBe(0);
    expect(navigations, "no navigation").toBe(0);
    await expect(page.getByRole("heading", { name: "You're offline" })).toHaveCount(0);
    await expect(rowOf(page, visit.name)).toBeVisible();
    expect(await rowsText(), "the rows on screen are the same").toEqual(before);

    // Back online the next poll catches up with what changed meanwhile.
    const late = await seedWaitingToday(todayName("Late"));
    await context.setOffline(false);
    await page.clock.runFor(POLL_MS + 1_000);
    await expect(rowInLane(page, "waiting", late.name)).toBeVisible({ timeout: 15_000 });
  });

  test("the server unreachable while the browser says online: the poll's probe fails, no refresh is attempted, the rows stay", async ({ page }) => {
    await page.clock.install();
    const { started } = await refuseRealtime(page);
    const visit = await seedWaitingToday(todayName("Probe"));
    await openToday(page);
    await started;
    await showLane(page, "Waiting");
    await expect(rowOf(page, visit.name)).toBeVisible();

    await page.route("**/api/health", (route) => route.abort("connectionreset"));
    let navigations = 0;
    page.on("framenavigated", () => (navigations += 1));
    const rsc = countRscRequests(page);
    await page.clock.runFor(POLL_MS * 2 + 1_000);
    expect(rsc(), "the failed probe stopped the refresh").toBe(0);
    expect(navigations).toBe(0);
    await expect(rowOf(page, visit.name)).toBeVisible();

    // The server answers again: the next tick refreshes (the control that the guard is the only thing stopping it).
    const late = await seedWaitingToday(todayName("Back"));
    await page.unroute("**/api/health");
    await page.clock.runFor(POLL_MS + 1_000);
    await expect(rowInLane(page, "waiting", late.name)).toBeVisible({ timeout: 15_000 });
    expect(rsc()).toBeGreaterThan(0);
  });
});
