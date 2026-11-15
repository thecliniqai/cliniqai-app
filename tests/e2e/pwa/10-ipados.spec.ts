/**
 * PWA spec 10 (PWA_STRATEGY §6.2, §6.3, §9.1; V2-06 06-06) on the `pwa-ipados` project: WebKit with iPadOS Safari's
 * Mac user agent, touch, and `navigator.maxTouchPoints` 5 (init script; a desktop WebKit context reports 0). The
 * base fixture keeps the browser on loopback (`routeLoopbackOnly`).
 *
 * - iPadOS (Mac UA + touch): the user menu's "Install app" opens the iOS three-step sheet ("Tap Share", "Choose Add to
 *   Home Screen", "Keep 'Open as Web App' on and tap Add" + "You'll need to sign in once inside the app"), never an
 *   Android prompt. Without the touch points (a real Mac) there is no entry at all.
 * - An `iPhone` UA does the same.
 * - A WhatsApp in-app browser UA gets "Open in Safari" guidance instead of the install steps.
 * - The Today card shows from the second signed-in browser session; "Not now" hides it (30 days, survives a reload);
 *   it never renders on /login, /clinic/new, a consult or the queue (the checkout drawer's page).
 *
 * Before 06-06: no install entry, sheet or card existed. Synthetic data only.
 */
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { readRunData, storageStatePath } from "../support/run-data";
import { settleAnimations } from "../support/settle";

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const WHATSAPP_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 WhatsApp/2.24.1";

async function touchPoints(page: Page, points: number): Promise<void> {
  await page.addInitScript((n) => {
    Object.defineProperty(Navigator.prototype, "maxTouchPoints", { configurable: true, get: () => n });
  }, points);
}

/** Device preference: this device already had one signed-in browser session (the card's "second session" rule). */
async function secondSession(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("clinicos.pref.signedInSessions")) localStorage.setItem("clinicos.pref.signedInSessions", "1");
  });
}

async function openAccountMenu(page: Page): Promise<void> {
  await page.getByRole("button", { name: /^Account menu/ }).click();
  await expect(page.getByRole("menu")).toBeVisible();
}

async function expectIosSheet(page: Page): Promise<void> {
  const sheet = page.getByRole("dialog", { name: "Install CliniQ AI on this device" });
  await expect(sheet).toBeVisible();
  await expect(sheet).toHaveAttribute("data-install-sheet", "ios");
  const steps = sheet.getByRole("list", { name: "Steps" }).getByRole("listitem");
  await expect(steps).toHaveText(["1Tap Share", "2Choose Add to Home Screen", "3Keep 'Open as Web App' on and tap Add"]);
  await expect(sheet.getByText("You'll need to sign in once inside the app.")).toBeVisible();
}

test.describe("iPadOS (Mac user agent, touch)", () => {
  test.use({ storageState: storageStatePath("owner") });

  test("Install app opens the iOS three-step sheet, never an Android prompt", async ({ page }) => {
    await touchPoints(page, 5);
    await page.goto("/");
    expect(await page.evaluate(() => navigator.maxTouchPoints)).toBe(5);
    await openAccountMenu(page);
    const entry = page.getByRole("menuitem", { name: "Install app" });
    await expect(entry).toHaveAttribute("data-install-entry", "ios-sheet");
    await entry.click();
    await expectIosSheet(page);
    await page.getByRole("button", { name: "Close" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("a real Mac (no touch points) gets no install entry", async ({ page }) => {
    await touchPoints(page, 0);
    await page.goto("/");
    await openAccountMenu(page);
    await expect(page.getByRole("menuitem", { name: "My Profile" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /Install app|Open in/ })).toHaveCount(0);
  });

  test("the Today card shows from the second session; Not now hides it for good; never on other pages", async ({ page }) => {
    await touchPoints(page, 5);
    await secondSession(page);
    await page.goto("/");
    const card = page.locator("[data-install-card]");
    await expect(card).toBeVisible();
    await expect(card.getByRole("heading", { name: "Add CliniQ AI to your Home Screen" })).toBeVisible();

    const { visitId } = readRunData().tenantA;
    for (const path of ["/clinic/new", `/consultation/${visitId}`, "/queue", "/patients"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await expect(page.locator("[data-install-card]"), path).toHaveCount(0);
    }

    await page.goto("/");
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: "Install app" }).click();
    await expectIosSheet(page);
    await page.getByRole("button", { name: "Close" }).click();
    await card.getByRole("button", { name: "Not now" }).click();
    await expect(card).toHaveCount(0);
    const until = Number(await page.evaluate(() => localStorage.getItem("clinicos.pref.installDismissedUntil")));
    expect(until - Date.now()).toBeGreaterThan(29 * 24 * 60 * 60_000);
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await settleAnimations(page);
    await expect(page.locator("[data-install-card]")).toHaveCount(0);
  });

  test("the first signed-in session shows no card", async ({ page }) => {
    await touchPoints(page, 5);
    await page.addInitScript(() => localStorage.removeItem("clinicos.pref.signedInSessions"));
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await settleAnimations(page);
    await expect(page.locator("[data-install-card]")).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem("clinicos.pref.signedInSessions"))).toBe("1");
  });
});

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("no install card on /login, even on a device past its second session", async ({ page }) => {
    await touchPoints(page, 5);
    await page.addInitScript(() => localStorage.setItem("clinicos.pref.signedInSessions", "5"));
    await page.goto("/login");
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
    await expect(page.locator("[data-install-card]")).toHaveCount(0);
  });
});

test.describe("iPhone user agent", () => {
  test.use({ storageState: storageStatePath("owner"), userAgent: IPHONE_UA });

  test("Install app opens the same iOS sheet", async ({ page }) => {
    await touchPoints(page, 5);
    await page.goto("/");
    await openAccountMenu(page);
    const entry = page.getByRole("menuitem", { name: "Install app" });
    await expect(entry).toHaveAttribute("data-install-entry", "ios-sheet");
    await entry.click();
    await expectIosSheet(page);
  });
});

test.describe("WhatsApp in-app browser (iOS)", () => {
  test.use({ storageState: storageStatePath("owner"), userAgent: WHATSAPP_UA });

  test("the entry is Open in Safari guidance, not the install steps", async ({ page }) => {
    await touchPoints(page, 5);
    await page.goto("/");
    await openAccountMenu(page);
    await expect(page.getByRole("menuitem", { name: "Install app" })).toHaveCount(0);
    const entry = page.getByRole("menuitem", { name: "Open in Safari" });
    await expect(entry).toHaveAttribute("data-install-entry", "open-in-safari");
    await entry.click();
    const sheet = page.getByRole("dialog", { name: "Open in Safari to install" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText("Choose Open in Safari (or Open in browser).")).toBeVisible();
    await expect(sheet.getByText("Tap Share")).toHaveCount(0);
  });
});
