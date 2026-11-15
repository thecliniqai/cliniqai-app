/**
 * V2-05 05-10b (SUB-02 UX, SUB §7.2 item 3, PWA §9.1 spec 1 non-redirect part): locked and onboarding clinics in the
 * browser, on the PR lane's three device projects (the @golden tests; axe on desktop-chrome and pixel-7).
 *
 * The run seeds a locked clinic (expired; owner + receptionist) and an onboarding clinic (`incomplete`; owner), and
 * the setup project signs their users in (tests/e2e/support/run-data.ts `ACCESS_USERS`).
 *
 * - A locked owner opening `/` or a deep link lands on `/billing/locked`; a locked receptionist on
 *   `/billing/locked/staff`; an onboarding owner on `/onboarding/billing`. No such page load writes a
 *   `request.error` line (the page loaders answer the lock with the same redirect, `withPageAuth`).
 * - For a locked user, `/api/health`, the locked pages themselves and the PWA asset paths answer without a redirect
 *   (no loop; the redirect lives only in the `(dashboard)` layout). V2-06 06-06: the asset paths answer 200 (was "not
 *   3xx" while they did not exist), as the 05-10b handover asked.
 * - The page's "Sign out" ends a locked user's session and lands on `/login`. V2-06 06-06: it runs `hardSignOut()`
 *   (server revocation, the device purge, `/login`), so the session cookie is gone and a planted non-preference
 *   `localStorage` key is purged.
 * - axe 0 serious/critical (WCAG 2.0/2.1/2.2 A+AA) on the three pages at 360/820/1280, no horizontal scroll at 360,
 *   screenshots attached.
 *
 * Synthetic data only.
 */
import AxeBuilder from "@axe-core/playwright";
import type { Page, Response, TestInfo } from "@playwright/test";
import { expect, test } from "../fixtures";
import {
  ACCESS_LANDING,
  accessRunUser,
  accessStatePath,
  readRunData,
  runPassword,
  type AccessUser,
} from "../support/run-data";
import { logOffset, readLogFrom, SERVER_STDERR_LOG, SERVER_STDOUT_LOG } from "../support/server-log";

const TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const BLOCKING_IMPACTS = new Set(["serious", "critical"]);
const WIDTHS = [
  { width: 360, height: 780 },
  { width: 820, height: 1180 },
  { width: 1280, height: 800 },
];
const SOME_ID = "00000000-0000-4000-8000-0000000010b0";

const HEADINGS: Record<AccessUser, string> = {
  "locked-owner": "Your clinic's access is paused",
  "locked-receptionist": "Your clinic's subscription is inactive",
  "onboarding-owner": "Finish setting up your clinic",
};

/** The deep links each user opens (dashboard pages of every kind: list, detail, guard-backed, settings). */
const DEEP_LINKS: Record<AccessUser, string[]> = {
  "locked-owner": ["/", "/patients", `/patients/${SOME_ID}`, "/settings/billing", "/billing/reports", "/queue"],
  "locked-receptionist": ["/", "/queue", "/calendar", `/consultation/${SOME_ID}`, "/staff"],
  "onboarding-owner": ["/", "/patients", "/calendar", "/settings/clinic"],
};

/** PWA_STRATEGY §3.1 public assets (they exist from V2-06 06-05); for a locked user they must never redirect. */
const PWA_ASSET_PATHS = ["/manifest.webmanifest", "/sw.js", "/offline", "/icon.svg", "/apple-icon.png"];

