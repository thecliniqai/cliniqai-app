/**
 * Navigation per role (V2-06 06-04b; IA §3.2, R-8, T-06-16, F-01 class): for each seeded role the shell shows exactly
 * the `navForRole` destinations, with v1 names and URLs; every one of them opens with 200, stays on its URL (no
 * redirect to /login, Today or a locked page) and shows no permission-refusal screen; the open destination carries
 * `aria-current="page"`. Every v1 dashboard page is reachable through the navigation of a role that may use it, except
 * the listed pages reached from inside other screens. Plus the shell's landmarks and skip link.
 *
 * desktop-chrome only: the Sidebar at 1280 px is the full list; the Rail (820) and BottomBar + More sheet (360) are
 * compared against the same model.
 */
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { readRunData, storageStatePath, ROLES, type E2eRole } from "../support/run-data";
import { dashboardRoutes } from "../support/routes";
import { allDestinations, navForRole } from "@/lib/nav/nav-for-role";
import { navLinks, primaryNav } from "./support/shell";

/** Text a page shows when it refuses a role (v1 cards and the permission errors). */
const REFUSAL = /You do not have permission|Access Denied|not allowed to/i;

/** Dashboard pages reached from inside other screens, not from the navigation (with where they are reached from). */
const NOT_IN_NAV: Record<string, string> = {
  "/patients/[id]": "a patient row on Patients, the palette's Patients group",
  "/consultation/[id]": "Open consult / Call in on a Today row",
  "/profile": "the account menu (My Profile)",
  "/billing/register": "a v1 redirect to /billing/reports (IA §1 row 12)",
  "/diag/client-error": "an e2e/staging diagnostic page, off in production",
  "/": "a redirect to /today (V2-08 R-14); the PWA start URL and old bookmarks land on it",
};

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "sets its own viewport; checked once");
});

const expected = (role: E2eRole) =>
  allDestinations(navForRole(role)).map((d) => [d.label, d.href] as [string, string]);

async function expectOpens(page: Page, name: string, href: string): Promise<void> {
  const response = await page.goto(href);
  expect(response?.status(), `${name} ${href}`).toBe(200);
  expect(new URL(page.url()).pathname, `${name} stays on its URL`).toBe(href);
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByRole("main").getByText(REFUSAL), `${name}: no refusal screen`).toHaveCount(0);
  await expect(primaryNav(page).getByRole("link", { name, exact: true })).toHaveAttribute("aria-current", "page");
  await expect(primaryNav(page).locator("[aria-current=page]")).toHaveCount(1);
}

for (const role of ROLES) {
  test.describe(`${role}`, () => {
    test.use({ storageState: storageStatePath(role) });

    test(`${role}: the Sidebar shows exactly navForRole's destinations, and each opens with 200 and aria-current`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      const home = navForRole(role).home;
      await page.goto(home);
      expect(await navLinks(page)).toEqual(expected(role));
      for (const [name, href] of expected(role)) await expectOpens(page, name, href);
    });

    test(`${role}: the Rail (820) and the BottomBar + More sheet (360) offer the same destinations`, async ({ page }) => {
      await page.setViewportSize({ width: 820, height: 1180 });
      await page.goto(navForRole(role).home);
      await expect(primaryNav(page)).toHaveCount(1);
      expect(await navLinks(page)).toEqual(expected(role));

      await page.setViewportSize({ width: 360, height: 780 });
      await expect(primaryNav(page)).toHaveCount(1);
      const bottom = await navLinks(page);
      expect(bottom.length).toBeLessThanOrEqual(4);
      await primaryNav(page).getByRole("button", { name: "More" }).click();
      const sheet = page.getByRole("dialog", { name: "More" });
      await expect(sheet).toBeVisible();
      const more = await sheet
        .getByRole("navigation", { name: "More" })
        .getByRole("link")
        .evaluateAll((links) => links.map((a) => [(a.textContent ?? "").trim(), new URL((a as HTMLAnchorElement).href).pathname]));
      expect([...bottom, ...more].sort()).toEqual([...expected(role)].sort());
      await sheet.getByRole("button", { name: "Close" }).click();
      await expect(sheet).toHaveCount(0);
    });
  });
}

test("every v1 dashboard page is reachable through the navigation of a role that may use it (or is listed)", () => {
  const offered = new Set(ROLES.flatMap((r) => allDestinations(navForRole(r)).map((d) => d.href)));
  const patterns = dashboardRoutes(() => "x").map((r) => r.pattern);
  const missing = patterns.filter((p) => !offered.has(p) && !(p in NOT_IN_NAV));
  expect(missing, "dashboard pages neither in a role's navigation nor listed").toEqual([]);
  for (const listed of Object.keys(NOT_IN_NAV)) expect(patterns, `stale NOT_IN_NAV entry ${listed}`).toContain(listed);
  for (const href of offered) expect(patterns, `nav destination ${href} is a dashboard page`).toContain(href);
});

test.describe("landmarks and skip link", () => {
  test.use({ storageState: storageStatePath("owner") });

  for (const width of [360, 820, 1280]) {
    test(`at ${width}px: one banner, one visible Primary navigation, one main; the skip link comes first and moves focus to main`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`/patients/${readRunData().tenantA.patientId}`);
      await expect(page.getByRole("banner")).toHaveCount(1);
      await expect(primaryNav(page)).toHaveCount(1);
      await expect(page.getByRole("main")).toHaveCount(1);
      await expect(page.getByRole("main")).toHaveAttribute("id", "main");

      // From a fresh load: the skip link is the first Tab stop; then (the approved shell's DOM order) the Sidebar or
      // Rail, the top bar (Back first), the content; on phones the BottomBar comes after the content.
      await page.keyboard.press("Tab");
      const skip = page.getByRole("link", { name: "Skip to content" });
      await expect(skip).toBeFocused();
      await expect(skip).toBeInViewport();
      await page.keyboard.press("Tab");
      const second = page.locator(":focus");
      if (width < 768) await expect(second).toHaveAccessibleName("Back");
      else await expect(second).toHaveAccessibleName(navForRole("owner").primary[0].label);

      await page.keyboard.press("Shift+Tab");
      await expect(skip).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.locator("#main")).toBeFocused();
    });
  }

  // CI 43712054628: the v1 consult workspace wrapped its sections in a second `<main>`. It streams in about 250 ms
  // after `page.goto`, so a spec that asked for `getByRole("main")` at once passed or hit a strict-mode violation by
  // timing (a slow runner lost the race). Asserted after the workspace has rendered, so the count is final.
  test("the consult (focus mode): one main landmark, the shell's, once the workspace has rendered", async ({ page }) => {
    await page.goto(`/consultation/${readRunData().tenantA.visitId}`);
    await expect(page.locator("section#vitals")).toBeVisible();
    await expect(page.locator("main")).toHaveCount(1);
    await expect(page.getByRole("main")).toHaveAttribute("id", "main");
  });
});
