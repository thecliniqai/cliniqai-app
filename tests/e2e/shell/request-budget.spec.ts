/**
 * V2-09d (request speed): the Supabase round-trip ceiling of the busiest screens, in the PR lane (desktop-chrome only; the
 * count does not depend on the device). Staging pays ~300-450 ms per call between the app and the database, so the number
 * of calls is what a click costs.
 *
 * Counted from the local stack's Kong access log between two markers (`support/kong-calls.ts`); only the app server's
 * calls count (the browser's own, such as the realtime socket, are reported but not budgeted). The receptionist:
 *
 * - an in-app navigation (what a click on a link does) resolves the session and the clinic context without any Supabase
 *   call: no `/auth/v1/user`, no `my_tenant_access`, and on Patients no `memberships` read at all (on Today the one
 *   `memberships` read is the doctor directory, page data);
 * - a full load of Today: the shell's on-load status check (the one fresh check) is the only `/auth/v1/user` and the
 *   only `my_tenant_access`; `memberships` at most 3 (shell clinic list, status check, doctor directory).
 *
 * Only the identity/context calls are budgeted here: they do not depend on the clinic's data. The page-data calls do (a
 * full PR run leaves tenant A with many patients, so Patients' link prefetches of `/patients/[id]` read 11 more rows, and
 * Today's billing lanes add invoice/payment/follow-up reads); the per-page totals are in the perf report.
 *
 * Before V2-09d the same counts were 27 calls for a Patients full load (10 `/auth/v1/user`) and 26 for Today (8 + 6).
 * The full per-page report is `npm run perf:roundtrips` (tests/e2e/perf/page-roundtrips.spec.ts).
 *
 * 09D-01a (A-5): deterministic. The zero-call budgets hold only once the device has its session-context cookie, which
 * only the shell's on-load `/api/session-status` issues (after hydration): each test waits for that cookie before its
 * measured window and fails with a clear message if it never comes (never a red-then-green on retry); the live views'
 * background refreshes are held while it measures (they are page data, and their timing is not the navigation's). The Kong container
 * comes from `supabase/config.toml`, only Kong's access log (stdout) is read, only the calls between this test's own markers
 * count, and the spec never retries (`retries: 0`, a pass on retry would hide a defect).
 */
import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { randomUUID } from "node:crypto";
import { countKongCalls, kongContainerName, mark, readKongLog } from "../support/kong-calls";
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

/** The session-context cookie: `clinic_ctx` on this plain-http loopback server (`__Host-clinic_ctx` only when Secure). */
const CONTEXT_COOKIE = "clinic_ctx";

/**
 * Waits until the shell's status check has issued the device's session-context cookie (bounded; fails, never skips). The
 * shell checks once after hydration; if that check fails (a slow or refused answer on a loaded runner) it retries after
 * 15-22.5 s (`RETRY_DELAYS_MS[0]` with its jitter, `lib/pwa/session-status.ts`), so the bound covers the first retry.
 */
async function contextCookieIssued(context: BrowserContext): Promise<void> {
  await expect
    .poll(async () => (await context.cookies()).some((c) => c.name === CONTEXT_COOKIE && c.value !== ""), {
      message: "the shell's /api/session-status never issued the session-context cookie (is SESSION_CONTEXT_SECRET set on the e2e server?)",
      intervals: [250, 500, 1_000],
      timeout: 30_000,
    })
    .toBe(true);
}

/**
 * Holds the live views' background refreshes for the rest of the test. The Today board (a Realtime signal, or its 20 s poll
 * until the channel is SUBSCRIBED) and the shell's resume refresh call `router.refresh()` only after their liveness probe
 * `/api/health` answers (`lib/pwa/safe-refresh.ts`); refusing the probe keeps the screen as it is. Such a refresh re-renders
 * the route and re-prefetches the navigation links (page data), and one that lands inside a measured window adds calls
 * the navigation did not make (seen: a second Today render and a patient-page prefetch, when the status check was slow).
 */
async function holdLiveRefreshes(page: Page): Promise<void> {
  await page.route("**/api/health", (route) => route.fulfill({ status: 503, body: "" }));
}

