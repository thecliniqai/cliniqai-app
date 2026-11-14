/**
 * `/dev/ui` at the four design widths (V2-06 06-02a; roadmap V2-06 acceptance "axe shows 0 serious or critical issues
 * on the gallery"; CLAUDE.md DoD 3). Signed in as the owner. Each width: 0 serious/critical axe violations (wcag2a,
 * wcag2aa, wcag21aa, wcag22aa: the M0 tags) on the whole page, no horizontal scroll, and a full-page capture plus the
 * axe result in `design-captures/06-02a/` (git-ignored; the summary becomes the plan's evidence). Signed out, the
 * gallery is not served (the proxy's default deny sends the browser to /login).
 *
 * PR lane, desktop-chrome only (an `*axe*` spec under design/ sets its own viewport; playwright.config.ts).
 */
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";
import path from "node:path";
import { expect, test } from "../fixtures";
import { ROOT } from "../support/app-env";
import { storageStatePath } from "../support/run-data";
import { settleAnimations } from "../support/settle";
import { DESIGN_WIDTHS } from "./support/widths";

const TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const BLOCKING = new Set(["serious", "critical"]);
const OUT = path.join(ROOT, "design-captures/06-02a");

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "sets its own viewport; runs once on desktop Chromium");
});

test.describe("signed in", () => {
  test.use({ storageState: storageStatePath("owner") });

  for (const { width, height } of DESIGN_WIDTHS) {
    test(`/dev/ui at ${width}px: axe clean, no horizontal scroll`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      const response = await page.goto("/dev/ui");
      expect(response?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1, name: "Component gallery" })).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await settleAnimations(page);

      const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
      const blocking = results.violations
        .filter((v) => BLOCKING.has(v.impact ?? ""))
        .map((v) => ({ id: v.id, impact: v.impact, targets: v.nodes.map((n) => n.target.join(" ")) }));
      const scrolls = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      const sections = await page.locator("[data-gallery-section]").evaluateAll((els) =>
        els.map((el) => el.getAttribute("data-gallery-section")),
      );
      fs.mkdirSync(OUT, { recursive: true });
      await page.screenshot({ path: path.join(OUT, `gallery-${width}.png`), fullPage: true });
      fs.writeFileSync(
        path.join(OUT, `axe-gallery-${width}.json`),
        JSON.stringify(
          {
            route: "/dev/ui",
            width,
            sections,
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
});

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("/dev/ui is not served without a session", async ({ page }) => {
    await page.goto("/dev/ui");
    await expect(page).toHaveURL(/\/login(\?|$)/);
    await expect(page.getByRole("heading", { name: "Component gallery" })).toHaveCount(0);
  });
});
