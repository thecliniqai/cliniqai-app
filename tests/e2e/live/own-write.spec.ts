/**
 * Own writes (V2-09e 09E PR 2, PO option A; migration 000134): a command's answer carries the clinic versions its own transaction produced, and the device that
 * saved hands them to the live core with the board it wrote the answer into.
 * - own signal: the receptionist checks a visit in; the signals of that commit reach the page (counted on the socket) and the board is NOT read again
 *   (the lane row `save.R.check-in` measures the same: one call, `check_in_visit`);
 * - interleaved (two devices): the owner checks Y in on a second browser while A's channel drops every broadcast and A's state checks fail (so nothing
 *   but the own-write rule can make A read); A then checks X in. A's answer carries a version two past A's board, so the write between (the owner's) is
 *   not in A's data: A reads the board and shows Y in Waiting. A rule that took the own version as the board's basis would swallow the owner's change.
 * Synthetic data only, a clinic of the test's own. 0 retries: a case that only passes on retry is a defect.
 */
import type { Page } from "@playwright/test";
import { expect, test, routeLoopbackOnly } from "../fixtures";
import { E2E_BASE_URL } from "../support/app-env";
import { uiSignIn } from "../support/password-journeys";
import { ownClinic, visitStatusOf } from "../support/today-data";
import { countBoardRequests, dropBroadcastFrames, openToday, rowInLane, rowOf, showLane } from "../support/today-page";
import { seededUserPassword } from "../../helpers/tenants";

test.use({ storageState: { cookies: [], origins: [] } });

const badge = (page: Page) => page.locator("[data-live-status]");

/** Passes every Realtime frame through and counts the broadcasts that reach the page (the same frame test as `dropBroadcastFrames`). */
async function countBroadcastFrames(page: Page): Promise<{ count: () => number }> {
  let n = 0;
  await page.routeWebSocket(/\/realtime\//, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((message) => server.send(message));
    server.onMessage((message) => {
      let isBroadcast = false;
      if (typeof message !== "string") isBroadcast = message.length > 0 && message[0] === 4;
      else {
        try {
          const frame = JSON.parse(message) as unknown;
          isBroadcast = (Array.isArray(frame) ? frame[3] : (frame as { event?: unknown }).event) === "broadcast";
        } catch {
          isBroadcast = false;
        }
      }
      if (isBroadcast) n += 1;
      ws.send(message);
    });
  });
  return { count: () => n };
}

async function checkIn(page: Page, name: string, visitId: string): Promise<void> {
  await showLane(page, "Booked");
  await rowOf(page, name).getByRole("button", { name: `Check in ${name}` }).click();
  await expect.poll(() => visitStatusOf(visitId), { timeout: 20_000 }).toBe("waiting");
}

test("own signal: a check-in's own signals reach the page and the board is not read again", async ({ page }) => {
  test.setTimeout(60_000);
  const clinic = await ownClinic();
  const x = await clinic.seed();
  const frames = await countBroadcastFrames(page);
  await uiSignIn(page, { email: clinic.receptionist.email, password: seededUserPassword() });
  await openToday(page);
  await expect(badge(page)).toHaveAttribute("data-live-status", "live", { timeout: 20_000 });
  await showLane(page, "Booked");
  await expect(rowInLane(page, "booked", x.name)).toBeVisible();
  await page.waitForLoadState("networkidle");

  const boardReads = countBoardRequests(page);
  const before = frames.count();
  await checkIn(page, x.name, x.visitId);
  // A check-in moves two domains (queue, schedule): both signals arrive on this page's channel.
  await expect.poll(() => frames.count() - before, { timeout: 15_000, message: "the check-in's own signals reached the page" }).toBeGreaterThanOrEqual(2);
  // Longer than the core's coalescing (400 ms) and a board read: a re-read would have been sent by now.
  await page.waitForTimeout(1_500);
  await showLane(page, "Waiting");
  await expect(rowInLane(page, "waiting", x.name)).toBeVisible();
  expect(boardReads.count(), "the own signal re-reads nothing: the answer is already on the board").toBe(0);
});

test("interleaved: another device's write that came between is not swallowed by the own write; A reads and shows it", async ({ page, browser }) => {
  // Two UI sign-ins and two Realtime joins (about 6 s each on emulated WebKit) before anything is measured.
  test.setTimeout(90_000);
  const clinic = await ownClinic();
  const x = await clinic.seed();
  const y = await clinic.seed();
  const blocked: string[] = [];
  const other = await browser.newContext({ baseURL: E2E_BASE_URL, serviceWorkers: "block", viewport: { width: 1280, height: 900 } });
  await routeLoopbackOnly(other, blocked);
  try {
    const b = await other.newPage();
    await uiSignIn(b, { email: clinic.owner.email, password: seededUserPassword() });
    await openToday(b);
    await showLane(b, "Booked");
    await expect(rowInLane(b, "booked", y.name)).toBeVisible();

    // A: every broadcast is dropped (the channel stays joined); once its board is on screen its state checks fail too. Nothing but its own answer can make it read.
    const drops = await dropBroadcastFrames(page);
    await uiSignIn(page, { email: clinic.receptionist.email, password: seededUserPassword() });
    await openToday(page);
    await expect(badge(page)).toHaveAttribute("data-live-status", "live", { timeout: 20_000 });
    await showLane(page, "Booked");
    await expect(rowInLane(page, "booked", x.name)).toBeVisible();
    await expect(rowInLane(page, "booked", y.name)).toBeVisible();
    await page.waitForLoadState("networkidle");
    let refusedChecks = 0;
    await page.route("**/api/live/state", (route) => {
      refusedChecks += 1;
      return route.abort("connectionreset");
    });

    // The owner checks Y in: its signals never reach A.
    const dropsBefore = drops.dropped();
    await checkIn(b, y.name, y.visitId);
    await expect.poll(() => drops.dropped() - dropsBefore, { timeout: 15_000, message: "the owner's signals were sent and dropped" }).toBeGreaterThan(0);
    await page.waitForTimeout(600);
    await expect(rowInLane(page, "booked", y.name), "A has not heard of the owner's check-in").toBeVisible();

    // A checks X in. Its answer's queue version is two past A's board: the owner's write is not on A's board, so A reads it.
    const boardReads = countBoardRequests(page);
    await checkIn(page, x.name, x.visitId);
    await showLane(page, "Waiting");
    await expect(rowInLane(page, "waiting", y.name), "the owner's change arrives on A").toBeVisible({ timeout: 5_000 });
    await expect(rowInLane(page, "waiting", x.name)).toBeVisible();
    expect(boardReads.count(), "A read its board (the own write did not count for the write between)").toBeGreaterThanOrEqual(1);
    // Every signal to A was dropped and every state check A made (if a heartbeat fell in the window) was refused: the read came from the own answer.
    test.info().annotations.push({ type: "refused-state-checks", description: String(refusedChecks) });
  } finally {
    await other.close();
  }
  expect(blocked).toEqual([]);
});
