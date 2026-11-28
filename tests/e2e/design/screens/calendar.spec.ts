/**
 * The calendar views at the design widths (V2-09f 09F, AC-6): the week view (the time grid from 768 px, the overview list below) and the month view,
 * captured as the receptionist with a week of visits, and checked for sideways scroll. Runs in the design-* projects
 * (`npm run e2e:design -- tests/e2e/design/screens/calendar.spec.ts`); the 820 project also captures 744 px (iPad mini portrait, below 768 px). PNGs go
 * to `.planning/phases/09F-calendar-views/evidence/screens/{week,month,move}-<width>.png`. Synthetic data only.
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

const OUT = path.join(ROOT, ".planning/phases/09F-calendar-views/evidence/screens");

async function shot(page: Page, name: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await settleAnimations(page);
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `${name}.png`), animations: "disabled", caret: "hide" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), `${name} scrolls sideways`).toBe(false);
}

async function captureAt(page: Page, date: string, doctorId: string, width: number, height: number): Promise<void> {
  await page.setViewportSize({ width, height });
  await openSchedule(page, date, `view=week&doctor=${doctorId}`);
  if (width >= 768) {
    await expect(page.locator("[data-week-grid] [data-appointment]").first()).toBeVisible();
  } else {
    await expect(page.locator("[data-week-overview]")).toBeVisible();
  }
  await shot(page, `week-${width}`);
  if (width >= 768) {
    await page.locator("[data-week-grid] [data-appointment-block]").first().click();
    await page.getByRole("button", { name: "Pick a new time on the grid" }).click();
    await expect(page.locator("[data-move-mode]")).toBeVisible();
    await shot(page, `move-${width}`);
  }
  await openSchedule(page, date, `view=month&doctor=${doctorId}`);
  await expect(page.locator("[data-month-view]")).toBeVisible();
  await shot(page, `month-${width}`);
}

test("the calendar views at the design width: week (grid or list) and month, captured, no sideways scroll", async ({ page }, testInfo) => {
  const { tenantA } = run();
  const doctorId = tenantA.users.doctor.id;
  const date = await freeBookingDate(tenantA.id, doctorId);
  for (const [i, time] of ["10:00", "10:30", "11:00", "17:15"].entries()) {
    const patient = await seedPatient(tenantA.id, tenantA.users.owner.id, `E2E Synthetic Calendar ${i} ${testTag()}`);
    await seedVisit({ tenantId: tenantA.id, patientId: patient.id, doctorId, createdBy: tenantA.users.owner.id, status: "booked", originType: "scheduled", scheduledAt: istInstant(date, time) });
  }
  const { width, height } = page.viewportSize()!;
  await captureAt(page, date, doctorId, width, height);
  if (width === 820) await captureAt(page, date, doctorId, 744, 1133);
  testInfo.annotations.push({ type: "capture", description: `${width}` });
});