/** Opens each path and expects the user's destination; no `request.error` line for any of these requests. */
async function expectLandsOn(page: Page, paths: string[], destination: string): Promise<void> {
  const outOffset = logOffset(SERVER_STDOUT_LOG);
  const errOffset = logOffset(SERVER_STDERR_LOG);
  const requestIds: string[] = [];
  const onResponse = (res: Response) => {
    if (res.request().resourceType() !== "document") return;
    const id = res.headers()["x-request-id"];
    if (id) requestIds.push(id);
  };
  page.on("response", onResponse);
  try {
    for (const path of paths) {
      await page.goto(path);
      await expect(page, `${path} → ${destination}`).toHaveURL((url) => url.pathname === destination);
      await expect(page.getByRole("main")).toBeVisible();
    }
  } finally {
    page.off("response", onResponse);
  }
  expect(requestIds.length, "the page loads carried request ids").toBeGreaterThanOrEqual(paths.length);
  // Give the server a moment to flush its log lines for the last request.
  await page.waitForTimeout(250);
  const printed = readLogFrom(SERVER_STDOUT_LOG, outOffset) + readLogFrom(SERVER_STDERR_LOG, errOffset);
  const errorLines = printed
    .split("\n")
    .filter((line) => line.includes('"event":"request.error"') && requestIds.some((id) => line.includes(id)));
  expect(errorLines, "request.error lines for the locked/onboarding page loads").toEqual([]);
}

type AxeResults = Awaited<ReturnType<AxeBuilder["analyze"]>>;

function seriousOrCritical(results: AxeResults) {
  return results.violations
    .filter((v) => BLOCKING_IMPACTS.has(v.impact ?? ""))
    .map((v) => ({ id: v.id, impact: v.impact, help: v.help, targets: v.nodes.map((n) => n.target.join(" ")) }));
}

async function checkLayout(page: Page, testInfo: TestInfo, name: string, width: number): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  await testInfo.attach(`axe-${name}.json`, {
    body: JSON.stringify({ url: new URL(results.url).pathname, violations: results.violations }, null, 2),
    contentType: "application/json",
  });
  await testInfo.attach(`screenshot-${name}.png`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  expect(seriousOrCritical(results), `serious/critical axe violations on ${name}`).toEqual([]);
  if (width === 360) {
    const scrolls = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(scrolls, "horizontal scroll at 360px").toBe(false);
  }
}

