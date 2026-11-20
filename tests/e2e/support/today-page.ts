/**
 * Page helpers for the Today board (V2-08 08-03a): rows are found by the synthetic patient's name, and on a phone or a
 * narrow tablet the lane switch picks the lane first (one lane at a time below 1280 px).
 */
import type { Locator, Page } from "@playwright/test";

/**
 * Waits until React has hydrated the board: a click that lands on the server-rendered HTML before that is ignored (the lane
 * switch, a Check in button). React marks every DOM node it owns with a `__reactFiber$` key; nothing in the app is added for the test.
 */
export async function boardHydrated(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const board = document.querySelector("[data-today-board]");
    return Boolean(board && Object.keys(board).some((key) => key.startsWith("__reactFiber$")));
  });
}

/** Opens `/today` (or `url`) and waits for the board to be on screen and hydrated. */
export async function openToday(page: Page, url = "/today"): Promise<void> {
  await page.goto(url);
  await page.locator("[data-today-board]").waitFor();
  await boardHydrated(page);
}

export type LaneName = "Booked" | "Waiting" | "Doctor" | "Bill" | "Done";

/** Shows `lane` where the board has a lane switch (below 1280 px); a no-op on the side-by-side lanes. */
export async function showLane(page: Page, lane: LaneName): Promise<void> {
  const switcher = page.locator("[data-lane-switch]");
  if (!(await switcher.isVisible())) return;
  await switcher.getByRole("radio", { name: new RegExp(`^${lane}`) }).click();
}

/** The row of the patient named `name` (any lane that is on screen). */
export function rowOf(page: Page, name: string): Locator {
  return page.locator("[data-queue-row]").filter({ hasText: name });
}

/** The row of `name` inside the lane called `laneId` (`booked`, `waiting`, `with_doctor`, `to_bill`, `done`). */
export function rowInLane(page: Page, laneId: string, name: string): Locator {
  return page.locator(`[data-lane="${laneId}"] [data-queue-row]`).filter({ hasText: name });
}

/** How many RSC (server render) requests the page sends from now on. */
export function countRscRequests(page: Page): () => number {
  let n = 0;
  page.on("request", (request) => {
    if (request.headers()["rsc"] === "1") n += 1;
  });
  return () => n;
}
