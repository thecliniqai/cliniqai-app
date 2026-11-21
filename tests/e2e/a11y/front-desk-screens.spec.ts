/**
 * Today at every width (V2-08 08-03a; 06-UI-SPEC §7 and §8; DESIGN_SYSTEM; CLAUDE.md DoD 3; PWA-03b).
 *
 * As the receptionist, with a day that has every lane filled (booked, waiting, with the doctor, to bill, done):
 *   - axe: no serious or critical violation on `/today` at 360, 820 and 1280 (wcag2a/aa, 2.1 aa, 2.2 aa);
 *   - no horizontal scroll at 360, 375, 744, 800, 820, 1180 and 1280;
 *   - the bottom bar is there below 768 px only; below 768 one lane is on screen and the lane switch has counts; from 768 to
 *     1279 two panes (the list pane is 38 to 46 percent of the board at 820 and 1180, the selected visit on the right); at
 *     1280 four lanes and the collapsed Done column side by side;
 *   - the detail of a visit opens in a drawer on a phone and in the pane on a tablet, with `?visit=` in the URL.
 * Runs on desktop-chrome only (a11y specs own their viewport). Synthetic data only.
 */
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { storageStatePath } from "../support/run-data";
import { settleAnimations } from "../support/settle";
import { seedFullDay } from "../support/today-data";
import { openToday, rowOf, showLane } from "../support/today-page";

test.use({ storageState: storageStatePath("receptionist") });

const TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const BLOCKING = new Set(["serious", "critical"]);
const SCROLL_WIDTHS = [360, 375, 744, 800, 820, 1180, 1280];

let names: Awaited<ReturnType<typeof seedFullDay>>;

test.beforeAll(async () => {
  names = await seedFullDay();
});

async function open(page: Page, width: number, height = 900): Promise<void> {
  await page.setViewportSize({ width, height });
  await openToday(page);
  await expect(page.locator("[data-queue-row]:visible").first()).toBeVisible();
  await settleAnimations(page);
}

const horizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);

for (const width of [360, 820, 1280]) {
  test(`axe at ${width}: /today has no serious or critical violation`, async ({ page }) => {
    await open(page, width);
    const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    const blocking = results.violations.filter((v) => BLOCKING.has(v.impact ?? ""));
    expect(blocking.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target.join(" ")) }))).toEqual([]);
  });
}

test("no horizontal scroll at 360, 375, 744, 800, 820, 1180 and 1280", async ({ page }) => {
  for (const width of SCROLL_WIDTHS) {
    await open(page, width);
    expect(await horizontalScroll(page), `${width}px`).toBe(false);
  }
});

test("the bottom bar is there below 768 px only", async ({ page }) => {
  for (const [width, shown] of [
    [360, true],
    [744, true],
    [767, true],
    [768, false],
    [1280, false],
  ] as const) {
    await open(page, width);
    const fixedAtBottom = await page.evaluate(() => {
      const nav = [...document.querySelectorAll("nav[aria-label]")].find((n) => getComputedStyle(n).position === "fixed" && getComputedStyle(n).display !== "none");
      return Boolean(nav && nav.getBoundingClientRect().bottom >= window.innerHeight - 1);
    });
    expect(fixedAtBottom, `${width}px bottom bar on screen`).toBe(shown);
  }
});

test("below 768 px: one lane at a time with a counted lane switch; at 744 as at 360", async ({ page }) => {
  for (const width of [360, 744]) {
    await open(page, width);
    const switcher = page.locator("[data-lane-switch]");
    await expect(switcher, `${width}px`).toBeVisible();
    for (const lane of ["Booked", "Waiting", "Doctor", "Bill", "Done"]) {
      await expect(switcher.getByRole("radio", { name: new RegExp(`^${lane}`) })).toContainText(/\d+/);
    }
    const lanes = page.locator("[data-lane]");
    let visible = 0;
    for (const lane of await lanes.all()) if (await lane.isVisible()) visible += 1;
    expect(visible, `${width}px shows one lane`).toBe(1);
    await expect(page.locator("[data-detail-pane]"), `${width}px has no detail pane`).toBeHidden();
  }
});

