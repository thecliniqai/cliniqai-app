/**
 * Smoke (V2-02 plan 02-03a; PWA-08a "projects run green on a smoke spec"): on every device project, each seeded role's
 * saved session opens the app, lands on its role's page, renders exactly one main landmark, logs no console error and
 * makes no blocked (non-loopback) request (the fixture fails the test otherwise).
 */
import { expect, test } from "./fixtures";
import { LANDING, ROLES, storageStatePath } from "./support/run-data";

/**
 * The one console message accepted, on WebKit only, by exact text (06-09b; CI run 43616771232). Linux WebKit (CI's
 * iphone-15 project; macOS WebKit stays silent) logs it as an error for the root viewport's
 * `interactive-widget=resizes-content` (app/layout.tsx, 06-05). The key stays: on Chrome Android (default since 108:
 * `resizes-visual`) it is what makes the on-screen keyboard shrink the layout viewport, so the `h-app`/`min-h-app`
 * (100dvh) shell and its sticky bottom actions stay above the keyboard (PWA_STRATEGY §3.3 "Keyboard"); Safari ignores
 * the key, which is what this message says. Any other console error, on any browser, still fails the test.
 */
const WEBKIT_UNKNOWN_VIEWPORT_KEY = 'Viewport argument key "interactive-widget" not recognized and ignored.';

for (const role of ROLES) {
  test.describe(`${role} session`, () => {
    test.use({ storageState: storageStatePath(role) });

    test(`${role} opens the app on its landing page`, { tag: "@golden" }, async ({ page, consoleErrors, browserName }) => {
      await page.goto("/");
      await page.waitForURL((url) => url.pathname === LANDING[role]);
      await expect(page.getByRole("main")).toHaveCount(1);
      await expect(page.getByRole("main")).toBeVisible();
      await page.waitForLoadState("load");
      const unexpected =
        browserName === "webkit" ? consoleErrors.filter((message) => message !== WEBKIT_UNKNOWN_VIEWPORT_KEY) : consoleErrors;
      expect(unexpected, "console errors on the landing page").toEqual([]);
    });
  });
}
