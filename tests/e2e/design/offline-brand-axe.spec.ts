/**
 * V2-06 06-01b UI checks (CLAUDE.md DoD 3; plan "UI checks"): the branded `/offline` page at the four design widths
 * (360/820/1180/1280), signed out. Each: 0 serious or critical axe violations (wcag2a, wcag2aa, wcag21aa, wcag22aa: the
 * M0 tags) on the whole page, no horizontal scroll, the brand mark drawn at 56 px (full geometry, decorative next to the
 * visible name "CliniQ AI"), and a full-page screenshot plus the axe result written to `design-captures/06-01b/`
 * (git-ignored; the summary JSON becomes the plan's evidence).
 *
 * PR lane, desktop-chrome only (an `*axe*` spec under design/ sets its own viewport; playwright.config.ts).
 */
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";
import path from "node:path";
import { expect, test } from "../fixtures";
import { ROOT } from "../support/app-env";
import { DESIGN_WIDTHS } from "./support/widths";

const TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const BLOCKING = new Set(["serious", "critical"]);
const OUT = path.join(ROOT, "design-captures/06-01b");

test.use({ storageState: { cookies: [], origins: [] } });
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "sets its own viewport; runs once on desktop Chromium");
});

for (const { width, height } of DESIGN_WIDTHS) {
  test(`/offline with the brand mark at ${width}px: axe clean, no horizontal scroll`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/offline");
    await page.evaluate(() => document.fonts.ready);

    const mark = page.locator('svg[data-mark="full"]');
    await expect(mark).toHaveCount(1);
    await expect(mark).toHaveAttribute("aria-hidden", "true");
    expect(await mark.boundingBox()).toMatchObject({ width: 56, height: 56 });
    await expect(page.getByText("CliniQ AI", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "You're offline" })).toBeVisible();
    await expect(page).toHaveTitle("Offline · CliniQ AI");

    const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    const blocking = results.violations
      .filter((v) => BLOCKING.has(v.impact ?? ""))
      .map((v) => ({ id: v.id, impact: v.impact, targets: v.nodes.map((n) => n.target.join(" ")) }));
    const scrolls = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    fs.mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: path.join(OUT, `offline-${width}.png`), fullPage: true });
    fs.writeFileSync(
      path.join(OUT, `axe-offline-${width}.json`),
      JSON.stringify(
        {
          route: "/offline",
          width,
          horizontalScroll: scrolls,
          seriousOrCritical: blocking,
          violations: results.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length })),
          passes: results.passes.length,
        },
        null,
        2,
      ),
    );
    expect(blocking, `serious/critical axe violations at ${width}px`).toEqual([]);
    expect(scrolls, `horizontal scroll at ${width}px`).toBe(false);
  });
}
