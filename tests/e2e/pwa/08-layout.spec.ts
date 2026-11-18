/**
 * PWA_STRATEGY §9.1 spec 8 (V2-06 06-04b; 06-UI-SPEC §6, §8 "Tap targets", CD-03, CD-04): no horizontal scroll at
 * 360/375/744/800/820/1180 px on Today, Patients, a patient, the consult and Settings; the BottomBar visible below 768
 * and absent at or above it (the consult, in focus mode, has none); every interactive element of the shell (top bar
 * and the visible navigation) at least 44×44 px.
 *
 * Runs on pixel-7 (a coarse pointer): the widths are phones and tablets, which are touch devices, and the approved
 * system keeps the dense 36/32 px desktop sizes for fine pointers (CD-04); the 44 px floor is the touch rule. The
 * desktop sizes are checked at 1280 on desktop-chrome against WCAG 2.5.8's 24 px.
 */
import { expect, test } from "../fixtures";
import { readRunData, storageStatePath } from "../support/run-data";
import { noHorizontalScroll, smallShellTargets } from "../shell/support/shell";

test.use({ storageState: storageStatePath("owner") });

const WIDTHS = [360, 375, 744, 800, 820, 1180];
const SCREENS: Array<{ name: string; url: () => string; focusMode?: boolean }> = [
  { name: "Today", url: () => "/" },
  { name: "Patients", url: () => "/patients" },
  { name: "a patient", url: () => `/patients/${readRunData().tenantA.patientId}` },
  { name: "the consult", url: () => `/consultation/${readRunData().tenantA.visitId}`, focusMode: true },
  { name: "Settings", url: () => "/settings/clinic" },
];

for (const screen of SCREENS) {
  test(`${screen.name}: no horizontal scroll, BottomBar by width, shell targets ≥ 44 px`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "pixel-7", "touch widths; the desktop case runs on desktop-chrome below");
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: width < 768 ? 800 : 1100 });
      await page.goto(screen.url());
      await expect(page.getByRole("main")).toBeVisible();
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
      expect(await noHorizontalScroll(page), `${screen.name} at ${width}px scrolls sideways`).toBe(true);
      const bar = page.locator("[data-shell-nav=bottom-bar]");
      if (width < 768 && !screen.focusMode) await expect(bar, `${width}px`).toBeVisible();
      else await expect(bar, `${width}px`).toBeHidden();
      expect(await smallShellTargets(page, 44), `${screen.name} at ${width}px`).toEqual([]);
    }
  });
}

test("desktop (1280, fine pointer): shell targets meet WCAG 2.5.8 (24 px); no BottomBar; no horizontal scroll", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "fine pointer");
  await page.setViewportSize({ width: 1280, height: 800 });
  for (const screen of SCREENS) {
    await page.goto(screen.url());
    await expect(page.getByRole("main")).toBeVisible();
    expect(await noHorizontalScroll(page), screen.name).toBe(true);
    await expect(page.locator("[data-shell-nav=bottom-bar]")).toBeHidden();
    expect(await smallShellTargets(page, 24), screen.name).toEqual([]);
  }
});
