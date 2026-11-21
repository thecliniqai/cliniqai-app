/**
 * V2-06 06-09e: the G3 design review's fixes (`reviews/v206-review-design.md`), asserted on the built app in a real
 * browser at the design widths (360/820/1180/1280, `DESIGN_WIDTHS`).
 *
 * - M1: the consult and a patient's record have one Back control, in the shell's top bar (none at 1280 px on the
 *   record, where the Sidebar is the way back; always one on the consult, focus mode). The v1 in-page arrows are gone.
 * - M2: below 1280 px a queue row keeps its actions in a right-hand column beside the content (rows of about 80 px;
 *   44 px targets below 1024 px); at 1280 px the actions sit on a line under the content (the lane board).
 * - M3: at 360 px every BottomBar caption is one line and every icon sits on the same line; the links keep their v1
 *   accessible names (and the long "My Calendar" shows "Calendar").
 * - M4: no monospace face on Login, a patient's record or the consult; numbers, IDs and phones are Inter with tabular
 *   figures.
 * - M5: `/offline` (named mark, WifiOff glyph, Manrope 800 heading, Retry with its icon), the install card (Manrope 700
 *   title beside the mark, the privacy line) and the not-found / error states (Manrope 800 headings, 44 px buttons).
 * - L12: one `h1` per shell route (the top-bar title is not a heading).
 * At each width the page has no horizontal scroll and axe (the M0 tags) finds no serious or critical violation in the
 * scope that changed, after animations settle.
 *
 * desktop-chrome sets each width itself; pixel-7 (a real coarse pointer) runs the BottomBar and queue-row checks at
 * its own viewport.
 */
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { expect, test } from "../fixtures";
import { readRunData, storageStatePath } from "../support/run-data";
import { settleAnimations } from "../support/settle";
import { DESIGN_WIDTHS } from "../design/support/widths";

const TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const BLOCKING = new Set(["serious", "critical"]);
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

const desktopOnly = (name: string) => test.skip(name !== "desktop-chrome", "sets its own viewport; desktop Chromium");

async function blocking(page: Page, include?: string, exclude?: string): Promise<string[]> {
  let builder = new AxeBuilder({ page }).withTags(TAGS);
  if (include) builder = builder.include(include);
  if (exclude) builder = builder.exclude(exclude);
  const results = await builder.analyze();
  return results.violations.filter((v) => BLOCKING.has(v.impact ?? "")).map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

async function noHorizontalScroll(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
}

async function settle(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
  await settleAnimations(page);
}

/** Every visible control that reads as "Back": an arrow-left glyph, a name starting "Back", or a "←" label. */
async function backControls(page: Page): Promise<Array<{ name: string; inTopBar: boolean }>> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("a[href], button, [role=button], [role=link]")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden" && !el.closest("[aria-hidden=true], [inert]");
      })
      .filter((el) => {
        const name = (el.getAttribute("aria-label") || el.textContent || "").trim();
        return Boolean(el.querySelector("svg.lucide-arrow-left, svg.lucide-chevron-left, svg.lucide-move-left")) || /^back\b/i.test(name) || name.startsWith("←");
      })
      .map((el) => ({
        name: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 40),
        inTopBar: el.closest("[data-shell-top-bar]") !== null,
      })),
  );
}

/** Elements whose computed font is a monospace face. */
async function monospaced(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("body *")]
      .filter((el) => /mono|menlo|courier|consolas/i.test(getComputedStyle(el).fontFamily) && (el.textContent ?? "").trim() !== "")
      .map((el) => `${el.tagName.toLowerCase()} "${(el.textContent ?? "").trim().slice(0, 30)}" ${getComputedStyle(el).fontFamily}`),
  );
}

async function fontOf(page: Page, selector: string) {
  return page.locator(selector).first().evaluate((el) => {
    const s = getComputedStyle(el);
    return { family: s.fontFamily, weight: s.fontWeight, size: s.fontSize, numeric: s.fontVariantNumeric };
  });
}

