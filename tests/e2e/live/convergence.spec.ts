/**
 * Live convergence (V2-09e 09E-04, R-18; B-11, B-12, B-13; "silent staleness" is High).
 *
 * Two screens of one clinic (a receptionist and the owner, signed in through the login UI) on a clinic of the test's own:
 * - delivered: B checks in; A shows it within 2 s with one board read and no state read (the signal carries its version);
 * - dropped: the broadcast frames to A are dropped by `page.routeWebSocket` while the channel stays joined (the badge says Live); the page clock is
 *   installed before load; A is unchanged until its clock passes 12 s, then shows the row after one state read and one board read;
 * - refused socket: the badge says "Reconnecting" and, once a beat has confirmed, "Updated N s ago"; the heartbeat keeps A current; when the socket
 *   is allowed again the badge returns to Live and one check runs;
 * - hidden tab: no state call while the clock advances 60 s; one at once when the tab is visible again;
 * (The badge's states are axe clean at 360, 820 and 1280 px: `tests/e2e/a11y/live-badge.spec.ts`.)
 * Synthetic data only. 0 retries: a case that only passes on retry is a defect.
 */
import type { Page } from "@playwright/test";
import { expect, test, routeLoopbackOnly } from "../fixtures";
import { E2E_BASE_URL } from "../support/app-env";
import { uiSignIn } from "../support/password-journeys";
import { ownClinic, visitStatusOf } from "../support/today-data";
import { countBoardRequests, countStateRequests, dropBroadcastFrames, openToday, rowInLane, rowOf, showLane } from "../support/today-page";
import { seededUserPassword } from "../../helpers/tenants";

test.use({ storageState: { cookies: [], origins: [] } });

const HEARTBEAT_MS = 12_000;
const badge = (page: Page) => page.locator("[data-live-status]");

interface Pair {
  a: Page;
  b: Page;
  name: string;
  visitId: string;
  /** B checks the visit in (one click on its Check in button). */
  checkInOnB: () => Promise<void>;
  close: () => Promise<void>;
  blocked: string[];
}

/** A is the page of the test (the receptionist); B is the owner in a second context. `prepareA` runs before A loads (the clock, the socket rules). */
async function pair(page: Page, browser: import("@playwright/test").Browser, prepareA: (a: Page) => Promise<void> = async () => undefined): Promise<Pair> {
  const clinic = await ownClinic();
  const { visitId, name } = await clinic.seed();
  const blocked: string[] = [];
  const other = await browser.newContext({ baseURL: E2E_BASE_URL, serviceWorkers: "block", viewport: { width: 1280, height: 900 } });
  await routeLoopbackOnly(other, blocked);
  const b = await other.newPage();
  await uiSignIn(b, { email: clinic.owner.email, password: seededUserPassword() });
  await openToday(b);
  await expect(badge(b)).toHaveAttribute("data-live-status", "live", { timeout: 20_000 });
  await showLane(b, "Booked");

  await prepareA(page);
  await uiSignIn(page, { email: clinic.receptionist.email, password: seededUserPassword() });
  await openToday(page);
  return {
    a: page,
    b,
    name,
    visitId,
    checkInOnB: async () => {
      await expect(rowOf(b, name).getByRole("button", { name: `Check in ${name}` })).toBeVisible();
      await rowOf(b, name).getByRole("button", { name: `Check in ${name}` }).click();
      await expect.poll(() => visitStatusOf(visitId), { timeout: 20_000 }).toBe("waiting");
    },
    close: () => other.close(),
    blocked,
  };
}

test("@golden delivered: B checks in and A shows it within 2 s with one board read (B-11)", async ({ page, browser }) => {
  const p = await pair(page, browser);
  try {
    await expect(badge(p.a)).toHaveAttribute("data-live-status", "live", { timeout: 20_000 });
    await showLane(p.a, "Booked");
    await expect(rowInLane(p.a, "booked", p.name)).toBeVisible();
    // A phone shows one lane at a time: A watches Waiting, where the row will arrive.
    await showLane(p.a, "Waiting");
    // Everything A does from here is counted: the signal's board read, and any state read (there must be none).
    const boardReads = countBoardRequests(p.a);
    const stateReads = countStateRequests(p.a);
    await p.checkInOnB();
    await expect(rowInLane(p.a, "waiting", p.name)).toBeVisible({ timeout: 2_000 });
    expect(boardReads.count(), "one board read").toBe(1);
    expect(stateReads.count(), "no state read: the signal carries the version").toBe(0);
  } finally {
    await p.close();
  }
  expect(p.blocked).toEqual([]);
});