test("a phone opens the visit in a drawer (?visit= in the URL); closing it removes the parameter", async ({ page }) => {
  await open(page, 360);
  await showLane(page, "Booked");
  await rowOf(page, names.booked).getByRole("button", { name: names.booked, exact: true }).click();
  const drawer = page.getByRole("dialog", { name: names.booked });
  await expect(drawer).toBeVisible();
  await expect(page).toHaveURL(/[?&]visit=[0-9a-f-]{36}/);
  await expect(drawer.locator("[data-visit-detail]")).toContainText("Open patient record");
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(page).not.toHaveURL(/visit=/);
});

for (const width of [820, 1180]) {
  test(`${width}: two panes, the list pane is 38 to 46 percent of the board, the detail pane shows the selected visit`, async ({ page }) => {
    await open(page, width, width === 820 ? 1180 : 820);
    await showLane(page, "Waiting");
    const board = await page.locator("[data-board]").boundingBox();
    const list = await page.locator("[data-board] > div").first().boundingBox();
    const share = (list!.width / board!.width) * 100;
    expect(share, `list pane share at ${width}px`).toBeGreaterThanOrEqual(38);
    expect(share).toBeLessThanOrEqual(46);
    await expect(page.locator("[data-lane-switch]")).toBeVisible();
    const pane = page.locator("[data-detail-pane]");
    await expect(pane).toBeVisible();
    await expect(pane.locator("[data-visit-detail]")).toHaveCount(1);
    // Selecting another row swaps the detail without a dialog.
    await rowOf(page, names.waiting).getByRole("button", { name: names.waiting, exact: true }).click();
    await expect(pane.locator("[data-visit-detail]")).toContainText(names.waiting);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page).toHaveURL(/visit=/);
    // The lists scroll on their own: the page itself does not grow past the viewport.
    const pageFits = await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 2);
    expect(pageFits, "the board fits the viewport (panes scroll inside)").toBe(true);
  });
}

test("1280: Booked, Waiting, With doctor and To bill side by side and Done collapsed; the toggle opens Done", async ({ page }) => {
  await open(page, 1280, 800);
  await expect(page.locator("[data-lane-switch]")).toBeHidden();
  for (const id of ["booked", "waiting", "with_doctor", "to_bill"]) await expect(page.locator(`[data-lane="${id}"]`)).toBeVisible();
  const done = page.locator('[data-lane="done"]');
  await expect(done).toHaveAttribute("data-collapsed", "true");
  expect((await done.boundingBox())!.width).toBeLessThanOrEqual(48);
  await expect(done.locator("[data-queue-row]").first()).toBeHidden();
  const waiting = await page.locator('[data-lane="waiting"]').boundingBox();
  const booked = await page.locator('[data-lane="booked"]').boundingBox();
  expect(waiting!.y).toBe(booked!.y);
  await done.getByRole("button", { name: "Expand Done lane" }).click();
  await expect(done).not.toHaveAttribute("data-collapsed", "true");
  await expect(done.locator("[data-queue-row]").first()).toBeVisible();
  // A row tap opens the visit in the side sheet.
  await rowOf(page, names.toBill).getByRole("button", { name: names.toBill, exact: true }).click();
  await expect(page.getByRole("dialog", { name: names.toBill })).toBeVisible();
  await expect(page.getByRole("dialog").locator("[data-visit-detail]")).toContainText(/₹500 due/);
});

test("filtering stacks every lane with a match; no match offers to register", async ({ page }) => {
  await open(page, 360);
  const box = page.getByRole("searchbox", { name: "Token, name or mobile" });
  await box.fill(names.toBill);
  await expect(rowOf(page, names.toBill)).toBeVisible();
  await expect(page.locator("[data-lane-switch]")).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: "1 match" })).toBeVisible();
  await box.fill("zzzz nobody");
  await expect(page.getByRole("link", { name: "Register as new patient" })).toHaveAttribute("href", /\/today\?new=1&name=zzzz/);
});