test.describe("M1: one Back control on a patient's record and on the consult", () => {
  test.use({ storageState: storageStatePath("owner") });
  test.beforeEach(({}, testInfo) => desktopOnly(testInfo.project.name));

  for (const { width, height } of DESIGN_WIDTHS) {
    test(`at ${width}px`, async ({ page }) => {
      const { tenantA } = readRunData();
      await page.setViewportSize({ width, height });

      await page.goto(`/patients/${tenantA.patientId}`);
      await expect(page.getByRole("main")).toBeVisible();
      await settle(page);
      const onRecord = await backControls(page);
      // Below 1280 px the top bar's Back; at 1280 px the Sidebar's Patients item is the way back (06-UI-SPEC §6).
      expect(onRecord, `patient record at ${width}px`).toEqual(width < 1280 ? [{ name: "Back", inTopBar: true }] : []);
      expect(await noHorizontalScroll(page), `record: horizontal scroll at ${width}px`).toBe(true);
      expect(await blocking(page, "[data-shell-top-bar]"), `record top bar axe at ${width}px`).toEqual([]);

      await page.goto(`/consultation/${tenantA.visitId}`);
      await expect(page.getByRole("main")).toBeVisible();
      await settle(page);
      expect(await backControls(page), `consult at ${width}px`).toEqual([{ name: "Back", inTopBar: true }]);
      expect(await noHorizontalScroll(page), `consult: horizontal scroll at ${width}px`).toBe(true);
      expect(await blocking(page, "[data-shell-top-bar]"), `consult top bar axe at ${width}px`).toEqual([]);
    });
  }

  test("the consult's one Back works from the keyboard (deep link: to the nav parent)", async ({ page }) => {
    const { tenantA } = readRunData();
    await page.setViewportSize({ width: 820, height: 1180 });
    await page.goto(`/consultation/${tenantA.visitId}`);
    const back = page.getByRole("button", { name: "Back", exact: true });
    await expect(back).toBeVisible();
    await back.focus();
    await page.keyboard.press("Enter");
    await page.waitForURL((url) => url.pathname === "/today");
  });
});

test.describe("M2: queue rows keep their actions in a right-hand column below 1280 px", () => {
  test.use({ storageState: storageStatePath("owner") });

  async function rows(page: Page) {
    const section = page.locator("[data-gallery-section=clinical-a]");
    await expect(section).toBeVisible();
    await settle(page);
    return section.locator("[data-queue-row]").evaluateAll((els) =>
      els
        .filter((row) => row.querySelector("[data-row-actions]"))
        .map((row) => {
          const box = (sel: string) => row.querySelector(sel)!.getBoundingClientRect();
          const r = row.getBoundingClientRect();
          const content = box("[data-row-content]");
          const actions = box("[data-row-actions]");
          const buttons = [...row.querySelectorAll("[data-row-actions] button")].map((b) => b.getBoundingClientRect());
          return {
            name: row.querySelector("[data-patient-name]")?.textContent ?? "",
            height: r.height,
            besideContent: actions.left >= content.right - 0.5,
            belowContent: actions.top >= content.bottom - 0.5,
            actionsInsideRow: actions.top >= r.top && actions.bottom <= r.bottom,
            minButton: Math.min(...buttons.map((b) => Math.min(b.width, b.height))),
          };
        }),
    );
  }

  for (const { width, height } of DESIGN_WIDTHS) {
    test(`at ${width}px`, async ({ page }, testInfo) => {
      desktopOnly(testInfo.project.name);
      await page.setViewportSize({ width, height });
      await page.goto("/dev/ui");
      const measured = await rows(page);
      expect(measured.length).toBe(5);
      for (const row of measured) {
        if (width < 1280) {
          expect(row.besideContent, `${row.name} actions beside the content at ${width}px`).toBe(true);
          expect(row.actionsInsideRow, `${row.name} actions inside the row at ${width}px`).toBe(true);
          // About 80 px; the 30-character name may take two lines (CD-13) and the next-up row has its "Next" line.
          expect(row.height, `${row.name} row height at ${width}px`).toBeLessThanOrEqual(104);
        } else {
          expect(row.belowContent, `${row.name} actions under the content at ${width}px`).toBe(true);
        }
        if (width < 1024) expect(row.minButton, `${row.name} 44 px targets at ${width}px`).toBeGreaterThanOrEqual(44);
      }
      // A row whose name fits one line is about 80 px (the phone lane is full bleed, as on Today).
      if (width < 1280) {
        const plain = measured.find((r) => r.name === "Synthetic Patient 02")!;
        expect(plain.height, `a one-line row at ${width}px`).toBeGreaterThanOrEqual(64);
        expect(plain.height, `a one-line row at ${width}px`).toBeLessThanOrEqual(92);
      }
      expect(await noHorizontalScroll(page), `horizontal scroll at ${width}px`).toBe(true);
      expect(await blocking(page, "[data-gallery-section=clinical-a]"), `clinical-a axe at ${width}px`).toEqual([]);
    });
  }

  test("on a phone (Pixel 7, coarse pointer)", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "pixel-7", "Pixel 7 only");
    await page.goto("/dev/ui");
    for (const row of await rows(page)) {
      expect(row.besideContent, row.name).toBe(true);
      expect(row.height, row.name).toBeLessThanOrEqual(104);
      expect(row.minButton, row.name).toBeGreaterThanOrEqual(44);
    }
  });
});

