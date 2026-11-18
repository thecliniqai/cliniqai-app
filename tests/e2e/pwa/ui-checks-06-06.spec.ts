/**
 * 06-06 UI checks (CLAUDE.md DoD 3; plan § 06-06 "UI checks"): the update toast, the skew notice, the iOS install
 * sheet, the in-app-browser guidance and the Today install card, each at 360/820/1180/1280 px: visible, no horizontal
 * scroll, axe (wcag2a/2aa/21aa/22aa) 0 serious or critical on the 06-06 surface, a screenshot into
 * `design-captures/06-06/` (git-ignored) and the axe result next to it. desktop-chrome only (it sets its own
 * viewport); the install surfaces use an iPhone user agent with touch points (the iOS path renders on Chromium).
 *
 * Plus the desktop-chrome half of "the card never renders on /login, /clinic/new, a consult or the checkout drawer"
 * (the WebKit half is in 10-ipados.spec.ts). The real update, skew and lock paths are proven in 06-update.spec.ts;
 * here the states are only brought on screen (the skew notice by an unhandled ChunkLoadError rejection).
 */
import fs from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import type { Page, TestInfo } from "@playwright/test";
import { expect, test } from "../fixtures";
import { readRunData, storageStatePath } from "../support/run-data";
import { ROOT } from "../support/app-env";
import { DESIGN_WIDTHS } from "../design/support/widths";
import { settleAnimations } from "../support/settle";

const TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const OUT = path.join(ROOT, "design-captures/06-06");
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const WHATSAPP_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 WhatsApp/2.24.1";

async function axeBlocking(page: Page, testInfo: TestInfo, label: string, include: string) {
  await settleAnimations(page);
  const results = await new AxeBuilder({ page }).withTags(TAGS).include(include).analyze();
  const report = {
    label,
    url: new URL(results.url).pathname,
    violations: results.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length })),
  };
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

async function iosDevice(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "maxTouchPoints", { configurable: true, get: () => 5 });
    if (!sessionStorage.getItem("clinicos.pref.signedInSessions")) localStorage.setItem("clinicos.pref.signedInSessions", "1");
    localStorage.removeItem("clinicos.pref.installDismissedUntil");
  });
}

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "sets its own viewport; checked once");
});

test.describe("update toast and skew notice", () => {
  test.use({ storageState: storageStatePath("owner") });

  for (const w of DESIGN_WIDTHS) {
    test(`update toast and skew notice at ${w.width}px: axe clean, no horizontal scroll`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: w.width, height: w.height });
      await page.route("**/api/session-status", async (route) => {
        const response = await route.fetch();
        const body = (await response.json()) as Record<string, unknown>;
        await route.fulfill({ response, json: { ...body, deploymentId: "e2e-next-deployment" } });
      });
      await page.goto("/");
      const toast = page.locator("[data-update-toast]");
      await expect(toast.getByText("A new version is ready")).toBeVisible();
      await expect(toast.getByRole("button", { name: "Reload" })).toBeInViewport();
      expect(await noHorizontalScroll(page)).toBe(true);
      expect(await axeBlocking(page, testInfo, `update-toast-${w.width}`, "[data-update-toast]")).toEqual([]);
      await page.screenshot({ path: path.join(OUT, `update-toast-${w.width}.png`) });

      await page.evaluate(() => {
        const reason = Object.assign(new Error("synthetic chunk"), { name: "ChunkLoadError" });
        const promise = Promise.reject(reason);
        promise.catch(() => undefined);
        window.dispatchEvent(new PromiseRejectionEvent("unhandledrejection", { promise, reason }));
      });
      await expect(toast.getByText("This app was updated. Reload to continue.")).toBeVisible();
      expect(await noHorizontalScroll(page)).toBe(true);
      expect(await axeBlocking(page, testInfo, `skew-notice-${w.width}`, "[data-update-toast]")).toEqual([]);
      await page.screenshot({ path: path.join(OUT, `skew-notice-${w.width}.png`) });
    });
  }
});

test.describe("install surfaces (iOS path)", () => {
  test.use({ storageState: storageStatePath("owner"), userAgent: IPHONE_UA });

  for (const w of DESIGN_WIDTHS) {
    test(`Today card and the install sheet at ${w.width}px: axe clean, no horizontal scroll`, async ({ page }, testInfo) => {
      await iosDevice(page);
      await page.setViewportSize({ width: w.width, height: w.height });
      await page.goto("/");
      const card = page.locator("[data-install-card]");
      await expect(card).toBeVisible();
      expect(await noHorizontalScroll(page)).toBe(true);
      expect(await axeBlocking(page, testInfo, `install-card-${w.width}`, "[data-install-card]")).toEqual([]);
      await card.screenshot({ path: path.join(OUT, `install-card-${w.width}.png`) });

      await card.getByRole("button", { name: "Install app" }).click();
      const sheet = page.getByRole("dialog", { name: "Install CliniQ AI on this device" });
      await expect(sheet).toBeVisible();
      await expect(sheet.getByText("Keep Open as Web App on and tap Add")).toBeInViewport();
      await expect(sheet.getByRole("button", { name: "Done" })).toBeInViewport();
      expect(await axeBlocking(page, testInfo, `install-sheet-${w.width}`, "[data-install-sheet]")).toEqual([]);
      await page.screenshot({ path: path.join(OUT, `install-sheet-${w.width}.png`) });
    });
  }

  test("the card never renders on /clinic/new, a consult or the queue (checkout drawer page)", async ({ page }) => {
    await iosDevice(page);
    await page.goto("/");
    await expect(page.locator("[data-install-card]")).toBeVisible();
    const { visitId } = readRunData().tenantA;
    for (const p of ["/clinic/new", `/consultation/${visitId}`, "/queue"]) {
      await page.goto(p);
      await page.waitForLoadState("networkidle");
      await expect(page.locator("[data-install-card]"), p).toHaveCount(0);
    }
  });
});

test.describe("install surfaces: signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] }, userAgent: IPHONE_UA });

  test("no card on /login", async ({ page }) => {
    await iosDevice(page);
    await page.goto("/login");
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
    await expect(page.locator("[data-install-card]")).toHaveCount(0);
  });
});

test.describe("in-app browser guidance", () => {
  test.use({ storageState: storageStatePath("owner"), userAgent: WHATSAPP_UA });

  for (const w of DESIGN_WIDTHS) {
    test(`Open in Safari guidance at ${w.width}px: axe clean`, async ({ page }, testInfo) => {
      await iosDevice(page);
      await page.setViewportSize({ width: w.width, height: w.height });
      await page.goto("/");
      await page.getByRole("button", { name: /^Account menu/ }).click();
      await page.getByRole("menuitem", { name: "Open in Safari" }).click();
      const sheet = page.getByRole("dialog", { name: "Open in Safari to install" });
      await expect(sheet).toBeVisible();
      expect(await noHorizontalScroll(page)).toBe(true);
      expect(await axeBlocking(page, testInfo, `safari-guidance-${w.width}`, "[data-install-sheet]")).toEqual([]);
      await page.screenshot({ path: path.join(OUT, `safari-guidance-${w.width}.png`) });
    });
  }
});
