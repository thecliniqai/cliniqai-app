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
import { test } from "../../fixtures";
import { ROOT } from "../../support/app-env";
import { istDate } from "../../support/m0-data";
import { storageStatePath } from "../../support/run-data";
import { BASELINE_ROUTES, FLOW_SCREENS, settle } from "./baseline-routes";

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

// --- Key screens of the characterisation flows (FLOW_SCREENS, shared with the V2-06 neutral capture) ----------------
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
