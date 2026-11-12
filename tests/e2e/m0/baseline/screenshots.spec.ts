/**
 * M0 baseline screenshots (V2-02 plan 02-03b; FRONTEND_MIGRATION_PLAN M0 "screenshots at 360/768/1280").
 *
 * Runs only in the baseline lane (`npm run e2e:baseline`, projects vp-360 / vp-768 / vp-1280). Captures every
 * dashboard route and the auth pages, plus the key screen of each characterisation flow (walk-in drawer, booking
 * drawer, Sign & Bill modal, checkout drawer), as full-page JPEG (quality 70) under
 * `test-results/m0/screenshots/<project>/`, which `scripts/m0-baseline-report.mjs` copies into the report. The page
 * clock is frozen at 10:00 IST on the run's day so times of day are stable. Synthetic run data only. Opening a drawer
 * or modal changes nothing (no submit).
 */
import fs from "node:fs";
import path from "node:path";
import type { Page, TestInfo } from "@playwright/test";
import { expect, test } from "../../fixtures";
import { ROOT } from "../../support/app-env";
import { istDate } from "../../support/m0-data";
import { readRunData, storageStatePath, type E2eRole } from "../../support/run-data";
import { BASELINE_ROUTES, settle } from "./baseline-routes";

const SHOTS_DIR = path.join(ROOT, "test-results/m0/screenshots");

async function freezeClock(page: Page): Promise<void> {
  await page.clock.setFixedTime(new Date(`${istDate(0)}T10:00:00+05:30`));
}

async function shoot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const dir = path.join(SHOTS_DIR, testInfo.project.name);
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({
    path: path.join(dir, `${name}.jpg`),
    type: "jpeg",
    quality: 70,
    fullPage: true,
    animations: "disabled",
    caret: "hide",
  });
}

const SIGNED_OUT = { cookies: [], origins: [] };

for (const route of BASELINE_ROUTES) {
  test.describe(`${route.pattern}`, () => {
    test.use({ storageState: route.role ? storageStatePath(route.role) : SIGNED_OUT });

    test(`screenshot ${route.pattern}`, async ({ page }, testInfo) => {
      await freezeClock(page);
      await page.goto(route.url());
      await settle(page);
      await shoot(page, testInfo, `route-${route.slug}`);
    });
  });
}

// --- Key screens of the characterisation flows ---------------------------------------------------------------------
const FLOW_SCREENS: Array<{ name: string; role: E2eRole; open: (page: Page) => Promise<void> }> = [
  {
    name: "flow-walk-in-drawer",
    role: "receptionist",
    open: async (page) => {
      await page.goto("/queue");
      await page.getByRole("button", { name: "+ Add Walk-In" }).click();
      await expect(page.getByRole("heading", { name: "Quick Walk-In Registration" })).toBeVisible();
    },
  },
  {
    name: "flow-booking-drawer",
    role: "receptionist",
    open: async (page) => {
      await page.goto("/calendar");
      await page.getByRole("button", { name: "+ Book Appointment" }).click();
      await expect(page.getByRole("dialog", { name: "Schedule Appointment" })).toBeVisible();
    },
  },
  {
    name: "flow-sign-and-bill-modal",
    role: "doctor",
    open: async (page) => {
      await page.goto(`/consultation/${readRunData().tenantA.visitId}`);
      await page.getByRole("button", { name: /Complete & Sign/ }).first().click();
      await expect(page.getByRole("dialog", { name: "Complete & Sign Consultation" })).toBeVisible();
    },
  },
  {
    name: "flow-checkout-drawer",
    role: "receptionist",
    open: async (page) => {
      await page.goto("/queue");
      await page
        .getByRole("heading", { name: readRunData().tenantA.patientName, exact: true })
        .locator("xpath=ancestor::div[contains(@class,'rounded-2xl')][1]")
        .getByRole("button", { name: /Checkout/ })
        .click();
      await expect(page.getByRole("heading", { name: "Patient Checkout & Billing" })).toBeVisible();
    },
  },
];

for (const screen of FLOW_SCREENS) {
  test.describe(screen.name, () => {
    test.use({ storageState: storageStatePath(screen.role) });

    test(`screenshot ${screen.name}`, async ({ page }, testInfo) => {
      await freezeClock(page);
      await screen.open(page);
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
      await shoot(page, testInfo, screen.name);
    });
  });
}
