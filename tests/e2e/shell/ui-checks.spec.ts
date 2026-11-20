/**
 * 06-04b UI checks (CLAUDE.md DoD 3; plan § 06-04b "UI checks"; the shell part of the G3 set): the shell on Today,
 * Patients, a patient, the consult and Settings, for the owner and the receptionist, at 360/820/1180/1280 px: the
 * right navigation for the width (BottomBar / Rail / Sidebar; the consult keeps the Rail), the title in the display
 * face, no horizontal scroll, and axe (the M0 tags) 0 serious/critical on the shell (everything but the v1 page
 * content in `<main>`, which is the M0 report's debt and is recorded whole-page next to it). A viewport screenshot
 * per case into the git-ignored `design-captures/06-04b/ui-checks/`. desktop-chrome only (sets its own viewport).
 */
import fs from "node:fs";
import path from "node:path";
import { expect, test } from "../fixtures";
import { hasPerm } from "@/lib/permissions";
import { readRunData, storageStatePath, type E2eRole } from "../support/run-data";
import { DESIGN_WIDTHS } from "../design/support/widths";
import { axeShell, noHorizontalScroll, OUT } from "./support/shell";

const SCREENS: Array<{ slug: string; url: () => string; focusMode?: boolean; needs?: "consultations:view" }> = [
  { slug: "today", url: () => "/" },
  { slug: "patients", url: () => "/patients" },
  { slug: "patient", url: () => `/patients/${readRunData().tenantA.patientId}` },
  { slug: "consult", url: () => `/consultation/${readRunData().tenantA.visitId}`, focusMode: true, needs: "consultations:view" },
  { slug: "settings", url: () => "/settings/clinic" },
];
const ROLES_CHECKED: E2eRole[] = ["owner", "receptionist"];

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "sets its own viewport; checked once");
});

for (const role of ROLES_CHECKED) {
  test.describe(role, () => {
    test.use({ storageState: storageStatePath(role) });

    for (const w of DESIGN_WIDTHS) {
      test(`${role} at ${w.width}px: the shell on Today, Patients, a patient, the consult and Settings`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width: w.width, height: w.height });
        const whole: Record<string, Array<{ id: string; impact: string | null | undefined }>> = {};
        // The consult needs consultations:view (V2-08 08-01a, P1-07): the receptionist is redirected away from it.
        for (const screen of SCREENS.filter((s) => !s.needs || hasPerm(role, s.needs))) {
          await page.goto(screen.url());
          await expect(page.getByRole("main")).toBeVisible();
          await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);

          const nav = (kind: string) => page.locator(`[data-shell-nav=${kind}]`);
          const expectedNav = w.width < 768 ? (screen.focusMode ? null : "bottom-bar") : w.width < 1280 || screen.focusMode ? "rail" : "sidebar";
          for (const kind of ["bottom-bar", "rail", "sidebar"]) {
            if (kind === expectedNav) await expect(nav(kind), `${screen.slug} ${kind}`).toBeVisible();
            else await expect(nav(kind), `${screen.slug} ${kind}`).toBeHidden();
          }
          const title = page.locator("[data-shell-title]");
          await expect(title).toBeVisible();
          expect(await title.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/Manrope/i);
          expect(await noHorizontalScroll(page), `${screen.slug}: no horizontal scroll`).toBe(true);

          const label = `${role}-${screen.slug}-${w.width}`;
          expect(await axeShell(page, testInfo, label), `${label}: axe on the shell`).toEqual([]);
          await axeShell(page, testInfo, `${label}-whole-page`, { wholePage: true });
          whole[screen.slug] = JSON.parse(fs.readFileSync(path.join(OUT, "axe", `${label}-whole-page.json`), "utf8")).violations;

          const dir = path.join(OUT, "ui-checks");
          fs.mkdirSync(dir, { recursive: true });
          await page.screenshot({ path: path.join(dir, `${label}.png`), animations: "disabled", caret: "hide" });
        }
        await testInfo.attach("whole-page-axe.json", { body: JSON.stringify(whole, null, 2), contentType: "application/json" });
      });
    }
  });
}
