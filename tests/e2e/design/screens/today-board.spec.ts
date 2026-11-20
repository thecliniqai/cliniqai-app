/**
 * The Today board against the V2-DX prototype (V2-08 08-03a; roadmap V2-08 acceptance "tablet layout matches the prototype
 * at 744, 820, 1180"; the reference captures are `v2-dx-evidence/screens/today/`).
 *
 * Runs in the design-* projects (`npm run e2e:design -- tests/e2e/design/screens/today-board.spec.ts`): at the width of the
 * running project (360, 820, 1180, 1280) it captures `/today` as the receptionist with every lane filled and checks the
 * structure the prototype fixes (the list pane is 38 to 46 percent of the board at 820 and 1180; one lane at a time on a
 * phone; four lanes and the collapsed Done column at 1280). The 744 px case (iPad mini portrait) is captured in the same
 * run from the 820 project by resizing the page, so the set is always complete. PNGs go to
 * `.planning/phases/08-front-desk/evidence/screens/today/<width>.png`; the isolated reviewer judges them against the
 * prototype. Synthetic data only.
 */
import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "../../fixtures";
import { ROOT } from "../../support/app-env";
import { storageStatePath } from "../../support/run-data";
import { settleAnimations } from "../../support/settle";
import { seedFullDay } from "../../support/today-data";
import { openToday } from "../../support/today-page";

test.use({ storageState: storageStatePath("receptionist") });

const OUT = path.join(ROOT, ".planning/phases/08-front-desk/evidence/screens/today");

async function capture(page: Page, width: number, height: number): Promise<void> {
  await page.setViewportSize({ width, height });
  await openToday(page);
  await expect(page.locator("[data-queue-row]:visible").first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await settleAnimations(page);
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `${width}.png`), animations: "disabled", caret: "hide" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), `${width}px scrolls sideways`).toBe(false);
}

test("Today at the design width: captured, with the prototype's structure", async ({ page }, testInfo) => {
  await seedFullDay();
  const { width, height } = page.viewportSize()!;
  await capture(page, width, height);
  if (width >= 1280) {
    for (const id of ["booked", "waiting", "with_doctor", "to_bill"]) await expect(page.locator(`[data-lane="${id}"]`)).toBeVisible();
    await expect(page.locator('[data-lane="done"]')).toHaveAttribute("data-collapsed", "true");
  } else if (width >= 768) {
    const board = (await page.locator("[data-board]").boundingBox())!;
    const list = (await page.locator("[data-board] > div").first().boundingBox())!;
    expect((list.width / board.width) * 100).toBeGreaterThanOrEqual(38);
    expect((list.width / board.width) * 100).toBeLessThanOrEqual(46);
  } else {
    await expect(page.locator("[data-lane-switch]")).toBeVisible();
  }
  if (width === 820) {
    // iPad mini portrait: one lane at a time, as on a phone (the two panes start at 768).
    await capture(page, 744, 1133);
    await expect(page.locator("[data-lane-switch]")).toBeVisible();
    await expect(page.locator("[data-detail-pane]")).toBeHidden();
  }
  testInfo.annotations.push({ type: "capture", description: `${width}` });
});
