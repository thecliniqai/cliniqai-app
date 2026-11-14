/**
 * Keyboard and focus behaviour of the form primitives (V2-06 06-02a, R-14: real browser on `/dev/ui`, no jsdom).
 * Per primitive: Tab order, Enter/Space, roving focus with arrow keys (wrapping) in RadioGroup, SegmentedControl and
 * ChipGroup, Space toggling Checkbox/Switch with `aria-checked`, disabled controls skipped, and the approved focus ring
 * (outline ≥ 2 px in the `ring` token with a positive offset, on the white halo).
 *
 * PR lane, desktop-chrome only (keyboard specs under design/ run there; playwright.config.ts).
 */
import { expect, test } from "../../fixtures";
import { storageStatePath } from "../../support/run-data";
import { expectFocusRing } from "../support/focus";

test.use({ storageState: storageStatePath("owner") });
test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "keyboard specs run once, on desktop Chromium");
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/dev/ui");
  await expect(page.getByRole("heading", { level: 1, name: "Component gallery" })).toBeVisible();
});

/** Puts the sequential focus starting point on a group's heading (not focusable), so the next Tab enters the group. */
async function startAt(page: import("@playwright/test").Page, groupTitle: string) {
  await page.getByRole("heading", { level: 3, name: groupTitle, exact: true }).click();
}

test("Button: Tab reaches it, Enter and Space activate it, disabled and loading buttons are skipped, the ring shows", async ({ page }) => {
  const live = page.getByTestId("button-live");
  const count = page.getByTestId("button-count");
  await startAt(page, "Button · states");
  await page.keyboard.press("Tab");
  await expectFocusRing(live, "live button");

  await page.keyboard.press("Enter");
  await expect(count).toHaveText("Add to queue pressed 1 time");
  await page.keyboard.press("Space");
  await expect(count).toHaveText("Add to queue pressed 2 times");

  // The forced-state specimens are out of the tab order; disabled and loading buttons are skipped.
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("button-after")).toBeFocused();
  await expect(page.getByTestId("button-disabled")).toBeDisabled();
  await expect(page.getByTestId("button-loading")).toHaveAttribute("aria-busy", "true");
  await expect(page.getByTestId("button-loading")).toHaveAccessibleName("Add to queue");
});