test.describe("M3: BottomBar captions stay on one line with their icons aligned", () => {
  async function bar(page: Page) {
    const nav = page.locator("[data-shell-nav=bottom-bar]");
    await expect(nav).toBeVisible();
    await settle(page);
    return nav.evaluate((el) =>
      [...el.querySelectorAll<HTMLElement>("a, button")].map((cell) => {
        const caption = cell.querySelector<HTMLElement>("[data-bar-caption]")!;
        const icon = cell.querySelector("svg")!.getBoundingClientRect();
        return {
          caption: caption.textContent ?? "",
          lines: Math.round(caption.getBoundingClientRect().height / parseFloat(getComputedStyle(caption).lineHeight)),
          clipped: caption.scrollWidth > caption.clientWidth + 0.5,
          iconTop: icon.top,
          cellHeight: cell.getBoundingClientRect().height,
        };
      }),
    );
  }

  for (const role of ["owner", "receptionist", "doctor"] as const) {
    test.describe(role, () => {
      test.use({ storageState: storageStatePath(role) });

      test(`at 360px (${role})`, async ({ page }, testInfo) => {
        desktopOnly(testInfo.project.name);
        await page.setViewportSize({ width: 360, height: 780 });
        await page.goto(role === "doctor" ? "/today" : "/patients");
        const cells = await bar(page);
        expect(cells.length).toBeGreaterThanOrEqual(3);
        for (const cell of cells) {
          expect(cell.lines, `"${cell.caption}" on one line`).toBe(1);
          expect(cell.clipped, `"${cell.caption}" not cut off`).toBe(false);
          expect(cell.cellHeight, `"${cell.caption}" cell ≥ 44 px`).toBeGreaterThanOrEqual(44);
        }
        const tops = cells.map((c) => c.iconTop);
        expect(Math.max(...tops) - Math.min(...tops), "icons on one line").toBeLessThanOrEqual(0.5);
        expect(await blocking(page, "[data-shell-nav=bottom-bar]"), "BottomBar axe").toEqual([]);
        expect(await noHorizontalScroll(page)).toBe(true);
      });
    });
  }

  test.describe("names", () => {
    test.use({ storageState: storageStatePath("owner") });

    test("the owner's bar shows the Today caption and keeps one baseline", async ({ page }, testInfo) => {
      test.skip(!["desktop-chrome", "pixel-7"].includes(testInfo.project.name), "desktop and touch only");
      if (testInfo.project.name === "desktop-chrome") await page.setViewportSize({ width: 360, height: 780 });
      await page.goto("/patients");
      const nav = page.locator("[data-shell-nav=bottom-bar]");
      const today = nav.getByRole("link", { name: "Today", exact: true });
      await expect(today).toBeVisible();
      await expect(today).toHaveText("Today");
      // The cells keep one baseline on the real touch device too.
      const cells = await bar(page);
      for (const cell of cells) expect(cell.lines, cell.caption).toBe(1);
      const tops = cells.map((c) => c.iconTop);
      expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(0.5);
      await today.click();
      await page.waitForURL((url) => url.pathname === "/today");
    });
  });
});

