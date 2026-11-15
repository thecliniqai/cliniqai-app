/**
 * PWA spec 6 (PWA_STRATEGY §3.7, §6.6, §9.1; V2-06 06-06; R-16, R-21, R-28, R-29) on the built app.
 *
 * - The page carries the e2e deployment id (`data-dpl-id`) and `/api/session-status` reports the same one, so nothing
 *   happens on load. When the status route reports another deployment (rewritten with `page.route`), a
 *   `visibilitychange` shows "A new version is ready · Reload"; "Reload" reloads (a `window` marker is gone).
 * - Safe point: with text typed into a form, a client navigation does NOT reload (the marker survives, the toast
 *   stays); with nothing typed, the next client navigation reloads by itself.
 * - Skew: a Server Action POST answered the way Next answers an action id it does not know (404 +
 *   `x-nextjs-action-not-found: 1`, read from `next/dist/client/components/router-reducer/reducers/
 *   server-action-reducer.js`, which then throws `UnrecognizedActionError`) shows "This app was updated. Reload to
 *   continue." and the typed text is still in the field; nothing reloads by itself.
 * - Lock (D-8): a clinic whose subscription expires while its owner has Today open is sent to the real
 *   `/billing/locked` page by `location.replace` on the next resume, with the auth cookie still present and no
 *   server sign-out (a real database transition, not a mocked answer: the mocked answer would bounce a full clinic's
 *   owner back to `/`).
 *
 * Service workers are off (config default): `page.route` must see the app's own requests (06-09a WebKit rule); the
 * worker side of the update (a waiting worker, SKIP_WAITING) is in tests/pwa/update.spec.ts and `e2e:sw-update`.
 * Synthetic data only.
 */
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { readRunData, storageStatePath } from "../support/run-data";
import { uiSignIn } from "../support/password-journeys";
import { logOffset, readLogFrom, SERVER_STDOUT_LOG } from "../support/server-log";
import { E2E_DEPLOYMENT_ID } from "../../setup/test-env";
import { seedTenantSubscription, seedTenantWithOwner, seededUserPassword } from "../../helpers/tenants";

const NEXT_DEPLOYMENT = "e2e-next-deployment";
const READY = "A new version is ready";
const SKEW = "This app was updated. Reload to continue.";

/** Answers `/api/session-status` with the real body but another deployment id. */
async function reportNewDeployment(page: Page): Promise<void> {
  await page.route("**/api/session-status", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as Record<string, unknown>;
    await route.fulfill({ response, json: { ...body, deploymentId: NEXT_DEPLOYMENT } });
  });
}

async function resume(page: Page): Promise<void> {
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
}

async function setMarker(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __noReload?: number }).__noReload = 1;
  });
}

async function hasMarker(page: Page): Promise<boolean> {
  return page.evaluate(() => (window as unknown as { __noReload?: number }).__noReload === 1);
}

/** A client navigation through the shell's nav (the mobile menu first when the sidebar is off-canvas). */
async function navigate(page: Page, name: string, pathname: string): Promise<void> {
  const menu = page.getByRole("button", { name: "Open mobile navigation menu" });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("link", { name, exact: true }).first().click();
  await page.waitForURL((url) => url.pathname === pathname);
}

const toast = (page: Page) => page.locator("[data-update-toast]");

