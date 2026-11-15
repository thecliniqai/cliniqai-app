/**
 * V2-06 06-09c (Wave B review fixes) on the built app, real sessions:
 *
 * - H-AUTHOUT (IND H-1, adversarial B H-1), the client half: while `/api/session-status` cannot give an answer (the
 *   route's 503 during a Supabase Auth incident, a 429, a 504, a network error), every resume leaves the page as it
 *   is: same URL, nothing concealed, the typed text still in its field, the auth cookies still there, no
 *   `POST /auth/signout` on the server. Control: the same harness with a 401 answer does sign out, so the test can see
 *   a sign-out when there is one. The server half (Auth 503/429/timeout/network → the route answers 503, a revoked
 *   session still 401) is `tests/auth/auth-outage-db.spec.ts`.
 * - M-REMOVED (adversarial B M-1): a member of two clinics who has clinic A open (the active-clinic cookie) and is
 *   removed from A is signed out and the device purged on the next resume, although clinic B is left; signing in
 *   again opens B (the sign-out forgot the active clinic: no loop). A full page load after the removal signs out too,
 *   and never renders B's shell. Before 06-09c the route answered 200 with B's level (no reaction) and the page
 *   resolved B silently (reviewer probes P1, H5).
 *
 * Service workers off (config default): `page.route` must see the app's own calls on every browser (06-09a). Fresh
 * synthetic users each test, so the shared seeded sessions are never ended.
 */
import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { readRunData } from "../support/run-data";
import { E2E_BASE_URL } from "../support/app-env";
import { uiSignIn } from "../support/password-journeys";
import { logOffset, readLogFrom, SERVER_STDOUT_LOG } from "../support/server-log";
import { getAdminClient } from "../../helpers/supabase-admin";
import { createDualMembershipUser, seedTenantWithOwner, seededUserPassword } from "../../helpers/tenants";

test.use({ storageState: { cookies: [], origins: [] } });

const AUTH_COOKIE = /^sb-[a-z0-9-]+-auth-token(?:\.\d+)?$/;
const ACTIVE_TENANT_COOKIE = "clinic_active_tenant";

async function authCookies(context: BrowserContext): Promise<string[]> {
  return (await context.cookies()).filter((c) => AUTH_COOKIE.test(c.name) && c.value).map((c) => c.name);
}

async function resume(page: Page): Promise<void> {
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
}

function serverSignOuts(offset: number): string[] {
  return readLogFrom(SERVER_STDOUT_LOG, offset)
    .split("\n")
    .filter((line) => line.includes('"event":"auth.signout.done"'));
}

/** Resumes until the session-status poll has signed the page out (a resume on a running check joins it). */
async function resumeUntilLogin(page: Page): Promise<void> {
  await expect(async () => {
    if (new URL(page.url()).pathname !== "/login") await resume(page).catch(() => undefined);
    await page.waitForURL((url) => url.pathname === "/login", { timeout: 2000 });
  }).toPass({ timeout: 20_000 });
}

test.describe("H-AUTHOUT: no answer from the status route is never a sign-out", () => {
  const FAILURES: Array<[string, (route: import("@playwright/test").Route) => Promise<void>]> = [
    ["503 unavailable (Auth down)", (route) => route.fulfill({ status: 503, json: { error: "unavailable" }, headers: { "cache-control": "private, no-store" } })],
    ["429", (route) => route.fulfill({ status: 429, json: {} })],
    ["504 gateway timeout", (route) => route.fulfill({ status: 504, body: "<html>timeout</html>", contentType: "text/html" })],
    ["network error", (route) => route.abort("internetdisconnected")],
  ];

  test("@golden 503, 429, 504 and a network error leave the page, the typed text and the session alone; a 401 still signs out", async ({
    page,
    context,
  }) => {
    const owner = await seedTenantWithOwner(`PWA Outage ${readRunData().runTag} ${Date.now()}`);
    await uiSignIn(page, { email: owner.userEmail, password: seededUserPassword() });
    await page.goto("/patients/new");
    const name = page.getByLabel(/^Patient Full Name/);
    await expect(name).toBeVisible();
    await name.fill("Synthetic Unsaved Name");
    const offset = logOffset(SERVER_STDOUT_LOG);

    let answered = 0;
    for (const [label, answer] of FAILURES) {
      await page.unroute("**/api/session-status");
      await page.route("**/api/session-status", async (route) => {
        answered += 1;
        await answer(route);
      });
      const before = answered;
      await expect(async () => {
        await resume(page);
        expect(answered, `${label}: the poll ran`).toBeGreaterThan(before);
      }).toPass({ timeout: 10_000 });
      await page.waitForTimeout(500);
      expect(new URL(page.url()).pathname, label).toBe("/patients/new");
      await expect(name, label).toHaveValue("Synthetic Unsaved Name");
      expect(await page.evaluate(() => document.documentElement.style.visibility), `${label}: not concealed`).not.toBe("hidden");
      expect(await authCookies(context), `${label}: still signed in`).not.toEqual([]);
    }
    expect(serverSignOuts(offset), "no server sign-out during the outage").toEqual([]);

    // Control: a definitive 401 does sign out (the harness sees a sign-out when there is one).
    await page.unroute("**/api/session-status");
    await page.route("**/api/session-status", (route) => route.fulfill({ status: 401, json: { error: "unauthenticated" } }));
    await resumeUntilLogin(page);
  });
});

