/**
 * V2-05 05-09c (SUB-01; R-36): the owner's Subscription & Billing page reads the clinic's `tenant_subscriptions` row and
 * `my_tenant_access` (the v1 `subscriptions` / `payment_records` were dropped in 000086). The e2e clinics are seeded
 * `trialing` on the Standard price by `seedTenantWithOwner` (R-25), so the owner sees "Free trial", "Full access", the
 * trial end and the access end, and the V2-13b note; an admin sees the same; a doctor is refused with the fixed text.
 * At 360, 820 and 1280 px: 0 serious/critical axe violations in the page content (WCAG 2.0/2.1/2.2 A+AA; the shared
 * sidebar/header carry pre-existing v1 findings owned by V2-06, attached but not blocking, as in the 04-03b spec), no
 * horizontal scroll at 360 px, screenshots attached for the visual check. Synthetic data only.
 */
import AxeBuilder from "@axe-core/playwright";
import type { Page, TestInfo } from "@playwright/test";
import { expect, test } from "../fixtures";
import { storageStatePath } from "../support/run-data";

const TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const BLOCKING_IMPACTS = new Set(["serious", "critical"]);
const WIDTHS = [
  { width: 360, height: 780 },
  { width: 820, height: 1180 },
  { width: 1280, height: 800 },
];
const NOTE = "Plan management arrives with billing (V2-13b).";

type AxeResults = Awaited<ReturnType<AxeBuilder["analyze"]>>;

function seriousOrCritical(results: AxeResults) {
  return results.violations
    .filter((v) => BLOCKING_IMPACTS.has(v.impact ?? ""))
    .map((v) => ({ id: v.id, impact: v.impact, help: v.help, targets: v.nodes.map((n) => n.target.join(" ")) }));
}

async function check(page: Page, testInfo: TestInfo, name: string, width: number): Promise<void> {
  const fullPage = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  await testInfo.attach(`axe-full-page-${name}.json`, {
    body: JSON.stringify({ url: fullPage.url, violations: fullPage.violations }, null, 2),
    contentType: "application/json",
  });
  const results = await new AxeBuilder({ page }).withTags(TAGS).include("[data-testid='billing-settings']").analyze();
  await testInfo.attach(`axe-${name}.json`, {
    body: JSON.stringify({ url: results.url, violations: results.violations }, null, 2),
    contentType: "application/json",
  });
  await testInfo.attach(`screenshot-${name}.png`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  expect(seriousOrCritical(results), "serious/critical axe violations in the billing page content").toEqual([]);
  if (width === 360) {
    const scrolls = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(scrolls, "horizontal scroll at 360px").toBe(false);
  }
}

test.describe("Subscription & Billing (owner)", () => {
  test.use({ storageState: storageStatePath("owner") });

  test("shows the trialing clinic's status, access and dates from tenant_subscriptions; axe and layout at 360/820/1280", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(WIDTHS[2]);
    await page.goto("/settings/billing");
    const overview = page.getByTestId("subscription-overview");
    await expect(overview).toBeVisible();
    await expect(overview.getByText("Free trial", { exact: true })).toBeVisible();
    await expect(overview.getByText("Full access", { exact: true })).toBeVisible();
    await expect(overview.getByText("Trial ends", { exact: true })).toBeVisible();
    await expect(overview.getByText("Access until", { exact: true })).toBeVisible();
    await expect(page.getByText(NOTE)).toBeVisible();
    // Nothing of the v1 page is left (plan tier, monthly amount, payment history).
    await expect(page.getByText("Payment History")).toHaveCount(0);

    for (const size of WIDTHS) {
      await page.setViewportSize(size);
      await expect(overview).toBeVisible();
      await check(page, testInfo, `settings-billing-${testInfo.project.name}-${size.width}`, size.width);
    }
  });
});

test.describe("Subscription & Billing (doctor)", () => {
  test.use({ storageState: storageStatePath("doctor") });

  test("a doctor (no clinic:manage) is refused with the fixed text and sees no subscription data", async ({ page }) => {
    await page.goto("/settings/billing");
    await expect(page.getByText("Billing details are restricted to Clinic Owners and Administrators.")).toBeVisible();
    await expect(page.getByTestId("subscription-overview")).toHaveCount(0);
  });
});
