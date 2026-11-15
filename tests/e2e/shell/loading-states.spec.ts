/**
 * Loading states for the pages 06-04a left without one (V2-06 06-04b; P1-28 M3 "loading for every route group";
 * 06-04a deviation 1): Today, Patients, a patient, the consult, the Live Queue, the cabin, the calendar and the
 * billing reports show the route skeleton during a slow client navigation, AND their full-page status codes are
 * unchanged by the new boundaries: a record that is not the caller's still answers 404 (journey-09's rule) and a role
 * redirect still answers 307 (the decisions run in the segment layouts above the boundaries). desktop-chrome.
 */
import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { readRunData, storageStatePath } from "../support/run-data";
import { clickNavLink, holdNavigation } from "./support/slow-navigation";

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "status codes and navigation are width-independent");
});

async function status(page: Page, url: string): Promise<{ status: number; location: string | null }> {
  const res = await page.request.get(url, { maxRedirects: 0 });
  const location = res.headers()["location"];
  return { status: res.status(), location: location ? new URL(location, "http://x").pathname : null };
}

test.describe("full-page status codes are kept", () => {
  test.describe("owner of clinic A", () => {
    test.use({ storageState: storageStatePath("owner") });

    test("another clinic's patient and visit, an unknown id and a malformed id answer 404", async ({ page }) => {
      const { tenantB } = readRunData();
      for (const url of [
        `/patients/${tenantB.patientId}`,
        `/patients/${randomUUID()}`,
        "/patients/not-a-uuid",
        `/consultation/${tenantB.visitId}`,
        `/consultation/${randomUUID()}`,
        "/consultation/not-a-uuid",
      ]) {
        expect((await status(page, url)).status, url).toBe(404);
      }
      const own = readRunData().tenantA;
      expect((await status(page, `/patients/${own.patientId}`)).status).toBe(200);
      expect((await status(page, `/consultation/${own.visitId}`)).status).toBe(200);
    });
  });

  test.describe("doctor", () => {
    test.use({ storageState: storageStatePath("doctor") });
    test("Today redirects a doctor to the cabin with 307; billing reports to Today with 307", async ({ page }) => {
      expect(await status(page, "/")).toEqual({ status: 307, location: "/cabin" });
      expect(await status(page, "/billing/reports")).toEqual({ status: 307, location: "/" });
    });
  });

  test.describe("receptionist", () => {
    test.use({ storageState: storageStatePath("receptionist") });
    test("the cabin redirects a receptionist to the Live Queue with 307", async ({ page }) => {
      expect(await status(page, "/cabin")).toEqual({ status: 307, location: "/queue" });
    });
  });
});

test.describe("the skeleton shows during a slow client navigation", () => {
  test.use({ storageState: storageStatePath("owner") });

  for (const [name, path, from] of [
    ["Dashboard", "/", "/patients"],
    ["Patients", "/patients", "/"],
    ["Live Queue", "/queue", "/"],
    ["Doctor's Cabin", "/cabin", "/"],
    ["Calendar", "/calendar", "/"],
    ["Billing & Reports", "/billing/reports", "/"],
  ] as const) {
    test(`${name} (${path})`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      const nav = await holdNavigation(page, path);
      await page.goto(from);
      await expect(page.getByRole("main")).toBeVisible();
      await clickNavLink(page, name, nav);
      await expect(page.getByRole("status", { name: "Loading" })).toBeVisible();
      nav.release();
      await page.waitForURL((url) => url.pathname === path);
      await expect(page.getByRole("status", { name: "Loading" })).toHaveCount(0, { timeout: 15_000 });
    });
  }

  test("a patient record opened from Patients", async ({ page }) => {
    const { tenantA } = readRunData();
    const path = `/patients/${tenantA.patientId}`;
    await page.setViewportSize({ width: 1280, height: 800 });
    const nav = await holdNavigation(page, path);
    await page.goto("/patients");
    // Next prefetches a link once it is in the viewport; in a long directory (other specs add patients) it may not be.
    const link = page.getByRole("main").locator(`a[href="${path}"]`).first();
    await link.scrollIntoViewIfNeeded();
    await expect(link).toBeInViewport();
    await expect.poll(nav.prefetched, { timeout: 15_000 }).toBeGreaterThan(0);
    await link.click();
    await expect(page.getByRole("status", { name: "Loading" })).toBeVisible();
    nav.release();
    await page.waitForURL((url) => url.pathname === path);
    await expect(page.getByRole("status", { name: "Loading" })).toHaveCount(0, { timeout: 15_000 });
  });
});
