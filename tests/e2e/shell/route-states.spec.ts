/**
 * V2-06 06-04a step 3 (P1-28 M3 route states; T-06-19): the not-found, loading and error states.
 *
 * - `notFound()` in a dashboard page (`/patients/<random uuid>`) renders the dashboard not-found inside the shell (the
 *   header stays) with HTTP 404, static text only (the id is not echoed), marked `noindex`.
 * - A URL no route matches renders the root not-found outside the shell, with HTTP 404.
 * - A client navigation to `/visits` whose RSC response is held back 1.5 s (matched by the `RSC` request header) shows
 *   the loading skeleton (`status` "Loading") inside the shell, then the page.
 * - The diagnostic render error shows the error state with "Try again" and never the error's message.
 */
import { randomUUID } from "node:crypto";
import { expect, test } from "../fixtures";
import { storageStatePath } from "../support/run-data";
import { clickNavLink, holdNavigation } from "./support/slow-navigation";

test.use({ storageState: storageStatePath("owner") });

test("a dashboard notFound() renders the dashboard not-found inside the shell", async ({ page }) => {
  const id = randomUUID();
  const response = await page.goto(`/patients/${id}`);
  expect(response?.status()).toBe(404);
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await expect(page.getByRole("banner")).toBeVisible();
  await expect(main.getByRole("link", { name: "Go to Today" })).toHaveAttribute("href", "/");
  await expect(page.locator('meta[name="robots"][content*="noindex"]')).toHaveCount(1);
  expect(await page.locator("body").innerText()).not.toContain(id);
});

test("an unmatched URL renders the root not-found outside the shell with HTTP 404", async ({ page }) => {
  const response = await page.goto("/no-such-page");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(page.getByRole("banner")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Go to the home page" })).toHaveAttribute("href", "/");
});

test("a slow client navigation shows the loading skeleton inside the shell, then the page", async ({ page }) => {
  const nav = await holdNavigation(page, "/visits", 1_500);
  await page.goto("/");
  await expect(page.getByRole("main")).toBeVisible();
  await clickNavLink(page, "Visits", nav);
  await expect(page.getByRole("status", { name: "Loading" })).toBeVisible();
  await expect(page.getByRole("banner")).toBeVisible();
  await page.waitForURL((url) => url.pathname === "/visits");
  await expect(page.getByRole("status", { name: "Loading" })).toHaveCount(0, { timeout: 15_000 });
  expect(nav.held()).toBeGreaterThan(0);
});

test("the diagnostic render error shows the error state with Try again and no message", async ({ page }) => {
  await page.goto("/diag/client-error");
  await page.getByRole("button", { name: "Throw a render error" }).click();
  await expect(page.getByRole("heading", { name: "Something went wrong" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Something went wrong" })).toBeFocused();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(page.getByRole("banner")).toBeVisible();
  const text = await page.locator("body").innerText();
  expect(text).not.toContain("Diagnostic client render error");
  expect(text).not.toContain("diag.client@example.com");
});