test("@golden dropped: the broadcast never reaches A (the channel stays joined); A converges when its clock passes 12 s, after one state read and one board read (B-12)", async ({ page, browser }) => {
  let drops!: Awaited<ReturnType<typeof dropBroadcastFrames>>;
  const p = await pair(page, browser, async (a) => {
    await a.clock.install();
    drops = await dropBroadcastFrames(a);
  });
  try {
    // The channel is joined and a check has confirmed the versions: the badge says Live although every signal will be dropped.
    await expect(badge(p.a)).toHaveAttribute("data-live-status", "live", { timeout: 20_000 });
    await showLane(p.a, "Booked");
    await expect(rowInLane(p.a, "booked", p.name)).toBeVisible();
    const boardReads = countBoardRequests(p.a);
    const stateReads = countStateRequests(p.a);

    await p.checkInOnB();
    // The signal was sent and dropped; give it time to prove it did not arrive, with the clock stopped.
    await expect.poll(() => drops.dropped(), { timeout: 10_000 }).toBeGreaterThan(0);
    await p.a.waitForTimeout(500);
    await showLane(p.a, "Booked");
    await expect(rowInLane(p.a, "booked", p.name)).toBeVisible();
    expect(boardReads.count(), "nothing was read: the signal never arrived").toBe(0);
    expect(stateReads.count()).toBe(0);

    // A's clock passes 12 s: the heartbeat reads the versions, sees them move, and re-reads the board once.
    await p.a.clock.runFor(HEARTBEAT_MS + 1_000);
    await showLane(p.a, "Waiting");
    await expect(rowInLane(p.a, "waiting", p.name)).toBeVisible({ timeout: 10_000 });
    expect(stateReads.count(), "one state read").toBe(1);
    expect(boardReads.count(), "one board read").toBe(1);
  } finally {
    await p.close();
  }
  expect(p.blocked).toEqual([]);
});

test("refused socket: Reconnecting with the age, the heartbeat keeps A current, and on reconnect the badge returns to Live after one check", async ({ page, browser }) => {
  let allow = false;
  const p = await pair(page, browser, async (a) => {
    await a.clock.install();
    await a.routeWebSocket(/\/realtime\//, (ws) => {
      if (!allow) {
        void ws.close({ code: 1008, reason: "refused by the spec" });
        return;
      }
      const server = ws.connectToServer();
      ws.onMessage((m) => server.send(m));
      server.onMessage((m) => ws.send(m));
    });
  });
  try {
    await expect(badge(p.a)).toHaveAttribute("data-live-status", "reconnecting");
    await expect(badge(p.a)).toHaveText("Reconnecting");
    const stateReads = countStateRequests(p.a);

    // One beat confirms the versions: the badge now says how old the confirmation is.
    await p.a.clock.runFor(HEARTBEAT_MS + 500);
    await expect(badge(p.a)).toContainText(/Reconnecting · Updated \d+ s ago/);

    // B checks in; the refused socket delivers nothing, the next beat does.
    await showLane(p.a, "Booked");
    await expect(rowInLane(p.a, "booked", p.name)).toBeVisible();
    await p.checkInOnB();
    await p.a.clock.runFor(HEARTBEAT_MS + 1_000);
    await showLane(p.a, "Waiting");
    await expect(rowInLane(p.a, "waiting", p.name)).toBeVisible({ timeout: 10_000 });

    // The socket is allowed again: the next rejoin joins, runs one check and the badge says Live.
    allow = true;
    const before = stateReads.count();
    await p.a.clock.runFor(40_000);
    await expect(badge(p.a)).toHaveAttribute("data-live-status", "live", { timeout: 20_000 });
    expect(stateReads.count() - before, "the beats and one check on the rejoin").toBeGreaterThanOrEqual(1);
  } finally {
    await p.close();
  }
  expect(p.blocked).toEqual([]);
});

test("hidden tab: no state call while the clock advances 60 s; one at once when the tab is visible again (B-13)", async ({ page }) => {
  await page.clock.install();
  await uiSignIn(page, { email: (await ownClinic()).owner.email, password: seededUserPassword() });
  await openToday(page);
  await expect(badge(page)).toHaveAttribute("data-live-status", "live", { timeout: 20_000 });
  const stateReads = countStateRequests(page);
  const setVisibility = (state: "hidden" | "visible") =>
    page.evaluate((value) => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => value });
      document.dispatchEvent(new Event("visibilitychange"));
    }, state);

  await setVisibility("hidden");
  await page.clock.runFor(60_000);
  expect(stateReads.count(), "no state call while hidden").toBe(0);

  await setVisibility("visible");
  await expect.poll(() => stateReads.count(), { timeout: 10_000 }).toBe(1);
});