test.describe("update toast and safe point (owner)", () => {
  test.use({ storageState: storageStatePath("owner") });

  test("@golden the page and the status route carry the same deployment id: no toast on load", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-dpl-id", E2E_DEPLOYMENT_ID);
    const status = await page.request.get("/api/session-status", { maxRedirects: 0 });
    expect(status.status()).toBe(200);
    expect(status.headers()["cache-control"]).toMatch(/no-store/);
    expect(await status.json()).toEqual({ deploymentId: E2E_DEPLOYMENT_ID, accessLevel: "full", redirect: null });
    await resume(page);
    await page.waitForTimeout(500);
    await expect(toast(page).getByText(READY)).toHaveCount(0);
  });

  test("@golden another deployment → the toast after a resume; Reload reloads", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-dpl-id", E2E_DEPLOYMENT_ID);
    await reportNewDeployment(page);
    await setMarker(page);
    await resume(page);
    await expect(toast(page).getByText(READY)).toBeVisible();
    await toast(page).getByRole("button", { name: "Reload" }).click();
    await expect.poll(() => hasMarker(page).catch(() => false)).toBe(false);
    await expect(page).toHaveURL((url) => url.pathname === "/");
  });

  test("typed input: a client navigation does not reload; the next navigation (nothing typed) does", async ({ page }) => {
    await page.goto("/settings/clinic");
    const name = page.getByLabel(/^Clinic Name/);
    await expect(name).toBeVisible();
    await reportNewDeployment(page);
    await resume(page);
    await expect(toast(page).getByText(READY)).toBeVisible();
    await setMarker(page);
    await name.pressSequentially(" draft");

    await navigate(page, "Patients", "/patients");
    await page.waitForTimeout(1000);
    expect(await hasMarker(page), "no reload over typed input").toBe(true);
    await expect(toast(page).getByText(READY)).toBeVisible();

    await navigate(page, "Visits", "/visits");
    await expect.poll(() => hasMarker(page).catch(() => false), { message: "reloaded at the safe point" }).toBe(false);
    await expect(page).toHaveURL((url) => url.pathname === "/visits");
  });

  test("@golden nothing typed: the next client navigation applies the update (reload)", async ({ page }) => {
    await page.goto("/");
    await reportNewDeployment(page);
    await resume(page);
    await expect(toast(page).getByText(READY)).toBeVisible();
    await setMarker(page);
    await navigate(page, "Patients", "/patients");
    await expect.poll(() => hasMarker(page).catch(() => false)).toBe(false);
    await expect(page).toHaveURL((url) => url.pathname === "/patients");
  });

  test("@golden skew: an unknown Server Action shows the notice, keeps the typed text and never reloads by itself", async ({ page }) => {
    const { patientId } = readRunData().tenantA;
    await page.goto(`/patients/${patientId}`);
    await page.getByRole("button", { name: "Edit Details" }).first().click();
    const fullName = page.getByLabel(/^Full Name/);
    await expect(fullName).toBeVisible();
    await fullName.pressSequentially(" Typed");
    const typed = await fullName.inputValue();
    await setMarker(page);

    let intercepted = 0;
    await page.route(
      (url) => url.pathname === `/patients/${patientId}`,
      async (route) => {
        const request = route.request();
        if (request.method() !== "POST" || !request.headers()["next-action"]) return route.continue();
        intercepted += 1;
        await route.fulfill({
          status: 404,
          headers: { "x-nextjs-action-not-found": "1", "content-type": "text/plain" },
          body: "Server action not found.",
        });
      },
    );
    await page.getByRole("button", { name: "Save Changes" }).click();

    await expect(toast(page).getByText(SKEW)).toBeVisible();
    expect(intercepted).toBe(1);
    await expect(fullName).toHaveValue(typed);
    await page.waitForTimeout(1500);
    expect(await hasMarker(page), "the skew notice never reloads by itself").toBe(true);
    await expect(fullName).toHaveValue(typed);
  });
});

test.describe("lock (D-8: the session is kept)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("@golden the subscription expires while Today is open → the real /billing/locked on resume, still signed in", async ({ page, context }) => {
    const owner = await seedTenantWithOwner(`PWA Lock ${readRunData().runTag} ${Date.now()}`);
    await uiSignIn(page, { email: owner.userEmail, password: seededUserPassword() });
    await expect(page.locator("html")).toHaveAttribute("data-dpl-id", E2E_DEPLOYMENT_ID);
    const offset = logOffset(SERVER_STDOUT_LOG);

    await seedTenantSubscription(owner.tenantId, { status: "expired" });
    await resume(page);

    await page.waitForURL((url) => url.pathname === "/billing/locked");
    await expect(page.getByRole("heading", { level: 1, name: "Your clinic's access is paused" })).toBeVisible();
    const authCookies = (await context.cookies()).filter((c) => /^sb-.*-auth-token/.test(c.name));
    expect(authCookies.length, "the session is kept (D-8)").toBeGreaterThan(0);
    expect(
      readLogFrom(SERVER_STDOUT_LOG, offset).split("\n").filter((l) => l.includes('"event":"auth.signout.done"')),
      "a lock is not a sign-out",
    ).toEqual([]);
  });
});
