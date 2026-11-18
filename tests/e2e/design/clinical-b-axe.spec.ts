/**
 * Clinical entry section at the four design widths (V2-06 06-03b "UI checks": clinical-b section at 360/820/1180/1280;
 * axe; CLAUDE.md DoD 3; 06-UI-SPEC G3-4, G3-5, G3-12, G3-18). Signed in as the owner on `/dev/ui`. At each width:
 * - axe (the M0 tags) finds 0 serious/critical violations on the section, again with the medicine list open, and again
 *   with the dose builder open (after motion settles);
 * - the page has no horizontal scroll, and opening the list does not scroll the page;
 * - below 1024 px (touch, CD-03) every control in the section, every listbox option and every builder tile is at least
 *   44 × 44 px, and every text field draws 16 px text; on a fine pointer ≥ 24 × 24 (WCAG 2.5.8);
 * - the vitals fields bring up the numeric keypad (`inputmode` numeric or decimal) with an Enter-key hint.
 * Captures go to `design-captures/06-03b/` (git-ignored) with the axe summary per width.
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
const OUT = path.join(ROOT, "design-captures/06-03b");
const CONTROLS =
  "button:not([disabled]), a[href], [role=radio], [role=checkbox], [role=option], input:not([type=hidden]), select";

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
          // An input inside an adorned box ("mmHg", "+91") or the combobox's box: the box is the target.
          const r = (el.closest("[data-control-box], [data-rx-box], [data-picker-box]") ?? el).getBoundingClientRect();
          const name = el.getAttribute("aria-label") || (el.textContent ?? "").trim() || el.tagName;
          return { name, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 };
        })
        .filter((c) => c.w < m - 0.5 || c.h < m - 0.5)
        .map((c) => `${c.name} ${c.w}×${c.h}`),
    min,
  );
}

async function fields(scope: Locator) {
  return scope.locator("input:not([type=hidden]), select").evaluateAll((els) =>
    els
      .filter((el) => el.getBoundingClientRect().height > 0)
      .map((el) => ({
        name: el.getAttribute("aria-label") || el.id,
        fontSize: parseFloat(getComputedStyle(el).fontSize),
        inputMode: el.getAttribute("inputmode"),
        enterKeyHint: el.getAttribute("enterkeyhint"),
        vital: el.hasAttribute("data-vital"),
      })),
  );
}

for (const { width, height } of DESIGN_WIDTHS) {
  test(`clinical entry at ${width}px: axe clean (list and builder open too), no horizontal scroll, target sizes, keypads`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/dev/ui");
    await expect(page.getByRole("heading", { level: 1, name: "Component gallery" })).toBeVisible();
    const section = page.locator("[data-gallery-section=clinical-b]");
    await expect(section).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await settleAnimations(page);

    const touch = width < 1024;
    const scan = await blockingViolations(page, ["[data-gallery-section=clinical-b]"]);
    const scrolls = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    const small = await undersized(section, touch ? 44 : 24);
    const inputs = await fields(section);
    fs.mkdirSync(OUT, { recursive: true });
    await section.screenshot({ path: path.join(OUT, `gallery-clinical-b-${width}.png`) });

    // The medicine list open.
    const search = section.getByRole("combobox", { name: "Medicine" });
    await search.scrollIntoViewIfNeeded();
    const y = await page.evaluate(() => window.scrollY);
    await search.click();
    await page.keyboard.type("para");
    const list = section.getByRole("listbox", { name: "Medicines" });
    await expect(list).toBeVisible();
    await settleAnimations(page);
    const listOpen = await blockingViolations(page, ["[data-gallery-section=clinical-b]"]);
    const smallOptions = await undersized(list, touch ? 44 : 24);
    const yAfter = await page.evaluate(() => window.scrollY);
    await page.screenshot({ path: path.join(OUT, `rx-list-${width}.png`) });

    // The dose builder open.
    await page.keyboard.press("Enter");
    const builder = section.locator("[data-dose-builder]");
    await expect(builder).toBeVisible();
    await settleAnimations(page);
    const builderOpen = await blockingViolations(page, ["[data-gallery-section=clinical-b]"]);
    const smallBuilder = await undersized(builder, touch ? 44 : 24);
    const scrollsBuilder = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    await builder.screenshot({ path: path.join(OUT, `dose-builder-${width}.png`) });
    await page.keyboard.press("Escape");
    await expect(builder).toHaveCount(0);

    fs.writeFileSync(
      path.join(OUT, `axe-clinical-b-${width}.json`),
      JSON.stringify(
        {
          route: "/dev/ui",
          width,
          section: { seriousOrCritical: scan.blocking, violations: scan.all, passes: scan.passes },
          medicineListOpen: { seriousOrCritical: listOpen.blocking, violations: listOpen.all, passes: listOpen.passes },
          doseBuilderOpen: { seriousOrCritical: builderOpen.blocking, violations: builderOpen.all, passes: builderOpen.passes },
          horizontalScroll: scrolls || scrollsBuilder,
          pageScrolledByList: yAfter !== y,
          undersizedControls: [...small, ...smallOptions, ...smallBuilder],
          minTarget: touch ? 44 : 24,
          fields: inputs,
        },
        null,
        2,
      ),
    );

    expect(scan.blocking, `serious/critical axe violations at ${width}px`).toEqual([]);
    expect(listOpen.blocking, `serious/critical axe violations with the medicine list open at ${width}px`).toEqual([]);
    expect(builderOpen.blocking, `serious/critical axe violations with the dose builder open at ${width}px`).toEqual([]);
    expect(scrolls || scrollsBuilder, `horizontal scroll at ${width}px`).toBe(false);
    expect(yAfter, "opening the medicine list does not scroll the page").toBe(y);
    expect(small, `controls under ${touch ? 44 : 24}px at ${width}px`).toEqual([]);
    expect(smallOptions, `medicine options under ${touch ? 44 : 24}px at ${width}px`).toEqual([]);
    expect(smallBuilder, `dose builder controls under ${touch ? 44 : 24}px at ${width}px`).toEqual([]);
    if (touch) {
      expect(inputs.filter((f) => f.fontSize < 16).map((f) => `${f.name} ${f.fontSize}px`), `text under 16 px at ${width}px`).toEqual([]);
    }
    const vitals = inputs.filter((f) => f.vital);
    expect(vitals.length).toBe(9);
    for (const f of vitals) {
      expect(["numeric", "decimal"], `${f.name}: inputmode`).toContain(f.inputMode);
      expect(f.enterKeyHint, `${f.name}: enterkeyhint`).toBeTruthy();
    }
  });
}
