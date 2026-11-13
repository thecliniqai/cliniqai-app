/**
 * R8 accessibility of the forgot-password screens changed by 03-13a (CLAUDE.md DoD 3): the code step with the 8-digit
 * field (ruling R-36) and the "Password changed" step that now ends signed out (ruling R-35, H-AUTH). Each at 360, 820
 * and 1280 px: 0 serious or critical axe violations (WCAG 2.0/2.1/2.2 A+AA), no horizontal scroll at 360 px, and
 * full-page screenshots attached for the visual check. Each width runs a real reset for a fresh member (local
 * Mailpit code), so the done step is the real one: no session cookie survives it.
 *
 * Runs on the desktop-chrome project only (the spec sets its own viewport); see playwright.config.ts.
 */
import AxeBuilder from "@axe-core/playwright";
import type { Page, TestInfo } from "@playwright/test";
import { expect, test } from "../fixtures";
import { clearPassword, freshMember, mailCount, newestCode } from "../support/password-journeys";

test.use({ storageState: { cookies: [], origins: [] } });

const TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const BLOCKING_IMPACTS = new Set(["serious", "critical"]);
const WIDTHS = [
  { width: 360, height: 780 },
  { width: 820, height: 1180 },
  { width: 1280, height: 800 },
];

type AxeResults = Awaited<ReturnType<AxeBuilder["analyze"]>>;

function seriousOrCritical(results: AxeResults) {
  return results.violations
    .filter((v) => BLOCKING_IMPACTS.has(v.impact ?? ""))
    .map((v) => ({ id: v.id, impact: v.impact, help: v.help, targets: v.nodes.map((n) => n.target.join(" ")) }));
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

test.describe("R8 blocking: forgot-password code step (8 digits) and the signed-out done step", () => {
  for (const size of WIDTHS) {
    test(`reset screens at ${size.width}px: 0 serious/critical`, async ({ page }, testInfo) => {
      const user = await freshMember();
      await page.setViewportSize(size);
      await page.goto("/forgot-password");
      const send = page.getByRole("button", { name: "Send code" });
      await expect(send).toBeEnabled();
      await expect(page.getByText("Enter your clinic email and we'll send you an 8-digit code.")).toBeVisible();
      const before = await mailCount(user.email);
      await page.getByLabel(/^Email/).fill(user.email);
      await send.click();
      await expect(page.getByRole("heading", { name: "Set a new password" })).toBeVisible();
      const code = await newestCode(user.email, before);

      const codeField = page.getByLabel(/^8-digit code/);
      await expect(codeField).toHaveAttribute("maxlength", "8");
      await codeField.fill(code);
      await expect(codeField).toHaveValue(code);
      await check(page, testInfo, `reset-code-${size.width}`, size.width);

      const fresh = clearPassword();
      await page.getByLabel(/^New password/).fill(fresh);
      await page.getByLabel(/^Confirm new password/).fill(fresh);
      await page.getByRole("button", { name: "Save new password" }).click();
      await expect(page.getByRole("heading", { name: "Password changed" })).toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
      const authCookies = (await page.context().cookies()).filter((c) => /^sb-.*-auth-token/.test(c.name) && c.value !== "");
      expect(authCookies, "no session cookie survives the reset (R-35)").toEqual([]);
      await check(page, testInfo, `reset-done-${size.width}`, size.width);
    });
  }
});