test.describe("V2-09d request budget (receptionist)", () => {
  test.describe.configure({ retries: 0 });
  const desktopOnly = () => test.skip(test.info().project.name !== "desktop-chrome", "the count does not depend on the device");

  test("the measuring tool: the Kong container from config.toml, and one marker is one access-log line", async () => {
    desktopOnly();
    expect(kongContainerName('project_id = "clinicos"\n[api]\nport = 54321\n')).toBe("supabase_kong_clinicos");
    expect(() => kongContainerName("[api]\n")).toThrow(/project_id/);
    const since = new Date(Date.now() - 60_000).toISOString();
    const id = `probe-${randomUUID()}`;
    await mark(id);
    await expect
      .poll(() => readKongLog(since).split("\n").filter((l) => l.includes(`/__clinicos_perf_mark/${id} `)).length, { timeout: 10_000 })
      .toBe(1);
    // Still one a moment later (a marker is never counted twice).
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(readKongLog(since).split("\n").filter((l) => l.includes(`/__clinicos_perf_mark/${id} `))).toHaveLength(1);
  });

  test("in-app navigation: no identity or context call (Patients, Today)", async ({ page }) => {
    desktopOnly();
    test.setTimeout(90_000);
    // The storage state may carry a context cookie from the setup's sign-in, close to its 300 s end: start without it, so
    // the measured requests use the one this page's own status check issues.
    await page.context().clearCookies({ name: CONTEXT_COOKIE });
    await page.goto("/today");
    await settled(page);
    await contextCookieIssued(page.context());
    await holdLiveRefreshes(page);
    // Warm-up: the first in-app navigation of a page may fetch what later ones reuse; the budget is per navigation.
    await softNavigate(page, "/patients");
    await softNavigate(page, "/today");

    const patients = await countKongCalls(() => softNavigate(page, "/patients"));
    expect(new URL(page.url()).pathname).toBe("/patients");
    expect(count(patients.serverByPath, "GET /auth/v1/user"), JSON.stringify(patients.serverByPath)).toBe(0);
    expect(count(patients.serverByPath, "POST /rest/v1/rpc/my_tenant_access"), JSON.stringify(patients.serverByPath)).toBe(0);
    expect(count(patients.serverByPath, "GET /rest/v1/memberships"), JSON.stringify(patients.serverByPath)).toBe(0);

    const today = await countKongCalls(() => softNavigate(page, "/today"));
    expect(new URL(page.url()).pathname).toBe("/today");
    expect(count(today.serverByPath, "GET /auth/v1/user"), JSON.stringify(today.serverByPath)).toBe(0);
    expect(count(today.serverByPath, "POST /rest/v1/rpc/my_tenant_access"), JSON.stringify(today.serverByPath)).toBe(0);
    expect(count(today.serverByPath, "GET /rest/v1/memberships"), JSON.stringify(today.serverByPath)).toBeLessThanOrEqual(1);
  });

  test("full load of Today: the on-load status check is the only Auth and access-level call", async ({ page }) => {
    desktopOnly();
    test.setTimeout(90_000);
    // The storage state may carry a context cookie from the setup's sign-in, close to its 300 s end: start without it, so
    // the measured requests use the one this page's own status check issues.
    await page.context().clearCookies({ name: CONTEXT_COOKIE });
    await page.goto("/today");
    await settled(page);
    await contextCookieIssued(page.context());
    await holdLiveRefreshes(page);
    const full = await countKongCalls(async () => {
      await page.goto("/today");
      await settled(page);
    });
    expect(new URL(page.url()).pathname).toBe("/today");
    expect(count(full.serverByPath, "GET /auth/v1/user"), JSON.stringify(full.serverByPath)).toBeLessThanOrEqual(1);
    expect(count(full.serverByPath, "POST /rest/v1/rpc/my_tenant_access"), JSON.stringify(full.serverByPath)).toBeLessThanOrEqual(1);
    expect(count(full.serverByPath, "GET /rest/v1/memberships"), JSON.stringify(full.serverByPath)).toBeLessThanOrEqual(3);
  });
});
