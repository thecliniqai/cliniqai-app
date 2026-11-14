/**
 * PWA spec 4, part 1 (PWA_STRATEGY §3.6, §9.1; V2-06 06-05). After one online visit (the worker controls the page):
 * - offline, a navigation to `/patients` shows the precached `/offline` page (no patient data on the device);
 * - on Today, going offline shows the banner ("You're offline · showing data from …") and the queue row already on
 *   screen stays visible (in memory); going online removes the banner.
 * The write-button part is added with 06-02a's Button primitive (R-32). Before 06-05: Chrome's own offline error page,
 * and no banner.
 */
import { expect, test, waitForServiceWorker } from "./fixtures";
import { readRunData, storageStatePath } from "../support/run-data";

test.use({ storageState: storageStatePath("owner") });

test("offline: a navigation shows the /offline page; Today keeps its rows and shows the banner until back online", async ({ page, context }) => {
  const patientName = readRunData().tenantA.patientName;
  await page.goto("/");
  await waitForServiceWorker(page);
  await page.reload(); // a controlled load, so the page's static assets are in static-v1 for the offline render
  const banner = page.getByRole("status").filter({ hasText: "You're offline" });
  const main = page.getByRole("main");
  await expect(main.getByText(/E2E Synthetic/).first()).toBeVisible();
  const onScreen = await main.innerText(); // Today's rows (synthetic patients of this run)
  await expect(banner).toHaveCount(0);

  await context.setOffline(true);
  await expect(banner).toBeVisible();
  await expect(banner).toContainText(/You're offline · showing data from \d{1,2}:\d{2}\s?(am|pm)\. Changes are disabled until you reconnect\./i);
  expect(await main.innerText(), "the rows already on screen stay (held in memory)").toBe(onScreen);

  await context.setOffline(false);
  await expect(banner).toHaveCount(0);
  expect(await main.innerText()).toBe(onScreen);

  await context.setOffline(true);
  await page.goto("/patients");
  await expect(page.getByRole("heading", { name: "You're offline" })).toBeVisible();
  await expect(page.getByText("Patient data isn't stored on this device. Reconnect to continue.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Retry" })).toHaveAttribute("href", "/");
  await expect(page.getByText(patientName)).toHaveCount(0);
  await expect(page.getByText(/E2E Synthetic/)).toHaveCount(0);
  await context.setOffline(false);
});
