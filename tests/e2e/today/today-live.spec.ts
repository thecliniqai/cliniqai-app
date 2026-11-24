/**
 * Today, live (V2-08 08-03a, P1-29, R-10; TEST_STRATEGY journey 5 part 1; PWA §3.2, §3.8).
 *
 * - check-in is exactly ONE user action (the `ux` count), the row moves to Waiting at once and the database has the
 *   waiting visit and its token;
 * - a check-in on one screen reaches another browser of the clinic through the private Realtime channel within 2 s;
 * - with the Realtime socket refused (`page.routeWebSocket`) the badge says Reconnecting and the board still updates, by the 12 s heartbeat of the live
 *   state (09E-04, R-18; it replaced the 20 s full-board poll);
 * - 09E-03 (R-14): the refresh is one `GET /api/today/board` into the board's query and no RSC request; the answer carries `Server-Timing`;
 *   09E-04: the signal carries its version, so the refresh needs no state read;
 * - the screen is never replaced when the connection drops (carried from the V2-07 merge): offline, or with the board read failing
 *   while the browser still says it is online, no navigation happens and the rows stay; once the server answers again the board catches up.
 * Synthetic data only; tenant A is shared, so every row is found by its own unique name. The 2 s case has its own clinic (see {@link ownClinic}).
 */
import type { Page } from "@playwright/test";
import { expect, test, routeLoopbackOnly } from "../fixtures";
import { E2E_BASE_URL } from "../support/app-env";
import { storageStatePath } from "../support/run-data";
import { ownClinic, seedBookedToday, seedWaitingToday, tokensOfVisit, todayName, visitStatusOf } from "../support/today-data";
import { countBoardRequests, countRscRequests, countStateRequests, openToday, rowInLane, rowOf, showLane } from "../support/today-page";
import { uiSignIn } from "../support/password-journeys";
import { seededUserPassword } from "../../helpers/tenants";

test.use({ storageState: storageStatePath("receptionist") });

const HEARTBEAT_MS = 12_000;
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
  const clinic = await ownClinic();
  const { visitId, name } = await clinic.seed();
  await page.context().clearCookies();
  await uiSignIn(page, { email: clinic.receptionist.email, password: seededUserPassword() });
  await openToday(page);
  await expect(liveStatus(page)).toHaveText("Live", { timeout: 20_000 });

  const blocked: string[] = [];
  const other = await browser.newContext({
    baseURL: E2E_BASE_URL,
    serviceWorkers: "block",
    viewport: { width: 1280, height: 900 },
  });
  await routeLoopbackOnly(other, blocked);
  try {
    const observer = await other.newPage();
    await uiSignIn(observer, { email: clinic.owner.email, password: seededUserPassword() });
    await openToday(observer);
    await expect(liveStatus(observer)).toHaveText("Live", { timeout: 20_000 });
    await expect(rowInLane(observer, "booked", name)).toBeVisible();

    await showLane(page, "Booked");
    // The observer's refresh is one board read into its query and no render request (09E-03).
    const rsc = countRscRequests(observer);
    const boardReads = countBoardRequests(observer);
    const stateReads = countStateRequests(observer);
    await rowOf(page, name).getByRole("button", { name: `Check in ${name}` }).click();
    await expect.poll(() => visitStatusOf(visitId), { timeout: 20_000 }).toBe("waiting");

    // The change is committed: the other screen shows it in Waiting within 2 s, with no reload of its own.
    await expect(rowInLane(observer, "waiting", name)).toBeVisible({ timeout: 2_000 });
    expect(boardReads.count(), "the signal's refresh is one board read").toBe(1);
    expect(boardReads.serverTimings()[0], "the data route reports its timing").toMatch(/db;dur=[\d.]+/);
    expect(rsc(), "no render (RSC) request for a refresh").toBe(0);
    expect(stateReads.count(), "the signal carries its version: no state read is needed").toBe(0);
    await expect(rowInLane(observer, "booked", name)).toHaveCount(0);
    await expect(observer.locator("[data-today-announcer]")).toContainText(`${name}, checked in`, { timeout: 7_000 });
  } finally {
    await other.close();
  }
  expect(blocked).toEqual([]);
});

test("Realtime refused: the badge says Reconnecting and the board still updates, by the 12 s heartbeat", async ({ page }) => {
  await page.clock.install();
  const { started } = await refuseRealtime(page);
  await openToday(page);
  await expect(page.locator("[data-today-board]").filter({ visible: true })).toBeVisible();
  await started;
  await expect(liveStatus(page)).toHaveAttribute("data-live-status", "reconnecting");

  const walkIn = await seedWaitingToday(todayName("Polled"));
  await showLane(page, "Waiting");
  await expect(rowOf(page, walkIn.name)).toHaveCount(0);

  // The channel never joins; a heartbeat tick reads the versions, sees the queue moved and re-reads the board once.
  await page.clock.runFor(HEARTBEAT_MS + 1_000);
  await expect(rowInLane(page, "waiting", walkIn.name)).toBeVisible({ timeout: 15_000 });
  await expect(liveStatus(page)).toContainText(/Reconnecting · Updated \d+ s ago/);
});

test.describe("the screen is never replaced when the connection drops", () => {
  test("offline: the heartbeat does not refresh, the rows stay, nothing navigates; back online the board catches up", async ({ page, context }) => {
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
    const boardReads = countBoardRequests(page);
    await context.setOffline(true);
    await expect(page.locator("[data-offline-banner] p")).toBeVisible();
    await page.clock.runFor(HEARTBEAT_MS * 2 + 1_000);

    expect(rsc(), "no render request was sent while offline").toBe(0);
    expect(boardReads.count(), "no board read was sent while offline").toBe(0);
    expect(navigations, "no navigation").toBe(0);
    await expect(page.getByRole("heading", { name: "You're offline" })).toHaveCount(0);
    await expect(rowOf(page, visit.name)).toBeVisible();
    expect(await rowsText(), "the rows on screen are the same").toEqual(before);

    // Back online (the `online` event asks at once, and the next heartbeat would) the board catches up with what changed meanwhile.
    const late = await seedWaitingToday(todayName("Late"));
    await context.setOffline(false);
    await page.clock.runFor(HEARTBEAT_MS + 1_000);
    await expect(rowInLane(page, "waiting", late.name)).toBeVisible({ timeout: 15_000 });
  });

  test("the board read failing while the browser says online: the rows stay, nothing navigates; the next confirmed beat catches up", async ({ page }) => {
    await page.clock.install();
    const { started } = await refuseRealtime(page);
    const visit = await seedWaitingToday(todayName("Probe"));
    await openToday(page);
    await started;
    await showLane(page, "Waiting");
    await expect(rowOf(page, visit.name)).toBeVisible();

    await page.route("**/api/today/board**", (route) => route.abort("connectionreset"));
    let navigations = 0;
    page.on("framenavigated", () => (navigations += 1));
    const rsc = countRscRequests(page);
    await page.clock.runFor(HEARTBEAT_MS * 2 + 1_000);
    expect(rsc(), "a failed board read never becomes a render request").toBe(0);
    expect(navigations).toBe(0);
    await expect(rowOf(page, visit.name)).toBeVisible();

    // The server answers again: the next confirmed beat re-reads (the control that the failure alone was stopping it).
    const late = await seedWaitingToday(todayName("Back"));
    await page.unroute("**/api/today/board**");
    await page.clock.runFor(HEARTBEAT_MS + 1_000);
    await expect(rowInLane(page, "waiting", late.name)).toBeVisible({ timeout: 15_000 });
    expect(rsc(), "the catch-up is a board read, not a render").toBe(0);
  });
});
