/**
 * Toasts in the shell (V2-06 06-04b step 5; R-29, 06-UI-SPEC Toast, CD-23, CD-37).
 *
 * - The update toast (the session-status answer names another deployment) appears through the `sonner` region the
 *   shell mounts (`section[aria-live]` "Notifications"), as a `role="status"` toast with "Reload"; at 360 px it sits
 *   above the BottomBar.
 * - "Check for updates" in the More sheet with no new version toasts "You're on the latest version" (the Toaster
 *   is mounted for every app toast, not only the update toast); a failed check (offline, 503) toasts "Couldn't check
 *   for updates" (06-09c IND L-1).
 */
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { storageStatePath } from "../support/run-data";
import { E2E_DEPLOYMENT_ID } from "../../setup/test-env";
import { settleAnimations } from "../support/settle";

test.use({ storageState: storageStatePath("owner") });

test.beforeEach(({}, testInfo) => {
  test.skip(!["desktop-chrome", "pixel-7"].includes(testInfo.project.name), "desktop and touch only");
});

const READY = "A new version is ready";
/** Sonner's live region (`<section aria-label="Notifications alt+T" aria-live="polite">`; the list mounts with a toast). */
const region = (page: Page) => page.locator('section[aria-live][aria-label^="Notifications"]');

async function reportNewDeployment(page: Page): Promise<void> {
  await page.route("**/api/session-status", async (route) => {
    try {
      const response = await route.fetch();
      const body = (await response.json()) as Record<string, unknown>;
      await route.fulfill({ status: response.status(), headers: response.headers(), json: { ...body, deploymentId: "e2e-next-deployment" } });
    } catch {
      await route.abort().catch(() => undefined);
    }
  });
}

async function openAndSettle(page: Page, path: string): Promise<void> {
  const first = page.waitForResponse((res) => new URL(res.url()).pathname === "/api/session-status");
  await page.goto(path);
  await first;
  await page.waitForTimeout(100);
}

for (const width of [360, 1280]) {
  test(`at ${width}px the update toast comes through the sonner live region, role status, with Reload`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await openAndSettle(page, "/patients");
    await expect(region(page)).toHaveAttribute("aria-live", "polite");
    await reportNewDeployment(page);
    const toast = region(page).locator("[data-update-toast]");
    await expect(async () => {
      await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
      await expect(toast).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 10_000 });
    await expect(toast).toHaveAttribute("role", "status");
    await expect(toast).toHaveText(new RegExp(`^${READY}`));
    await expect(toast.getByRole("button", { name: "Reload" })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: READY })).toHaveCount(1);
    if (width < 768) {
      await settleAnimations(page);
      const bar = await page.locator("[data-shell-nav=bottom-bar]").boundingBox();
      const box = await toast.boundingBox();
      expect(box && bar && box.y + box.height <= bar.y).toBe(true);
    }
  });
}

test("Check for updates (More sheet, 360 px) with no new version: 'You're on the latest version'", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await openAndSettle(page, "/today");
  await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "More" }).click();
  const sheet = page.getByRole("dialog", { name: "More" });
  const check = sheet.getByRole("button", { name: /Check for updates/ });
  await expect(check).toContainText(`Version ${E2E_DEPLOYMENT_ID}`);
  await check.click();
  await expect(sheet).toHaveCount(0);
  const toast = region(page).getByRole("status").filter({ hasText: "You're on the latest version" });
  await expect(toast).toBeVisible();
  await expect(region(page).locator("[data-update-toast]")).toHaveCount(0);
});

// 06-09c (IND L-1): before, a check that got no answer resolved like a successful one and the toast said "You're on
// the latest version" while offline or during a server error.
for (const [label, fail] of [
  ["a network error", (route: import("@playwright/test").Route) => route.abort("internetdisconnected")],
  ["a 503", (route: import("@playwright/test").Route) => route.fulfill({ status: 503, json: { error: "unavailable" } })],
] as const) {
  test(`Check for updates when the check fails (${label}): 'Couldn't check for updates', never 'latest version'`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await openAndSettle(page, "/today");
    await page.route("**/api/session-status", fail);
    await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "More" }).click();
    const sheet = page.getByRole("dialog", { name: "More" });
    await sheet.getByRole("button", { name: /Check for updates/ }).click();
    await expect(region(page).getByRole("status").filter({ hasText: "Couldn't check for updates. Try again when you're online." })).toBeVisible();
    await expect(region(page).getByText("You're on the latest version")).toHaveCount(0);
    expect(new URL(page.url()).pathname, "no sign-out on a failed check").toBe("/today");
  });
}
