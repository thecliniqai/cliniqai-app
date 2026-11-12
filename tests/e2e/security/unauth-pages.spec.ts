/**
 * TEST_STRATEGY §5 "unauthenticated access to every (dashboard) route is rejected" (V2-02 plan 02-03a).
 *
 * The routes are enumerated from the filesystem (every `app/(dashboard)/** /page.tsx`; route groups dropped, dynamic
 * segments filled with a random UUID), so a new dashboard page is covered without editing this spec. Without a
 * session, each one must end on `/login`, and neither the raw (unfollowed) response nor the final page may contain
 * any of the run's tenant data (tenant/patient names, staff emails).
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { expect, test } from "../fixtures";
import { ROOT } from "../support/app-env";
import { readRunData, tenantDataMarkers } from "../support/run-data";

const DASHBOARD_DIR = path.join(ROOT, "app", "(dashboard)");

interface DashboardRoute {
  /** Route pattern as written in the filesystem, e.g. `/patients/[id]`. */
  pattern: string;
  /** Concrete URL with dynamic segments filled. */
  url: string;
}

function dashboardRoutes(dir = DASHBOARD_DIR, segments: string[] = []): DashboardRoute[] {
  const routes: DashboardRoute[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      routes.push(...dashboardRoutes(path.join(dir, entry.name), [...segments, entry.name]));
    } else if (entry.name === "page.tsx") {
      const visible = segments.filter((s) => !/^\(.*\)$/.test(s) && !s.startsWith("@"));
      routes.push({
        pattern: `/${visible.join("/")}`,
        url: `/${visible.map((s) => (/^\[.*\]$/.test(s) ? randomUUID() : s)).join("/")}`,
      });
    }
  }
  return routes.sort((a, b) => a.pattern.localeCompare(b.pattern));
}

const ROUTES = dashboardRoutes();

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
