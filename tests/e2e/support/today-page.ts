/**
 * Page helpers for the Today board (V2-08 08-03a): rows are found by the synthetic patient's name, and on a phone or a
 * narrow tablet the lane switch picks the lane first (one lane at a time below 1280 px).
 */
import type { Locator, Page } from "@playwright/test";
import type { UxCounter } from "./ux-counter";

/**
 * Waits until React has hydrated the board: a click that lands on the server-rendered HTML before that is ignored (the lane
 * switch, a Check in button). React marks every DOM node it owns with a `__reactFiber$` key; nothing in the app is added for the test.
 */
export async function boardHydrated(page: Page): Promise<void> {
  await page.waitForFunction(() =>
    [...document.querySelectorAll<HTMLElement>("[data-today-board]")].some(
      (board) => board.offsetParent !== null && Object.keys(board).some((key) => key.startsWith("__reactFiber$")),
    ),
  );
}

/**
 * Opens `/today` (or `url`) and waits for the board to be on screen and hydrated. V2-09d: only the visible board counts. While
 * a streamed page is revealed, React briefly holds two copies of the board (the revealed one and the hidden `S:n` template it
 * came from); a strict locator that polls in that instant fails with "resolved to 2 elements".
 */
export async function openToday(page: Page, url = "/today"): Promise<void> {
  await page.goto(url);
  await page.locator("[data-today-board]").filter({ visible: true }).waitFor();
  await boardHydrated(page);
}

export type LaneName = "Booked" | "Waiting" | "Doctor" | "Bill" | "Done";

/**
 * Shows `lane` where the board has a lane switch (below 1280 px); on the side-by-side lanes (1280 px and up) every lane is
 * on screen except Done, which is a collapsed column until it is expanded.
 */
export async function showLane(page: Page, lane: LaneName): Promise<void> {
  const switcher = page.locator("[data-lane-switch]");
  if (await switcher.isVisible()) {
    await switcher.getByRole("radio", { name: new RegExp(`^${lane}`) }).click();
    return;
  }
  if (lane === "Done") {
    const expand = page.getByRole("button", { name: "Expand Done lane" });
    if (await expand.isVisible()) await expand.click();
  }
}

/** Types into the filter box ("Token, name or mobile"): every lane with a match is then on screen below 1280 px. */
export async function filterToday(page: Page, text: string): Promise<void> {
  await page.getByRole("searchbox", { name: "Token, name or mobile" }).fill(text);
}

/**
 * Opens the checkout drawer of the patient named `name` from Today: filter to the patient, make every lane visible (Done
 * is a collapsed column at 1280 px and up) and press the row's Collect or Bill button (R-1 of 08-03b: `rowActions` offers
 * `collect` on every completed visit; a visit with money due says "Collect ₹X", one without says "Bill").
 */
export async function openBill(page: Page, name: string, ux?: UxCounter): Promise<void> {
  if (ux) await ux.fill(page.getByRole("searchbox", { name: "Token, name or mobile" }), name, "Token, name or mobile");
  else await filterToday(page, name);
  await showLane(page, "Done");
  const button = rowOf(page, name).getByRole("button", { name: /^(Collect|Open bill of)\b/ });
  if (ux) await ux.click(button, "Collect / Bill");
  else await button.click();
}

/** The row of the patient named `name` (any lane that is on screen). */
export function rowOf(page: Page, name: string): Locator {
  return page.locator("[data-queue-row]").filter({ hasText: name });
}

/** The row of `name` inside the lane called `laneId` (`booked`, `waiting`, `with_doctor`, `to_bill`, `done`). */
export function rowInLane(page: Page, laneId: string, name: string): Locator {
  return page.locator(`[data-lane="${laneId}"] [data-queue-row]`).filter({ hasText: name });
}

/**
 * How many RSC render requests (a refresh or a navigation) the page sends from now on. V2-09d: Next's link prefetches
 * (`next-router-prefetch: 1`) are not counted. They are RSC requests too, but no refresh: the router sends them when the
 * navigation links are idle and in view, which on a fast server can fall inside a counting window (seen in the
 * connection-drop specs: the five nav links' prefetches under the fake clock).
 */
export function countRscRequests(page: Page): () => number {
  let n = 0;
  page.on("request", (request) => {
    const headers = request.headers();
    if (headers["rsc"] === "1" && headers["next-router-prefetch"] !== "1") n += 1;
  });
  return () => n;
}

/**
 * Counts the board reads of the client data layer (09E-03, R-14): `GET /api/today/board`. Returns the count so far and the
 * responses' `Server-Timing` headers (the data route's own timing, 09E-02).
 */
export function countBoardRequests(page: Page): { count: () => number; serverTimings: () => string[] } {
  let n = 0;
  const timings: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "GET" && new URL(request.url()).pathname === "/api/today/board") n += 1;
  });
  page.on("response", (response) => {
    if (new URL(response.url()).pathname === "/api/today/board") timings.push(response.headers()["server-timing"] ?? "");
  });
  return { count: () => n, serverTimings: () => timings };
}