for (const user of ["locked-owner", "locked-receptionist", "onboarding-owner"] as const) {
  test.describe(`${user} (${ACCESS_LANDING[user]})`, () => {
    test.use({ storageState: accessStatePath(user) });

    test(`@golden opening / or a deep link lands on ${ACCESS_LANDING[user]}`, async ({ page }) => {
      const run = readRunData();
      await expectLandsOn(page, DEEP_LINKS[user], ACCESS_LANDING[user]);
      await expect(page.getByRole("heading", { level: 1, name: HEADINGS[user] })).toBeVisible();
      const clinic = user === "onboarding-owner" ? run.access.onboarding.name : run.access.locked.name;
      await expect(page.getByText(clinic, { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
      // No dashboard chrome and no link into it.
      await expect(page.getByRole("navigation")).toHaveCount(0);

      if (user === "locked-owner") {
        await expect(page.getByText("Expired", { exact: true })).toBeVisible();
        await expect(page.getByText("Your clinic's data is safe. Nothing has been deleted.")).toBeVisible();
        await expect(page.getByText("Renewal and export open with billing (V2-13b/V2-13c).")).toBeVisible();
      }
      if (user === "locked-receptionist") {
        await expect(page.getByText("Your clinic's subscription is inactive; contact the owner.")).toBeVisible();
        await expect(page.getByText("Expired", { exact: true })).toHaveCount(0);
      }
    });

    test(`@golden health, its own page and the PWA asset paths answer without a redirect`, async ({ page }) => {
      const health = await page.request.get("/api/health", { maxRedirects: 0 });
      expect(health.status()).toBe(200);

      const own = await page.request.get(ACCESS_LANDING[user], { maxRedirects: 0 });
      expect(own.status(), `${ACCESS_LANDING[user]} for its own user`).toBe(200);

      for (const path of PWA_ASSET_PATHS) {
        const res = await page.request.get(path, { maxRedirects: 0 });
        const location = res.headers()["location"] ?? "";
        expect(res.status(), `${path} answered ${res.status()} → ${location}`).toBe(200);
      }
    });

    test(`the page passes axe at 360/820/1280 with no horizontal scroll`, async ({ page }, testInfo) => {
      await page.goto(ACCESS_LANDING[user]);
      await expect(page.getByRole("heading", { level: 1, name: HEADINGS[user] })).toBeVisible();
      for (const size of WIDTHS) {
        await page.setViewportSize(size);
        await checkLayout(page, testInfo, `${user}-${testInfo.project.name}-${size.width}`, size.width);
      }
    });
  });
}

test.describe("sign-out from a locked page", () => {
  // A fresh session (never the shared storage state, which every device project reuses).
  test.use({ storageState: { cookies: [], origins: [] } });

  test("signed out, the three pages are protected by the proxy's default deny (307 to /login?next=…)", async ({ page }) => {
    for (const path of ["/billing/locked", "/billing/locked/staff", "/onboarding/billing"]) {
      const res = await page.request.get(path, { maxRedirects: 0 });
      expect(res.status(), path).toBe(307);
      const location = new URL(res.headers()["location"] ?? "", "http://127.0.0.1");
      expect(location.pathname, path).toBe("/login");
      expect(location.searchParams.get("next"), path).toBe(path);
    }
  });

  test("@golden a locked receptionist signs out from the staff page and lands on /login", async ({ page }) => {
    const user = accessRunUser(readRunData(), "locked-receptionist");
    await page.goto("/login");
    await page.getByLabel(/^Email/).fill(user.email);
    await page.getByLabel(/^Password/).fill(runPassword());
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL((url) => url.pathname === "/billing/locked/staff", { timeout: 30_000 });
    // V2-06 06-06: hardSignOut() purges the device (D-5); a planted non-preference key must not survive.
    await page.evaluate(() => {
      localStorage.setItem("recentPatient", "synthetic");
      localStorage.setItem("clinicos.pref.density", "compact");
    });

    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL((url) => url.pathname === "/login");
    const keys = await page.evaluate(() => Object.keys(localStorage).sort());
    expect(keys, "purged except the device preferences").not.toContain("recentPatient");
    expect(keys).toContain("clinicos.pref.density");
    expect((await page.context().cookies()).filter((c) => /^sb-.*-auth-token/.test(c.name)), "no auth cookie").toEqual([]);
    // The session is gone: a dashboard page now asks for sign-in again (checked below).
    // The session is gone: a dashboard page now asks for sign-in again.
    await page.goto("/queue");
    await expect(page).toHaveURL((url) => url.pathname === "/login");
  });

  // V2-06 06-06: the locked page's sign-out is hardSignOut(), so it ends the session on this device even offline (the
  // server call fails, the browser client and the cookie expiry sign this device out). The plain form POST it replaced
  // cannot leave an offline page at all: the auth cookie stayed. Chromium only (Playwright's WebKit cannot navigate
  // offline at all, 06-09a).
  test("offline, the locked page's sign-out still signs this device out (hardSignOut's local path)", async ({ page, context, browserName }) => {
    test.skip(browserName !== "chromium", "Playwright WebKit cannot navigate while emulating offline (06-09a)");
    const user = accessRunUser(readRunData(), "locked-receptionist");
    await page.goto("/login");
    await page.getByLabel(/^Email/).fill(user.email);
    await page.getByLabel(/^Password/).fill(runPassword());
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL((url) => url.pathname === "/billing/locked/staff", { timeout: 30_000 });
    const authCookies = async () => (await context.cookies()).filter((c) => /^sb-.*-auth-token/.test(c.name));
    expect((await authCookies()).length).toBeGreaterThan(0);

    await context.setOffline(true);
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect.poll(authCookies, { message: "no auth cookie after an offline sign-out", timeout: 15_000 }).toEqual([]);
    await context.setOffline(false);
    await page.goto("/queue");
    await expect(page).toHaveURL((url) => url.pathname === "/login");
  });
});
