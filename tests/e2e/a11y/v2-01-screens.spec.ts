/**
 * R8 accessibility checks for the screens V2-01 changed (V2-02 plan 02-03a, ruling RL-17; CLAUDE.md DoD 3).
 *
 * BLOCKING — the three new V2-01 auth pages (login, forgot-password, join) at 360, 820 and 1280 px: 0 serious or
 * critical axe violations (WCAG 2.0/2.1/2.2 A+AA tags) and no horizontal scroll at 360 px.
 * REPORT-ONLY — the four V2-01-touched v1 components (staff edit, invite form, Sign & Bill modal, DPDP export
 * control) at 360 px: the axe result is attached as JSON and summarised (with horizontal overflow) in an annotation
 * naming the owning FMP milestone; the test fails only if the component cannot be reached. Their a11y debt is
 * replaced in V2-06…V2-11.
 *
 * Runs on the desktop-chrome project only (the specs set their own viewport); see playwright.config.ts.
 */
import AxeBuilder from "@axe-core/playwright";
import type { Page, TestInfo } from "@playwright/test";
import { expect, test } from "../fixtures";
import { readRunData, storageStatePath } from "../support/run-data";

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

async function attach(testInfo: TestInfo, name: string, results: AxeResults): Promise<void> {
  await testInfo.attach(`axe-${name}.json`, {
    body: JSON.stringify({ url: results.url, violations: results.violations }, null, 2),
    contentType: "application/json",
  });
}

async function hasHorizontalScroll(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
}

// --- Blocking: V2-01 auth pages ---------------------------------------------------------------------------------
const AUTH_PAGES: Array<{ name: string; path: string; ready: (page: Page) => Promise<void> }> = [
  {
    name: "login",
    path: "/login",
    ready: (page) => expect(page.getByRole("heading", { name: "Sign in to ClinicOS" })).toBeVisible(),
  },
  {
    name: "forgot-password",
    path: "/forgot-password",
    ready: (page) => expect(page.getByRole("heading", { name: "Reset your password" })).toBeVisible(),
  },
  {
    name: "join (incomplete link)",
    path: "/join",
    ready: (page) => expect(page.getByText("This invitation link is incomplete.")).toBeVisible(),
  },
  {
    name: "join (signed out)",
    path: "/join?token=e2e-synthetic-token",
    ready: (page) => expect(page.getByRole("link", { name: "Sign in" })).toBeVisible(),
  },
];

test.describe("R8 blocking: V2-01 auth pages", () => {
  for (const authPage of AUTH_PAGES) {
    for (const size of WIDTHS) {
      test(`${authPage.name} at ${size.width}px: 0 serious/critical axe violations`, async ({ page }, testInfo) => {
        await page.setViewportSize(size);
        await page.goto(authPage.path);
        await authPage.ready(page);
        // Credential forms keep submit disabled until hydration, then fade it in (150 ms opacity transition).
        // Scan the settled page the user sees, not a frame mid-transition (02-06 hydration guard).
        const submits = page.locator('button[type="submit"]');
        if (await submits.count()) {
          await expect(submits.first()).toBeEnabled();
          await expect
            .poll(() => submits.first().evaluate((el) => getComputedStyle(el).opacity))
            .toBe("1");
        }

        const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
        await attach(testInfo, `${authPage.name}-${size.width}`, results);
        expect(seriousOrCritical(results), "serious/critical axe violations").toEqual([]);

        if (size.width === 360) {
          expect(await hasHorizontalScroll(page), "horizontal scroll at 360px").toBe(false);
        }
      });
    }
  }
});

// --- Report-only: V2-01-touched v1 components ---------------------------------------------------------------------
async function reportOnly(page: Page, testInfo: TestInfo, name: string, owner: string, scope?: string): Promise<void> {
  let builder = new AxeBuilder({ page }).withTags(TAGS);
  if (scope) builder = builder.include(scope);
  const results = await builder.analyze();
  await attach(testInfo, name, results);
  const blocking = seriousOrCritical(results);
  const overflow = await hasHorizontalScroll(page);
  testInfo.annotations.push({
    type: "axe-report-only",
    description:
      `${name}: ${blocking.length} serious/critical violation(s)` +
      (blocking.length ? ` [${[...new Set(blocking.map((v) => v.id))].join(", ")}]` : "") +
      `; horizontal scroll at 360px: ${overflow ? "yes" : "no"}; owner ${owner}`,
  });
}

test.describe("R8 report-only: V2-01-touched v1 components (owner)", () => {
  test.use({ storageState: storageStatePath("owner"), viewport: { width: 360, height: 780 } });

  test("staff invite form", async ({ page }, testInfo) => {
    await page.goto("/staff");
    await expect(page.getByLabel(/^Staff Email Address/)).toBeVisible();
    await reportOnly(page, testInfo, "staff-invite-form", "FMP M4.7 (staff/settings)", "form:has(#role)");
  });

  test("staff edit modal", async ({ page }, testInfo) => {
    await page.goto("/staff");
    await page.getByRole("button", { name: "Edit", exact: true }).first().click();
    await expect(page.locator("#edit-staff-title")).toBeVisible();
    await reportOnly(page, testInfo, "staff-edit-modal", "FMP M4.7 (staff/settings)", '[aria-labelledby="edit-staff-title"]');
  });

  test("DPDP export control on the patient page", async ({ page }, testInfo) => {
    await page.goto(`/patients/${readRunData().tenantA.patientId}`);
    await expect(page.getByRole("button", { name: /Download Medical Summary/ })).toBeVisible();
    await reportOnly(page, testInfo, "dpdp-export-control", "FMP M4 (patient detail)");
  });
});

test.describe("R8 report-only: V2-01-touched v1 components (doctor)", () => {
  test.use({ storageState: storageStatePath("doctor"), viewport: { width: 360, height: 780 } });

  test("Sign & Bill modal", async ({ page }, testInfo) => {
    await page.goto(`/consultation/${readRunData().tenantA.visitId}`);
    await page.getByRole("button", { name: /Complete & Sign/ }).first().click();
    await expect(page.locator("#sign-bill-title").first()).toBeVisible();
    await reportOnly(page, testInfo, "sign-and-bill-modal", "FMP M4.4 (consultation finish)", '[aria-labelledby="sign-bill-title"]');
  });
});
