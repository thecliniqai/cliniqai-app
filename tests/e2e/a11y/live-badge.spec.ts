/**
 * The live badge's states are axe clean at 360, 820 and 1280 px (V2-09e 09E-04, R-18): Reconnecting (never confirmed), Reconnecting with "Updated N s ago",
 * and Live. The Realtime socket is refused until the spec allows it, and the page clock is driven so the states are reached without waiting.
 * Synthetic data only; a clinic of the test's own.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "../fixtures";
import { uiSignIn } from "../support/password-journeys";
import { ownClinic } from "../support/today-data";
import { openToday } from "../support/today-page";
import { seededUserPassword } from "../../helpers/tenants";

test.use({ storageState: { cookies: [], origins: [] } });

const HEARTBEAT_MS = 12_000;
const badge = (page: import("@playwright/test").Page) => page.locator("[data-live-status]");

for (const width of [360, 820, 1280]) {
  test(`the badge's three states are axe clean at ${width} px`, async ({ page }) => {
    await page.clock.install();
    let allow = false;
    await page.routeWebSocket(/\/realtime\//, (ws) => {
      if (!allow) {
        void ws.close({ code: 1008, reason: "refused by the spec" });
        return;
      }
      const server = ws.connectToServer();
      ws.onMessage((m) => server.send(m));
      server.onMessage((m) => ws.send(m));
    });
    await page.setViewportSize({ width, height: 900 });
    await uiSignIn(page, { email: (await ownClinic()).owner.email, password: seededUserPassword() });
    await openToday(page);
    const scan = async (state: string) => {
      await expect(badge(page).filter({ visible: true }).first()).toHaveAttribute("data-live-status", state, { timeout: 20_000 });
      const results = await new AxeBuilder({ page }).include("[data-live-status]").analyze();
      expect(results.violations, `${state} at ${width}px`).toEqual([]);
    };
    await scan("reconnecting");
    await page.clock.runFor(HEARTBEAT_MS + 500);
    await expect(badge(page)).toContainText(/Updated \d+ s ago/);
    await scan("reconnecting");
    allow = true;
    await page.clock.runFor(40_000);
    await scan("live");
  });
}
