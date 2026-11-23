/**
 * V2-09d (request speed): the Supabase round-trip ceiling of the busiest screens, in the PR lane (desktop-chrome only; the
 * count does not depend on the device). Staging pays ~300-450 ms per call between the app and the database, so the number
 * of calls is what a click costs.
 *
 * Counted from the local stack's Kong access log between two markers (`support/kong-calls.ts`); only the app server's
 * calls count (the browser's own, such as the realtime socket, are reported but not budgeted). The receptionist:
 *
 * - an in-app navigation (what a click on a link does) resolves the session and the clinic context without any Supabase
 *   call: no `/auth/v1/user`, no `my_tenant_access`, no membership read for the context; Patients stays within 3 calls
 *   and Today within 6;
 * - a full load of Today stays within 12 calls, of which the shell's on-load status check (the one fresh check) is the
 *   only `/auth/v1/user` and the only `my_tenant_access`.
 *
 * Before V2-09d the same counts were 27 calls for a Patients full load (10 `/auth/v1/user`) and 26 for Today (8 + 6).
 * The full per-page report is `npm run perf:roundtrips` (tests/e2e/perf/page-roundtrips.spec.ts).
 */
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { countKongCalls } from "../support/kong-calls";
import { storageStatePath } from "../support/run-data";

test.use({ storageState: storageStatePath("receptionist") });

async function settled(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
}

async function softNavigate(page: Page, url: string): Promise<void> {
  const target = new URL(url, page.url());
  await page.evaluate((href) => (window as unknown as { next: { router: { push(h: string): void } } }).next.router.push(href), url);
  await page.waitForURL((u) => u.pathname === target.pathname);
  await settled(page);
  await page.waitForTimeout(300);
  await settled(page);
}

const count = (byPath: Record<string, number>, key: string) => byPath[key] ?? 0;

test.describe("V2-09d request budget (receptionist)", () => {
  const desktopOnly = () => test.skip(test.info().project.name !== "desktop-chrome", "the count does not depend on the device");

  test("in-app navigation: no identity or context call; Patients <= 3, Today <= 6", async ({ page }) => {
    desktopOnly();
    await page.goto("/today");
    await settled(page);
    // Warm-up: the first in-app navigation of a page may fetch what later ones reuse; the budget is per navigation.
    await softNavigate(page, "/patients");
    await softNavigate(page, "/today");

    const patients = await countKongCalls(() => softNavigate(page, "/patients"));
    expect(new URL(page.url()).pathname).toBe("/patients");
    expect(count(patients.serverByPath, "GET /auth/v1/user"), JSON.stringify(patients.serverByPath)).toBe(0);
    expect(count(patients.serverByPath, "POST /rest/v1/rpc/my_tenant_access"), JSON.stringify(patients.serverByPath)).toBe(0);
    expect(count(patients.serverByPath, "GET /rest/v1/memberships"), JSON.stringify(patients.serverByPath)).toBe(0);
    expect(patients.server, JSON.stringify(patients.serverByPath)).toBeLessThanOrEqual(3);

    const today = await countKongCalls(() => softNavigate(page, "/today"));
    expect(new URL(page.url()).pathname).toBe("/today");
    expect(count(today.serverByPath, "GET /auth/v1/user"), JSON.stringify(today.serverByPath)).toBe(0);
    expect(count(today.serverByPath, "POST /rest/v1/rpc/my_tenant_access"), JSON.stringify(today.serverByPath)).toBe(0);
    expect(today.server, JSON.stringify(today.serverByPath)).toBeLessThanOrEqual(6);
  });

  test("full load of Today: <= 12 calls; the on-load status check is the only Auth and access-level call", async ({ page }) => {
    desktopOnly();
    await page.goto("/today");
    await settled(page);
    const full = await countKongCalls(async () => {
      await page.goto("/today");
      await settled(page);
    });
    expect(new URL(page.url()).pathname).toBe("/today");
    expect(count(full.serverByPath, "GET /auth/v1/user"), JSON.stringify(full.serverByPath)).toBeLessThanOrEqual(1);
    expect(count(full.serverByPath, "POST /rest/v1/rpc/my_tenant_access"), JSON.stringify(full.serverByPath)).toBeLessThanOrEqual(1);
    expect(full.server, JSON.stringify(full.serverByPath)).toBeLessThanOrEqual(12);
  });
});