test.describe("M4: no monospace face; numbers and IDs are Inter with tabular figures", () => {
  test.beforeEach(({}, testInfo) => desktopOnly(testInfo.project.name));

  test.describe("signed out", () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    for (const width of [360, 1280]) {
      test(`Login at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: width === 360 ? 780 : 800 });
        await page.goto("/login");
        await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
        await settle(page);
        expect(await monospaced(page)).toEqual([]);
        if (width === 1280) {
          const token = page.getByText("Token #18", { exact: true });
          await expect(token).toBeVisible();
          const style = await token.evaluate((el) => ({ family: getComputedStyle(el).fontFamily, numeric: getComputedStyle(el).fontVariantNumeric }));
          expect(style.family).toMatch(/^"?Inter"?,/);
          expect(style.numeric).toContain("tabular-nums");
        }
      });
    }
  });

  test.describe("signed in", () => {
    test.use({ storageState: storageStatePath("owner") });

    for (const width of [360, 820, 1280]) {
      test(`a patient's record and the consult at ${width}px`, async ({ page }) => {
        const { tenantA } = readRunData();
        await page.setViewportSize({ width, height: 800 });
        await page.goto(`/patients/${tenantA.patientId}`);
        await expect(page.getByRole("main")).toBeVisible();
        await settle(page);
        expect(await monospaced(page), `record at ${width}px`).toEqual([]);
        const id = page.getByRole("main").getByText(/^ID: /).first();
        await expect(id).toBeVisible();
        const style = await id.evaluate((el) => ({ family: getComputedStyle(el).fontFamily, numeric: getComputedStyle(el).fontVariantNumeric }));
        expect(style.family).toMatch(/^"?Inter"?,/);
        expect(style.numeric).toContain("tabular-nums");

        await page.goto(`/consultation/${tenantA.visitId}`);
        await expect(page.getByRole("main")).toBeVisible();
        await settle(page);
        expect(await monospaced(page), `consult at ${width}px`).toEqual([]);
      });
    }
  });
});

