/**
 * 06-05 UI checks (CLAUDE.md DoD 3; plan "UI checks"): `/offline`, the offline banner on Today, and the user menu with
 * "Switch user", each at 360/820/1180/1280 px: no horizontal scroll, axe (wcag2a/2aa/21aa/22aa) 0 serious or critical
 * on what 06-05 adds (the whole `/offline` page; the banner region; the open menu), and a screenshot into
 * `design-captures/06-05/` (git-ignored). desktop-chrome only (it sets its own viewport). The axe results are attached
 * and also written next to the screenshots for the plan's evidence.
 */
import fs from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import type { Page, TestInfo } from "@playwright/test";
import { expect, test, waitForServiceWorker } from "./fixtures";
import { storageStatePath } from "../support/run-data";
import { ROOT } from "../support/app-env";
import { DESIGN_WIDTHS } from "../design/support/widths";

const TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const OUT = path.join(ROOT, "design-captures/06-05");

async function axeBlocking(page: Page, testInfo: TestInfo, label: string, include?: string) {
  let builder = new AxeBuilder({ page }).withTags(TAGS);
  if (include) builder = builder.include(include);
  const results = await builder.analyze();
  const report = { label, url: new URL(results.url).pathname, violations: results.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length })) };
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `axe-${label}.json`), `${JSON.stringify(report, null, 2)}\n`);
  await testInfo.attach(`axe-${label}.json`, { body: JSON.stringify(report, null, 2), contentType: "application/json" });
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target.join(" ")) }));
}

async function noHorizontalScroll(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
}

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "sets its own viewport; checked once");
});

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  for (const w of DESIGN_WIDTHS) {
    test(`/offline at ${w.width}px: no horizontal scroll, axe clean`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: w.width, height: w.height });
      await page.goto("/offline");
      await expect(page.getByRole("heading", { name: "You're offline" })).toBeVisible();
      expect(await noHorizontalScroll(page)).toBe(true);
      expect(await axeBlocking(page, testInfo, `offline-${w.width}`)).toEqual([]);
      await page.screenshot({ path: path.join(OUT, `offline-${w.width}.png`), fullPage: true });
    });
  }
});

test.describe("signed in", () => {
  test.use({ storageState: storageStatePath("nurse") });

  for (const w of DESIGN_WIDTHS) {
    test(`offline banner on Today at ${w.width}px: axe clean, adds no horizontal scroll`, async ({ page, context }, testInfo) => {
      await page.setViewportSize({ width: w.width, height: w.height });
      await page.goto("/");
      await waitForServiceWorker(page);
      const scrollBefore = await noHorizontalScroll(page);
      await context.setOffline(true);
      const banner = page.getByRole("status").filter({ hasText: "You're offline" });
      await expect(banner).toBeVisible();
      expect(await noHorizontalScroll(page)).toBe(scrollBefore);
      expect(await axeBlocking(page, testInfo, `banner-${w.width}`, "[data-offline-banner]")).toEqual([]);
      await page.screenshot({ path: path.join(OUT, `banner-${w.width}.png`) });
      await context.setOffline(false);
      await expect(banner).toHaveCount(0);
    });

    test(`user menu with Switch user at ${w.width}px: visible, axe clean`, async ({ page }, testInfo) => {
      // Read-only: the menu is opened, never used, so the shared nurse session is safe.
      await page.setViewportSize({ width: w.width, height: w.height });
      await page.goto("/");
      await page.getByRole("button", { name: /^Account menu/ }).click();
      for (const name of ["Switch user", "Sign out", "Sign out of all devices"]) {
        await expect(page.getByRole("menuitem", { name, exact: true })).toBeInViewport();
      }
      expect(await axeBlocking(page, testInfo, `user-menu-${w.width}`, '[role="menu"]')).toEqual([]);
      await page.screenshot({ path: path.join(OUT, `user-menu-${w.width}.png`) });
    });
  }
});
