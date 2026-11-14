/**
 * Data and date sections at the four design widths (V2-06 06-02c "UI checks": DataList at 360/820, DataTable at
 * 1180/1280; axe; CLAUDE.md DoD 3; 06-UI-SPEC G3 checks). Signed in as the owner on `/dev/ui`. At 360, 820, 1180 and
 * 1280 px:
 * - axe (the M0 tags) finds 0 serious/critical violations on the data and dates sections, and again with the Calendar
 *   popover open (after its motion settles);
 * - the page has no horizontal scroll; the open calendar fits the viewport;
 * - the table is shown from 1024 px and the two-line list below it (one of them, never both);
 * - below 1024 px (touch) every text field and select in the two sections renders its text at ≥ 16 px (no iOS focus
 *   zoom, PWA-07), and the numeric fields (date, age, mobile) bring up the numeric keypad with an Enter-key hint;
 * - below 1024 px (touch, CD-03) every control in the two sections and every calendar day is at least 44 × 44 px; on a
 *   fine pointer ≥ 1024 px at least 24 × 24 (WCAG 2.5.8). Inline text links are exempt (WCAG 2.5.8 "inline"); a
 *   checkbox inside its label row and an input inside an adorned box are measured by the row / box (the target).
 * Captures of both sections and of the open calendar go to `design-captures/06-02c/` (git-ignored) with the axe
 * summary per width.
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
const OUT = path.join(ROOT, "design-captures/06-02c");
const CONTROLS = "button:not([disabled]), [role=radio], [role=checkbox], input:not([type=hidden]), select";

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

/** Every visible control under `scope` that is smaller than `min` × `min` (label, size). */
async function undersized(scope: Locator, min: number): Promise<string[]> {
  return scope.locator(CONTROLS).evaluateAll(
    (els, m) =>
      els
        .filter((el) => {
          const r = el.getBoundingClientRect();
          const s = getComputedStyle(el);
          return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && !el.closest("[aria-hidden=true], [inert]");
        })
        .map((el) => {
          // A checkbox or radio inside its label row, or an input inside an adorned box ("+91"): the row or the box is
          // the target (06-02a: a press anywhere on it focuses the control).
          const r = (el.closest("label, [data-control-box]") ?? el).getBoundingClientRect();
          const name = el.getAttribute("aria-label") || (el.textContent ?? "").trim() || el.tagName;
          return { name, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 };
        })
        .filter((c) => c.w < m - 0.5 || c.h < m - 0.5)
        .map((c) => `${c.name} ${c.w}×${c.h}`),
    min,
  );
}

for (const { width, height } of DESIGN_WIDTHS) {
  test(`data and date sections at ${width}px: axe clean, the right data form, target sizes, calendar popover`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/dev/ui");
    await expect(page.getByRole("heading", { level: 1, name: "Component gallery" })).toBeVisible();
    const data = page.locator("[data-gallery-section=data]");
    const dates = page.locator("[data-gallery-section=dates]");
    // The date specimens render after hydration (they depend on the clinic's today).
    await expect(dates.locator("[data-date-field]").first()).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await settleAnimations(page);

    const touch = width < 1024;
    const table = page.getByRole("table", { name: "Patients" });
    const list = page.getByRole("list", { name: "Patients" });
    if (touch) {
      await expect(list).toBeVisible();
      await expect(table).toBeHidden();
    } else {
      await expect(table).toBeVisible();
      await expect(list).toBeHidden();
    }

    const sections = await blockingViolations(page, ["[data-gallery-section=data]", "[data-gallery-section=dates]"]);
    const scrolls = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    const small = [...(await undersized(data, touch ? 44 : 24)), ...(await undersized(dates, touch ? 44 : 24))];
    const fields = await page
      .locator("[data-gallery-section=data], [data-gallery-section=dates]")
      .locator("input:not([type=hidden]), select")
      .evaluateAll((els) =>
        els
          .filter((el) => el.getBoundingClientRect().height > 0)
          .map((el) => ({
            name: el.getAttribute("aria-label") || el.id,
            fontSize: parseFloat(getComputedStyle(el).fontSize),
            inputMode: el.getAttribute("inputmode"),
            enterKeyHint: el.getAttribute("enterkeyhint"),
            numericLike: el.matches("[data-date-field] input, [data-age-or-dob] input, [data-control-box] input"),
          })),
      );

    fs.mkdirSync(OUT, { recursive: true });
    await data.screenshot({ path: path.join(OUT, `gallery-data-${width}.png`) });
    await dates.screenshot({ path: path.join(OUT, `gallery-dates-${width}.png`) });

    // The calendar popover, opened from "Choose date" on the unbounded field.
    const field = dates.locator("[data-date-field]").filter({ has: page.getByRole("textbox", { name: "Next review" }) });
    await field.getByRole("button", { name: "Choose date" }).click();
    const popover = page.getByRole("dialog", { name: "Choose date" });
    await expect(popover).toBeVisible();
    await expect(popover.getByRole("grid")).toBeVisible();
    await settleAnimations(page);
    const open = await blockingViolations(page, ["body"]);
    const box = await popover.boundingBox();
    const dayButtons = popover.locator("[data-day] button");
    const daySizes = await dayButtons.evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).map((r) => [r.width, r.height]));
    const smallestDay = Math.min(...daySizes.map(([w, h]) => Math.min(w, h)));
    const smallInPopover = await undersized(popover, touch ? 44 : 24);
    await page.screenshot({ path: path.join(OUT, `calendar-${width}.png`) });
    const scrollsOpen = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    await page.keyboard.press("Escape");
    await expect(popover).toHaveCount(0);

    fs.writeFileSync(
      path.join(OUT, `axe-data-dates-${width}.json`),
      JSON.stringify(
        {
          route: "/dev/ui",
          width,
          form: touch ? "DataList" : "DataTable",
          sections: { seriousOrCritical: sections.blocking, violations: sections.all, passes: sections.passes },
          calendarOpen: { seriousOrCritical: open.blocking, violations: open.all, passes: open.passes },
          horizontalScroll: scrolls || scrollsOpen,
          undersizedControls: [...small, ...smallInPopover],
          minTarget: touch ? 44 : 24,
          smallestCalendarDay: smallestDay,
          popover: box && { x: box.x, y: box.y, width: box.width, height: box.height },
        },
        null,
        2,
      ),
    );

    expect(sections.blocking, `serious/critical axe violations at ${width}px`).toEqual([]);
    expect(open.blocking, `serious/critical axe violations with the calendar open at ${width}px`).toEqual([]);
    expect(scrolls, `horizontal scroll at ${width}px`).toBe(false);
    expect(scrollsOpen, `horizontal scroll with the calendar open at ${width}px`).toBe(false);
    expect(small, `controls under ${touch ? 44 : 24}px at ${width}px`).toEqual([]);
    expect(fields.length).toBeGreaterThan(5);
    if (touch) {
      expect(fields.filter((f) => f.fontSize < 16).map((f) => `${f.name} ${f.fontSize}px`), `text under 16 px at ${width}px`).toEqual([]);
    }
    const numeric = fields.filter((f) => f.numericLike);
    expect(numeric.length).toBeGreaterThanOrEqual(4);
    for (const f of numeric) {
      expect(f.inputMode, `${f.name}: inputmode`).toBe("numeric");
      expect(f.enterKeyHint, `${f.name}: enterkeyhint`).toBeTruthy();
    }
    expect(smallInPopover, `calendar controls under ${touch ? 44 : 24}px at ${width}px`).toEqual([]);
    expect(smallestDay).toBeGreaterThanOrEqual(touch ? 43.5 : 35.5);
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
  });
}
