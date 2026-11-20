/**
 * PWA spec 4, part 1 (PWA_STRATEGY §3.6, §9.1; V2-06 06-05). After one online visit (the worker controls the page):
 * - offline, a navigation to `/patients` shows the precached `/offline` page (no patient data on the device);
 * - on Today, going offline shows the banner ("You're offline · showing data from …") and the queue row already on
 *   screen stays visible (in memory); going online removes the banner.
 * Before 06-05: Chrome's own offline error page, and no banner.
 *
 * Part 2, the write buttons (06-02a, R-32; spec 4 complete): v1 call sites of the Button primitive, unchanged. Offline,
 * the submit buttons of the walk-in drawer ("Register & Issue Token") and the register sheet ("Register patient", V2-08 08-02)
 * are disabled (`aria-disabled`, still focusable), described by "You're offline. Changes are disabled until you
 * reconnect.", and a click does not submit the form; online again they are enabled and undescribed. Before 06-02a:
 * the buttons stayed enabled offline and a click submitted.
 */
import type { Page } from "@playwright/test";
import { expect, test, waitForServiceWorker } from "./fixtures";
import { readRunData, storageStatePath } from "../support/run-data";

const OFFLINE_REASON = "You're offline. Changes are disabled until you reconnect.";

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

  // Back online, Today re-fetches once (lib/pwa/resume.ts, router.refresh()). Wait for that RSC answer before going
  // offline again: if the network drops while it is in flight, Next falls back to a full navigation of the current URL
  // (fetch-server-response.js), which aborts the goto below (the 2026-11-20 flake, CI 44806259261).
  const refreshed = page.waitForResponse((r) => r.request().headers()["rsc"] === "1");
  await context.setOffline(false);
  await expect(banner).toHaveCount(0);
  await refreshed;
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

/** Counts `submit` events on the page's forms (a cancelled click submits nothing). */
async function countSubmits(page: Page): Promise<() => Promise<number>> {
  await page.evaluate(() => {
    const w = window as unknown as { __submits: number };
    w.__submits = 0;
    document.addEventListener("submit", () => (w.__submits += 1), true);
  });
  return () => page.evaluate(() => (window as unknown as { __submits: number }).__submits);
}

test("offline: the walk-in drawer and patient form submit buttons are disabled with the reason, and enabled again online", async ({ page, context }) => {
  // The walk-in drawer's new-patient form (the v1 queue page).
  await page.goto("/queue");
  await page.getByRole("button", { name: "+ Add Walk-In" }).click();
  const drawer = page
    .getByRole("heading", { name: "Quick Walk-In Registration" })
    .locator("xpath=ancestor::div[contains(@class,'fixed')][1]");
  await drawer.getByRole("button", { name: "New Patient" }).click();
  const issue = drawer.getByRole("button", { name: "Register & Issue Token" });
  await expect(issue).toBeEnabled();
  await expect(issue).toHaveAccessibleDescription("");
  const drawerSubmits = await countSubmits(page);

  await context.setOffline(true);
  await expect(issue).toBeDisabled();
  await expect(issue).toHaveAttribute("aria-disabled", "true");
  await expect(issue).toHaveAccessibleDescription(OFFLINE_REASON);
  await issue.focus();
  await expect(issue, "still focusable, so keyboard and screen-reader users hear why").toBeFocused();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Space");
  expect(await drawerSubmits(), "Enter or Space on the offline button submits nothing").toBe(0);

  await context.setOffline(false);
  await expect(issue).toBeEnabled();
  await expect(issue).not.toHaveAttribute("aria-disabled", /.*/);
  await expect(issue).toHaveAccessibleDescription("");

  // The patient form (the register sheet, V2-08 08-02).
  await page.goto("/patients?new=1");
  const save = page.getByRole("button", { name: "Register patient" });
  await expect(save).toBeEnabled();
  // The sheet slides in with a transition that starts after the first paint, so "no animation is running" can be true too
  // early: wait until the sheet is fully on screen, or the forced click below lands "outside of the viewport".
  const sheet = page.getByRole("dialog", { name: "Register patient" });
  await expect
    .poll(async () => {
      const box = await sheet.boundingBox();
      const view = page.viewportSize();
      return Boolean(box && view && box.x + box.width <= view.width + 1 && box.y + box.height <= view.height + 1);
    })
    .toBe(true);
  const formSubmits = await countSubmits(page);
  await context.setOffline(true);
  await expect(save).toBeDisabled();
  await expect(save).toHaveAccessibleDescription(OFFLINE_REASON);
  await page.getByLabel(/^Full name/).press("Enter"); // implicit submission is cancelled too
  // Keys on the focused button, not a forced click: on a phone the offline banner sits over the foot of the bottom sheet,
  // and a click at the button's centre would land on the banner (outside the sheet, which dismisses it).
  await save.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Space");
  expect(await formSubmits(), "neither Enter nor Space on the button submits offline").toBe(0);
  await context.setOffline(false);
  await expect(save).toBeEnabled();
  await expect(save).toHaveAccessibleDescription("");
});
