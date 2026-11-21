/**
 * The Schedule at the design widths (V2-08 08-04b; roadmap V2-08 acceptance "tablet layout at 744, 820, 1180").
 *
 * Runs in the design-* projects (`npm run e2e:design -- tests/e2e/design/screens/schedule.spec.ts`): at the width of the running
 * project (360, 820, 1180, 1280) it captures `/schedule` as the receptionist with a day of visits and checks the structure: the
 * agenda below 768 px (744 included), the doctor columns (day grid) from 768 px, no sideways scroll. The 744 px case (iPad mini portrait) is
 * captured in the same run from the 820 project by resizing the page, so the set is always complete. PNGs go to
 * `.planning/phases/08-front-desk/evidence/screens/schedule/<width>.png`. Synthetic data only.
 */
import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "../../fixtures";
import { ROOT } from "../../support/app-env";
import { freeBookingDate, istInstant, run, seedPatient, seedVisit, testTag } from "../../support/m0-data";
import { storageStatePath } from "../../support/run-data";
import { openSchedule } from "../../support/schedule-page";
import { settleAnimations } from "../../support/settle";

test.use({ storageState: storageStatePath("receptionist") });

const OUT = path.join(ROOT, ".planning/phases/08-front-desk/evidence/screens/schedule");

async function capture(page: Page, date: string, width: number, height: number): Promise<void> {
  await page.setViewportSize({ width, height });
  await openSchedule(page, date);
  await expect(page.locator("[data-appointment]:visible").first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await settleAnimations(page);
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `${width}.png`), animations: "disabled", caret: "hide" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), `${width}px scrolls sideways`).toBe(false);
}

test("the Schedule at the design width: captured, with the agenda on a phone and the doctor columns from 768 px", async ({ page }, testInfo) => {
  const { tenantA } = run();
  const doctorId = tenantA.users.doctor.id;
  const date = await freeBookingDate(tenantA.id, doctorId);
  for (const [i, time] of ["10:00", "10:30", "11:00", "17:15"].entries()) {
    const patient = await seedPatient(tenantA.id, tenantA.users.owner.id, `E2E Synthetic Capture ${i} ${testTag()}`);
    await seedVisit({
      tenantId: tenantA.id,
      patientId: patient.id,
      doctorId,
      createdBy: tenantA.users.owner.id,
      status: "booked",
      originType: "scheduled",
      scheduledAt: istInstant(date, time),
    });
  }
  const { width, height } = page.viewportSize()!;
  await capture(page, date, width, height);
  if (width >= 768) await expect(page.locator("[data-day-grid]")).toBeVisible();
  else await expect(page.locator("[data-agenda]")).toBeVisible();
  if (width === 820) {
    // iPad mini portrait (744 px): below the 768 px breakpoint, so the agenda, as on a phone.
    await capture(page, date, 744, 1133);
    await expect(page.locator("[data-agenda]")).toBeVisible();
  }
  testInfo.annotations.push({ type: "capture", description: `${width}` });
});
