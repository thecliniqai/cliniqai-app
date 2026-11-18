/**
 * Clinical identity and status section at the four design widths (V2-06 06-03a "UI checks": clinical-a section at
 * 360/820/1180/1280; axe; CLAUDE.md DoD 3; 06-UI-SPEC G3-7, G3-12, G3-16, G3-18). Signed in as the owner on `/dev/ui`.
 * At each width:
 * - axe (the M0 tags) finds 0 serious/critical violations on the section, and again with a queue row's ⋯ menu open
 *   (after its motion settles);
 * - the page has no horizontal scroll;
 * - below 1024 px (touch, CD-03) every control in the section is at least 44 × 44 px; on a fine pointer ≥ 24 × 24 (WCAG
 *   2.5.8). A queue row's name is measured by its row (the name's hit area is stretched over the row);
 * - adjacent row actions keep ≥ 8 px between them on touch.
 * Captures of the section go to `design-captures/06-03a/` (git-ignored) with the axe summary per width.
 *
 * PR lane, desktop-chrome only (an `*axe*` spec under design/ sets its own viewport; playwright.config.ts).
 */
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";
import path from "node:path";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { ROOT } from "../support/app-env";
import { storageStatePath } from "../support/run-data";
import { settleAnimations } from "../support/settle";
import { DESIGN_WIDTHS } from "./support/widths";

const TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const BLOCKING = new Set(["serious", "critical"]);
const OUT = path.join(ROOT, "design-captures/06-03a");
const CONTROLS = "button:not([disabled]), a[href], [role=radio], [role=checkbox], input:not([type=hidden]), select";

test.use({ storageState: storageStatePath("owner") });
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "sets its own viewport; runs once on desktop Chromium");
});

async function blockingViolations(page: Page, include: string[]) {
  let builder = new AxeBuilder({ page }).withTags(TAGS);
  for (const selector of include) builder = builder.include(selector);
  const results = await builder.analyze();
  return {
    blocking: results.violations
      .filter((v) => BLOCKING.has(v.impact ?? ""))
      .map((v) => ({ id: v.id, impact: v.impact, targets: v.nodes.map((n) => n.target.join(" ")) })),
    all: results.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length })),
    passes: results.passes.length,
  };
}

/** Every visible control under `scope` smaller than `min` × `min` (label, size). */
async function undersized(scope: Locator, min: number): Promise<string[]> {
  return scope.locator(CONTROLS).evaluateAll(
    (els, m) =>
      els
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden" && !el.closest("[aria-hidden=true], [inert]");
        })
        .map((el) => {
          const target = el.matches("[data-patient-name]") ? el.closest("[data-queue-row]") : null;
          const r = (target ?? el).getBoundingClientRect();
          const name = el.getAttribute("aria-label") || (el.textContent ?? "").trim() || el.tagName;
          return { name, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 };
        })
        .filter((c) => c.w < m - 0.5 || c.h < m - 0.5)
        .map((c) => `${c.name} ${c.w}×${c.h}`),
    min,
  );
}

/** Gaps (px) between neighbouring action buttons inside each queue row. */
async function actionGaps(scope: Locator): Promise<number[]> {
  return scope.locator("[data-row-actions]").evaluateAll((rows) =>
    rows.flatMap((row) => {
      const boxes = [...row.querySelectorAll("button")].map((b) => b.getBoundingClientRect()).sort((a, b) => a.left - b.left);
      return boxes.slice(1).map((b, i) => Math.round(b.left - boxes[i].right));
    }),
  );
}

for (const { width, height } of DESIGN_WIDTHS) {
  test(`clinical identity and status at ${width}px: axe clean, no horizontal scroll, target sizes`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/dev/ui");
    await expect(page.getByRole("heading", { level: 1, name: "Component gallery" })).toBeVisible();
    const section = page.locator("[data-gallery-section=clinical-a]");
    await expect(section).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await settleAnimations(page);

    const touch = width < 1024;
    const scan = await blockingViolations(page, ["[data-gallery-section=clinical-a]"]);
    const scrolls = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    const small = await undersized(section, touch ? 44 : 24);
    const gaps = await actionGaps(section);

    fs.mkdirSync(OUT, { recursive: true });
    await section.screenshot({ path: path.join(OUT, `gallery-clinical-a-${width}.png`) });

    // A row's ⋯ menu open.
    const more = section.getByRole("button", { name: "More actions for Synthetic Patient 01" });
    await more.click();
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await settleAnimations(page);
    const open = await blockingViolations(page, ["body"]);
    await page.screenshot({ path: path.join(OUT, `row-menu-${width}.png`) });
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);

    fs.writeFileSync(
      path.join(OUT, `axe-clinical-a-${width}.json`),
      JSON.stringify(
        {
          route: "/dev/ui",
          width,
          section: { seriousOrCritical: scan.blocking, violations: scan.all, passes: scan.passes },
          rowMenuOpen: { seriousOrCritical: open.blocking, violations: open.all, passes: open.passes },
          horizontalScroll: scrolls,
          undersizedControls: small,
          minTarget: touch ? 44 : 24,
          rowActionGaps: gaps,
        },
        null,
        2,
      ),
    );

    expect(scan.blocking, `serious/critical axe violations at ${width}px`).toEqual([]);
    expect(open.blocking, `serious/critical axe violations with a row menu open at ${width}px`).toEqual([]);
    expect(scrolls, `horizontal scroll at ${width}px`).toBe(false);
    expect(small, `controls under ${touch ? 44 : 24}px at ${width}px`).toEqual([]);
    expect(gaps.length).toBeGreaterThanOrEqual(5);
    if (touch) expect(gaps.filter((g) => g < 8), "≥ 8 px between row actions on touch").toEqual([]);
  });
}
