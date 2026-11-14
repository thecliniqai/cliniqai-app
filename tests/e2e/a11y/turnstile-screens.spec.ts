/**
 * R8 accessibility of the auth pages WITH the Turnstile widget (V2-03 03-12c; CLAUDE.md DoD 3). Login and forgot
 * password at 360, 820 and 1280 px, after the widget rendered and passed (local stub, the e2e build's always-pass test
 * key): 0 serious or critical axe violations (WCAG 2.0/2.1/2.2 A+AA), no horizontal scroll at 360 px, and the widget
 * fits its column. The failed state (always-fail key) is checked at 360 px too. Full-page screenshots are attached for
 * the visual check. The real widget is Cloudflare's iframe (its own accessibility); the stub stands in at the same
 * size (300 x 65 minimum, flexible width).
 *
 * Runs on the desktop-chrome project only (the specs set their own viewport); see playwright.config.ts.
 */
import AxeBuilder from "@axe-core/playwright";
import type { Page, TestInfo } from "@playwright/test";
import { expect, test } from "../fixtures";
import { TURNSTILE_ALWAYS_FAIL_SITE_KEY } from "../../setup/test-env";
import { settleAnimations } from "../support/settle";

test.use({ storageState: { cookies: [], origins: [] } });

const TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const BLOCKING_IMPACTS = new Set(["serious", "critical"]);
const WIDTHS = [
  { width: 360, height: 780 },
  { width: 820, height: 1180 },
  { width: 1280, height: 800 },
];

const PAGES = [
  { name: "login", path: "/login", heading: "Sign in to ClinicOS", widget: "#login-turnstile" },
  { name: "forgot-password", path: "/forgot-password", heading: "Reset your password", widget: "#reset-request-turnstile" },
];

type AxeResults = Awaited<ReturnType<AxeBuilder["analyze"]>>;

function seriousOrCritical(results: AxeResults) {
  return results.violations
    .filter((v) => BLOCKING_IMPACTS.has(v.impact ?? ""))
    .map((v) => ({ id: v.id, impact: v.impact, help: v.help, targets: v.nodes.map((n) => n.target.join(" ")) }));
}

async function settle(page: Page): Promise<void> {
  const submit = page.locator('button[type="submit"]').first();
  await expect(submit).toBeEnabled();
  await expect.poll(() => submit.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
  await settleAnimations(page); // the 06-02a Button fades its colours in; never scan a mid-fade frame
}

async function check(page: Page, testInfo: TestInfo, name: string, width: number): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  await testInfo.attach(`axe-${name}.json`, {
    body: JSON.stringify({ url: results.url, violations: results.violations }, null, 2),
    contentType: "application/json",
  });
  await testInfo.attach(`screenshot-${name}.png`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  expect(seriousOrCritical(results), "serious/critical axe violations").toEqual([]);
  if (width === 360) {
    const scrolls = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(scrolls, "horizontal scroll at 360px").toBe(false);
  }
}

test.describe("R8 blocking: auth pages with the Turnstile widget", () => {
  for (const authPage of PAGES) {
    for (const size of WIDTHS) {
      test(`${authPage.name} at ${size.width}px with the widget: 0 serious/critical`, async ({ page }, testInfo) => {
        await page.setViewportSize(size);
        await page.goto(authPage.path);
        await expect(page.getByRole("heading", { name: authPage.heading })).toBeVisible();
        const widget = page.locator(authPage.widget);
        await expect(widget.locator('[data-turnstile-stub="Success"]')).toBeVisible();
        await settle(page);

        // The widget sits inside the form column and keeps Cloudflare's minimum size.
        const box = await widget.boundingBox();
        const form = await page.locator("form").first().boundingBox();
        expect(box && form).toBeTruthy();
        expect(box!.width).toBeGreaterThanOrEqual(300);
        expect(box!.height).toBeGreaterThanOrEqual(65);
        expect(box!.x).toBeGreaterThanOrEqual(form!.x - 0.5);
        expect(box!.x + box!.width).toBeLessThanOrEqual(form!.x + form!.width + 0.5);

        await check(page, testInfo, `${authPage.name}-${size.width}`, size.width);
      });
    }
  }

  for (const authPage of PAGES) {
    test(`${authPage.name} at 360px with the widget failed: 0 serious/critical`, async ({ page }, testInfo) => {
      await page.addInitScript((key) => {
        (window as unknown as { __turnstileStubSiteKey: string }).__turnstileStubSiteKey = key;
      }, TURNSTILE_ALWAYS_FAIL_SITE_KEY);
      await page.setViewportSize(WIDTHS[0]);
      await page.goto(authPage.path);
      await expect(page.locator(authPage.widget).locator('[data-turnstile-stub="Failed"]')).toBeVisible();
      await expect(page.getByRole("status").filter({ hasText: "The security check failed" })).toBeVisible();
      await settle(page);
      await check(page, testInfo, `${authPage.name}-failed-360`, 360);
    });
  }
});
