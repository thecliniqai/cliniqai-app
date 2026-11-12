/**
 * Smoke (V2-02 plan 02-03a; PWA-08a "projects run green on a smoke spec"): on every device project, each seeded role's
 * saved session opens the app, lands on its role's page, renders exactly one main landmark, logs no console error and
 * makes no blocked (non-loopback) request (the fixture fails the test otherwise).
 */
import { expect, test } from "./fixtures";
import { LANDING, ROLES, storageStatePath } from "./support/run-data";

for (const role of ROLES) {
  test.describe(`${role} session`, () => {
    test.use({ storageState: storageStatePath(role) });

    test(`${role} opens the app on its landing page`, { tag: "@golden" }, async ({ page, consoleErrors }) => {
      await page.goto("/");
      await page.waitForURL((url) => url.pathname === LANDING[role]);
      await expect(page.getByRole("main")).toHaveCount(1);
      await expect(page.getByRole("main")).toBeVisible();
      await page.waitForLoadState("load");
      expect(consoleErrors, "console errors on the landing page").toEqual([]);
    });
  });
}