test.describe("M-REMOVED: removed from the active clinic with another clinic left", () => {
  async function dualMember(page: Page, context: BrowserContext) {
    const tag = `${readRunData().runTag} ${Date.now()}`;
    const a = await seedTenantWithOwner(`PWA Removed A ${tag}`);
    const b = await seedTenantWithOwner(`PWA Removed B ${tag}`);
    const dual = await createDualMembershipUser(a.tenantId, "receptionist", b.tenantId, "receptionist");
    // The clinic this device has open: A (the multi-clinic switcher's cookie).
    await context.addCookies([{ name: ACTIVE_TENANT_COOKIE, value: a.tenantId, url: E2E_BASE_URL }]);
    await uiSignIn(page, { email: dual.userEmail, password: seededUserPassword() });
    await expect(page.getByText(a.tenantName).first()).toBeVisible();
    const remove = async () => {
      const { error } = await getAdminClient()
        .from("memberships")
        .update({ status: "removed", removed_at: new Date().toISOString() })
        .eq("tenant_id", a.tenantId)
        .eq("user_id", dual.userId);
      expect(error).toBeNull();
    };
    return { a, b, dual, remove };
  }

  async function dirty(page: Page) {
    await page.evaluate(() => {
      sessionStorage.setItem("draftNote", "synthetic");
      localStorage.setItem("recentPatient", "synthetic");
    });
  }

  async function expectPurgedAndSignedOut(page: Page, context: BrowserContext) {
    expect(await page.evaluate(() => [sessionStorage.getItem("draftNote"), localStorage.getItem("recentPatient")])).toEqual([null, null]);
    expect(await authCookies(context)).toEqual([]);
    expect((await context.cookies()).filter((c) => c.name === ACTIVE_TENANT_COOKIE), "the active clinic is forgotten").toEqual([]);
  }

  test("@golden on the next resume the open page signs out and purges; signing in again opens the clinic that is left", async ({ page, context }) => {
    const { b, dual, remove } = await dualMember(page, context);
    await dirty(page);
    const offset = logOffset(SERVER_STDOUT_LOG);
    await remove();
    await resumeUntilLogin(page);
    await expectPurgedAndSignedOut(page, context);
    expect(serverSignOuts(offset).length, "the session was ended on the server").toBeGreaterThan(0);

    // No loop: the next sign-in resolves the remaining clinic.
    await uiSignIn(page, { email: dual.userEmail, password: seededUserPassword() });
    await expect(page.getByText(b.tenantName).first()).toBeVisible();
  });

  test("a full page load after the removal signs out too and never shows the other clinic's shell", async ({ page, context }) => {
    const { b, remove } = await dualMember(page, context);
    await dirty(page);
    await remove();
    const seen: string[] = [];
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) seen.push(new URL(frame.url()).pathname);
    });
    await page.goto("/patients");
    await page.waitForURL((url) => url.pathname === "/login", { timeout: 20_000 });
    await expect(page.getByText(b.tenantName)).toHaveCount(0);
    expect(seen[0]).toBe("/patients");
    await expectPurgedAndSignedOut(page, context);
  });
});
