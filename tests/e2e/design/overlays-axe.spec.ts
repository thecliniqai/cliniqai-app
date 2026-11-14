/**
 * Overlay states at the four design widths (V2-06 06-02b "UI checks": sheet below md, dialog at md+; axe; CLAUDE.md
 * DoD 3; 06-UI-SPEC G3-12, G3-17). Signed in as the owner on `/dev/ui`. At 360, 820, 1180 and 1280 px, each overlay is
 * opened from its live specimen and, once its enter motion has settled:
 * - axe (the M0 tags) finds 0 serious/critical violations on the page with the overlay open;
 * - the page has no horizontal scroll and the overlay fits the viewport;
 * - ResponsiveSheet is a bottom drawer (handle shown, full width, flush with the bottom) below 768 px and a 448 px right
 *   sheet (full height, flush right, no handle) from 768 px; the palette is full screen below 768 px;
 * - below 1024 px (touch, CD-03) every control in the overlay is at least 44 × 44 px; on a fine pointer ≥ 1024 px at
 *   least 24 × 24 (WCAG 2.5.8);
 * - Escape closes it.
 * A capture of each state and of the gallery's overlay section goes to `design-captures/06-02b/` (git-ignored) with the
 * axe summary per width.
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
const OUT = path.join(ROOT, "design-captures/06-02b");

interface OverlayCase {
  name: string;
  open: (page: Page) => Promise<Locator>;
}

const CASES: OverlayCase[] = [
  {
    name: "dialog",
    open: async (page) => {
      await page.getByTestId("dialog-open").click();
      return page.getByRole("dialog", { name: "Edit visit reason" });
    },
  },
  {
    name: "alert-dialog",
    open: async (page) => {
      await page.getByTestId("alert-open").click();
      return page.getByRole("alertdialog", { name: "Cancel this visit?" });
    },
  },
  {
    name: "responsive-sheet",
    open: async (page) => {
      await page.getByTestId("sheet-open").click();
      return page.getByRole("dialog", { name: "Book appointment" });
    },
  },
  {
    name: "drawer",
    open: async (page) => {
      await page.getByTestId("drawer-open").click();
      return page.getByRole("dialog", { name: "Record vitals" });
    },
  },
  {
    name: "popover",
    open: async (page) => {
      await page.getByTestId("popover-open").click();
      return page.getByRole("dialog", { name: "Queue filters" });
    },
  },
  {
    name: "menu",
    open: async (page) => {
      await page.getByTestId("menu-open").click();
      return page.getByRole("menu");
    },
  },
  {
    name: "tooltip",
    open: async (page) => {
      await page.getByRole("button", { name: "Print prescription" }).hover();
      // By its text: the menu case before this one returns focus to "More actions", whose own tooltip opens on that
      // focus; a bare `[data-overlay=tooltip]` matched that one at once, and axe then scanned this tooltip mid-fade
      // after its 400 ms delay (color-contrast, 2 of 4 widths in one run).
      return page.locator('[data-overlay="tooltip"]').filter({ hasText: "Print prescription" });
    },
  },
  {
    name: "command-dialog",
    open: async (page) => {
      await page.getByTestId("command-dialog-open").click();
      return page.getByRole("dialog", { name: "Search" });
    },
  },
  {
    name: "modal-adapter",
    open: async (page) => {
      await page.getByTestId("modal-open").click();
      return page.getByRole("dialog", { name: "Slot already booked" });
    },
  },
];

async function blockingViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  return {
    blocking: results.violations
      .filter((v) => BLOCKING.has(v.impact ?? ""))
      .map((v) => ({
        id: v.id,
        impact: v.impact,
        targets: v.nodes.map((n) => n.target.join(" ")),
        nodes: v.nodes.map((n) => `${n.html.slice(0, 160)} :: ${(n.failureSummary ?? "").replace(/\s+/g, " ").slice(0, 240)}`),
      })),
    all: results.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length })),
  };
}

/** Every visible control inside `overlay` that is smaller than `min` in either dimension. */
async function smallTargets(overlay: Locator, min: number): Promise<string[]> {
  return overlay.evaluate((root, minimum) => {
    const controls = root.querySelectorAll<HTMLElement>(
      'button, a[href], input:not([type=hidden]), textarea, select, [role="menuitem"], [role="option"], [role="checkbox"], [role="tab"]',
    );
    const small: string[] = [];
    for (const el of controls) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      // A checkbox box sits in a label row; the row is the target.
      const target = el.getAttribute("role") === "checkbox" ? (el.closest("label") ?? el).getBoundingClientRect() : r;
      if (target.width < minimum || target.height < minimum) {
        small.push(`${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim()}" ${Math.round(target.width)}×${Math.round(target.height)}`);
      }
    }
    return small;
  }, min);
}

