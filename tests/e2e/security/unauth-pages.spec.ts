/**
 * TEST_STRATEGY §5 "unauthenticated access to every (dashboard) route is rejected" (V2-02 plan 02-03a).
 *
 * The routes are enumerated from the filesystem (every `app/(dashboard)/** /page.tsx`; route groups dropped, dynamic
 * segments filled with a random UUID), so a new dashboard page is covered without editing this spec. Without a
 * session, each one must end on `/login`, and neither the raw (unfollowed) response nor the final page may contain
 * any of the run's tenant data (tenant/patient names, staff emails).
 */
import { randomUUID } from "node:crypto";
import { expect, test } from "../fixtures";
import { readRunData, tenantDataMarkers } from "../support/run-data";
import { dashboardRoutes } from "../support/routes";

const ROUTES = dashboardRoutes(() => randomUUID());

test("the dashboard route enumeration found the dashboard pages", () => {
  // Guards the enumeration itself: an empty or broken walk would make every per-route test vanish.
  expect(ROUTES.map((r) => r.pattern)).toEqual(expect.arrayContaining(["/", "/patients", "/patients/[id]", "/staff"]));
});

for (const route of ROUTES) {
  test(`signed out, ${route.pattern} ends on /login with no tenant data`, async ({ page, request }) => {
    const markers = tenantDataMarkers(readRunData());

    const raw = await request.get(route.url, { maxRedirects: 0 });
    const rawBody = await raw.text();
    for (const marker of markers) expect(rawBody, `raw response of ${route.pattern}`).not.toContain(marker);

    await page.goto(route.url);
    await expect(page).toHaveURL((url) => url.pathname === "/login");
    const html = await page.content();
    for (const marker of markers) expect(html, `final page of ${route.pattern}`).not.toContain(marker);
  });
}