test.describe("M5: display headings and glyphs on /offline, the install card and the route states", () => {
  test.beforeEach(({}, testInfo) => desktopOnly(testInfo.project.name));

  test.describe("signed out", () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    for (const { width, height } of DESIGN_WIDTHS) {
      test(`/offline at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height });
        await page.goto("/offline");
        await settle(page);
        await expect(page.getByRole("img", { name: "CliniQ AI" })).toBeVisible();
        await expect(page.locator("svg.lucide-wifi-off")).toBeVisible();
        const heading = await fontOf(page, "h1");
        expect(heading.family).toMatch(/^"?Manrope"?,/);
        expect(heading.weight).toBe("800");
        expect(heading.size).toBe("20px");
        const retry = page.getByRole("link", { name: "Retry", exact: true });
        await expect(retry.locator("svg.lucide-refresh-cw")).toBeVisible();
        expect((await retry.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        expect(await noHorizontalScroll(page)).toBe(true);
        expect(await blocking(page), `offline axe at ${width}px`).toEqual([]);
      });
    }
  });

  test.describe("signed in", () => {
    test.use({ storageState: storageStatePath("owner") });

    for (const width of [360, 1280]) {
      test(`not-found and error states at ${width}px: Manrope 800 headings, 44 px buttons`, async ({ page }) => {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(`/patients/${randomUUID()}`);
        await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
        await settle(page);
        let heading = await fontOf(page, "#main h1");
        expect(heading.family).toMatch(/^"?Manrope"?,/);
        expect(heading.weight).toBe("800");
        expect((await page.getByRole("main").getByRole("link", { name: "Go to Today" }).boundingBox())!.height).toBe(44);
        expect(await blocking(page, "#main"), `not-found axe at ${width}px`).toEqual([]);

        await page.goto("/diag/client-error");
        await page.getByRole("button", { name: "Throw a render error" }).click();
        await expect(page.getByRole("heading", { name: "Something went wrong" })).toBeVisible();
        await settle(page);
        heading = await fontOf(page, "#main h1");
        expect(heading.family).toMatch(/^"?Manrope"?,/);
        expect(heading.weight).toBe("800");
        const tryAgain = page.getByRole("button", { name: "Try again" });
        expect((await tryAgain.boundingBox())!.height).toBe(44);
        expect(await blocking(page, "#main"), `error axe at ${width}px`).toEqual([]);
      });
    }

    test("signed in, the standalone not-found page (outside the shell) carries the 32 px mark and a Manrope heading", async ({ page }) => {
      await page.setViewportSize({ width: 360, height: 780 });
      await page.goto("/no-such-page");
      await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
      await settle(page);
      const mark = page.getByRole("img", { name: "CliniQ AI" });
      await expect(mark).toBeVisible();
      expect((await mark.boundingBox())!.width).toBe(32);
      expect((await fontOf(page, "h1")).family).toMatch(/^"?Manrope"?,/);
      expect(await blocking(page)).toEqual([]);
    });

    test.describe("install card (iPhone)", () => {
      test.use({ userAgent: IPHONE_UA });

      for (const width of [360, 820]) {
        test(`at ${width}px: Manrope 700 title beside the mark, the privacy line`, async ({ page }) => {
          await page.addInitScript(() => {
            Object.defineProperty(Navigator.prototype, "maxTouchPoints", { configurable: true, get: () => 5 });
            if (!sessionStorage.getItem("clinicos.pref.signedInSessions")) localStorage.setItem("clinicos.pref.signedInSessions", "1");
            localStorage.removeItem("clinicos.pref.installDismissedUntil");
          });
          await page.setViewportSize({ width, height: 800 });
          await page.goto("/today");
          const card = page.locator("[data-install-card]");
          await expect(card).toBeVisible();
          await settle(page);
          const title = card.getByRole("heading", { name: "Install CliniQ AI on this device" });
          const style = await title.evaluate((el) => ({ family: getComputedStyle(el).fontFamily, weight: getComputedStyle(el).fontWeight }));
          expect(style.family).toMatch(/^"?Manrope"?,/);
          expect(style.weight).toBe("700");
          await expect(card.getByText("Patient data is not stored on the device.", { exact: false })).toBeVisible();
          // The mark sits at the left of the title (not stacked above it).
          const mark = (await card.locator("svg[data-mark]").boundingBox())!;
          const titleBox = (await title.boundingBox())!;
          expect(mark.x + mark.width).toBeLessThanOrEqual(titleBox.x);
          expect(mark.y).toBeLessThan(titleBox.y + titleBox.height);
          expect(await blocking(page, "[data-install-card]")).toEqual([]);
          expect(await noHorizontalScroll(page)).toBe(true);
        });
      }
    });
  });
});

test.describe("L12: one h1 per shell route", () => {
  test.use({ storageState: storageStatePath("owner") });
  test.beforeEach(({}, testInfo) => desktopOnly(testInfo.project.name));

  for (const path of ["/today", "/billing/reports", "/settings/clinic", "/patients"]) {
    test(path, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(path);
      await expect(page.getByRole("main")).toBeVisible();
      await settle(page);
      await expect(page.locator("[data-shell-top-bar] h1")).toHaveCount(0);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    });
  }
});