test.use({ storageState: storageStatePath("owner") });
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "sets its own viewport; runs once on desktop Chromium");
});

for (const { width, height } of DESIGN_WIDTHS) {
  test(`overlays at ${width}px: axe clean, fitted, placed per width, touch targets, Escape closes`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/dev/ui");
    await expect(page.getByRole("heading", { level: 1, name: "Component gallery" })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    fs.mkdirSync(OUT, { recursive: true });

    const summary: Record<string, unknown> = {};
    for (const overlayCase of CASES) {
      const overlay = await overlayCase.open(page);
      await expect(overlay, overlayCase.name).toBeVisible();
      await settleAnimations(page);

      const { blocking, all } = await blockingViolations(page);
      const scrolls = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      const box = (await overlay.boundingBox())!;
      const small = await smallTargets(overlay, width < 1024 ? 44 : 24);
      await page.screenshot({ path: path.join(OUT, `${overlayCase.name}-${width}.png`) });
      summary[overlayCase.name] = { seriousOrCritical: blocking, violations: all, horizontalScroll: scrolls, box, smallTargets: small };

      expect(blocking, `${overlayCase.name} at ${width}px: serious/critical axe violations`).toEqual([]);
      expect(scrolls, `${overlayCase.name} at ${width}px: horizontal scroll`).toBe(false);
      expect(box.x, `${overlayCase.name} inside the viewport (left)`).toBeGreaterThanOrEqual(0);
      expect(Math.round(box.x + box.width), `${overlayCase.name} inside the viewport (right)`).toBeLessThanOrEqual(width);
      expect(small, `${overlayCase.name} at ${width}px: controls under ${width < 1024 ? 44 : 24} px`).toEqual([]);

      if (overlayCase.name === "responsive-sheet") {
        const handle = overlay.locator("[data-drawer-handle]");
        if (width < 768) {
          await expect(handle, "a bottom drawer below 768 px").toBeVisible();
          expect(Math.round(box.width)).toBe(width);
          expect(Math.round(box.y + box.height)).toBe(height);
        } else {
          await expect(handle, "a side sheet from 768 px").toBeHidden();
          expect(Math.round(box.width)).toBe(448);
          expect(Math.round(box.x + box.width)).toBe(width);
          expect(Math.round(box.height)).toBe(height);
        }
      }
      if (overlayCase.name === "command-dialog" && width < 768) {
        expect({ w: Math.round(box.width), h: Math.round(box.height) }, "full screen on phones").toEqual({ w: width, h: height });
        await expect(overlay.getByRole("button", { name: "Close" }), "on-screen Close on phones").toBeVisible();
      }
      if (overlayCase.name === "dialog") {
        expect(Math.round(box.width), "440 px, or the viewport − 32 px").toBe(Math.min(440, width - 32));
      }

      await page.keyboard.press("Escape");
      await expect(overlay, `${overlayCase.name}: Escape closes`).toHaveCount(0);
    }

    // Toasts: an info and an error toast together, inside the viewport, axe clean.
    await page.getByTestId("toast-info").click();
    await page.getByTestId("toast-error").click();
    const error = page.getByRole("alert").filter({ hasText: "Couldn't save" });
    await expect(error).toBeVisible();
    await settleAnimations(page);
    const toastAxe = await blockingViolations(page);
    const toastBox = (await error.boundingBox())!;
    await page.screenshot({ path: path.join(OUT, `toast-${width}.png`) });
    summary.toast = { seriousOrCritical: toastAxe.blocking, violations: toastAxe.all, box: toastBox };
    expect(toastAxe.blocking, `toasts at ${width}px`).toEqual([]);
    expect(toastBox.x).toBeGreaterThanOrEqual(0);
    expect(Math.round(toastBox.x + toastBox.width)).toBeLessThanOrEqual(width);
    expect(Math.round(toastBox.width), "at most 400 px wide").toBeLessThanOrEqual(400);
    await error.getByRole("button", { name: "Dismiss" }).click();

    // The gallery's overlay section as a page capture (the reviewer's 360 / 1280 set), once the info toast has left.
    await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, { timeout: 10_000 });
    await settleAnimations(page);
    await page.locator('[data-gallery-section="overlays"]').screenshot({ path: path.join(OUT, `gallery-overlays-${width}.png`) });
    fs.writeFileSync(path.join(OUT, `axe-overlays-${width}.json`), `${JSON.stringify({ route: "/dev/ui", width, summary }, null, 2)}\n`);
  });
}
