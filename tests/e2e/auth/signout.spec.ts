/**
 * V2-03 03-12b (roadmap acceptance "`POST /auth/signout` clears the session server-side and returns
 * `Clear-Site-Data: "cache"`"; AUTH-04b, PWA D-5, T-03-13), on the built app.
 *
 * A fresh synthetic member (never a shared seeded role: `global` would end their sessions) signs in through the login
 * UI on two browser contexts ("devices"). From the user menu:
 * - "Sign out": the POST answers 303 → `/login` with `Clear-Site-Data: "cache"`; the auth cookie is gone; the old
 *   refresh token fails at GoTrue (`refresh_token_not_found`) and the old access token no longer passes `getUser`
 *   (server-side revocation); replaying the old cookie to the app lands on `/login`; the other device stays signed in.
 * - "Sign out of all devices": both devices are signed out.
 * GET is 405 and a cross-origin POST is 403 (the session survives). The open menu (nurse session, never used to sign
 * out) passes axe (0 serious/critical) at 360, 820 and 1280 px with no horizontal scroll at 360 (desktop-chrome; the
 * spec sets its own viewport).
 *
 * Tokens are compared, never printed.
 */
import AxeBuilder from "@axe-core/playwright";
import type { BrowserContext, Cookie, Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "../fixtures";
import { E2E_BASE_URL } from "../support/app-env";
import { storageStatePath } from "../support/run-data";
import { expectSignedOut, freshMember, guardedContext, otherDevice, uiSignIn } from "../support/password-journeys";
import { publicEnv } from "@/lib/env";

test.use({ storageState: { cookies: [], origins: [] } });

const AUTH_COOKIE = /^(sb-[a-z0-9-]+-auth-token)(?:\.(\d+))?$/;

interface StoredSession {
  access_token: string;
  refresh_token: string;
}

async function authCookies(context: BrowserContext): Promise<Cookie[]> {
  return (await context.cookies()).filter((c) => AUTH_COOKIE.test(c.name) && c.value);
}

async function sessionOf(context: BrowserContext): Promise<StoredSession> {
  const cookies = await authCookies(context);
  expect(cookies.length, "a Supabase auth cookie is set").toBeGreaterThan(0);
  const base = AUTH_COOKIE.exec(cookies[0].name)![1];
  const whole = cookies.find((c) => c.name === base);
  const value = whole
    ? whole.value
    : cookies
        .filter((c) => c.name.startsWith(`${base}.`))
        .sort((a, b) => Number(a.name.split(".").pop()) - Number(b.name.split(".").pop()))
        .map((c) => c.value)
        .join("");
  const raw = decodeURIComponent(value);
  return JSON.parse(Buffer.from(raw.slice("base64-".length), "base64url").toString("utf8")) as StoredSession;
}

function gotrue() {
  return createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function openUserMenu(page: Page): Promise<void> {
  await page.getByRole("button", { name: /^Account menu/ }).click();
  await expect(page.getByRole("menu")).toBeVisible();
}

/** Clicks a sign-out item and returns the sign-out POST's response (the 303 itself, not the followed page). */
async function signOutVia(page: Page, item: "Sign out" | "Sign out of all devices") {
  await openUserMenu(page);
  const [response] = await Promise.all([
    page.waitForResponse((r) => new URL(r.url()).pathname === "/auth/signout" && r.request().method() === "POST"),
    page.getByRole("menuitem", { name: item, exact: true }).click(),
  ]);
  await page.waitForURL((url) => url.pathname === "/login");
  return response;
}

test("Sign out: 303 with Clear-Site-Data, cookie gone, tokens revoked at GoTrue, other device still signed in", async ({
  page,
  context,
  browser,
}) => {
  const user = await freshMember();
  await uiSignIn(page, user);
  const device2 = await otherDevice(browser, user);
  const before = await sessionOf(context);
  const oldCookies = await authCookies(context);

  const response = await signOutVia(page, "Sign out");
  expect(response.status()).toBe(303);
  expect(response.headers()["clear-site-data"]).toBe('"cache"');
  expect(new URL(response.headers()["location"], E2E_BASE_URL).pathname).toBe("/login");
  expect(response.request().postData()).toBe("scope=local");

  // The browser holds no auth cookie any more.
  expect(await authCookies(context)).toEqual([]);

  // Server-side revocation: the old refresh token is unknown to GoTrue, the old access token is refused.
  const refreshed = await gotrue().auth.refreshSession({ refresh_token: before.refresh_token });
  expect(refreshed.data.session).toBeNull();
  expect(refreshed.error?.code).toBe("refresh_token_not_found");
  const user1 = await gotrue().auth.getUser(before.access_token);
  expect(user1.data.user).toBeNull();
  expect(user1.error).not.toBeNull();

  // Replaying the old cookie to the app does not get back in.
  const replay = await guardedContext(browser);
  await replay.context.addCookies(oldCookies);
  await expectSignedOut(replay.page);
  expect(replay.blocked).toEqual([]);
  await replay.context.close();

  // `local` ends only this device's session.
  await device2.page.goto("/patients");
  await expect(device2.page).toHaveURL((url) => url.pathname === "/patients");
  expect(device2.blocked).toEqual([]);
  await device2.context.close();
});

test("Sign out of all devices: every session of the user ends", async ({ page, browser }) => {
  const user = await freshMember();
  await uiSignIn(page, user);
  const device2 = await otherDevice(browser, user);
  const theirs = await sessionOf(device2.context);

  const response = await signOutVia(page, "Sign out of all devices");
  expect(response.status()).toBe(303);
  expect(response.headers()["clear-site-data"]).toBe('"cache"');
  expect(response.request().postData()).toBe("scope=global");

  const refreshed = await gotrue().auth.refreshSession({ refresh_token: theirs.refresh_token });
  expect(refreshed.error?.code).toBe("refresh_token_not_found");
  await expectSignedOut(device2.page);
  expect(device2.blocked).toEqual([]);
  await device2.context.close();
});

test("GET is 405 and a cross-origin POST is 403; the session survives both", async ({ page, context }) => {
  const user = await freshMember();
  await uiSignIn(page, user);

  const get = await context.request.get("/auth/signout", { maxRedirects: 0 });
  expect(get.status()).toBe(405);
  const cross = await context.request.post("/auth/signout", {
    maxRedirects: 0,
    headers: { origin: "https://evil.example" },
    form: { scope: "global" },
  });
  expect(cross.status()).toBe(403);
  expect(cross.headers()["clear-site-data"]).toBeUndefined();

  await page.goto("/patients");
  await expect(page).toHaveURL((url) => url.pathname === "/patients");
  expect((await authCookies(context)).length).toBeGreaterThan(0);
});

const TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const WIDTHS = [
  { width: 360, height: 780 },
  { width: 820, height: 1180 },
  { width: 1280, height: 800 },
];

test.describe("user menu with the sign-out items", () => {
  // Read-only: the menu is opened, never used, so the shared nurse session is safe here.
  test.use({ storageState: storageStatePath("nurse") });

  for (const size of WIDTHS) {
    test(`at ${size.width}px: both items visible, 0 serious/critical axe violations`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "desktop-chrome", "sets its own viewport; checked once");
      await page.setViewportSize(size);
      await page.goto("/");
      await openUserMenu(page);
      for (const name of ["Sign out", "Sign out of all devices"]) {
        await expect(page.getByRole("menuitem", { name, exact: true })).toBeVisible();
        await expect(page.getByRole("menuitem", { name, exact: true })).toBeInViewport();
      }
      const results = await new AxeBuilder({ page }).withTags(TAGS).include('[role="menu"]').include('button[aria-label^="Account menu"]').analyze();
      await testInfo.attach(`axe-user-menu-${size.width}.json`, {
        body: JSON.stringify({ url: results.url, violations: results.violations }, null, 2),
        contentType: "application/json",
      });
      const blocking = results.violations
        .filter((v) => v.impact === "serious" || v.impact === "critical")
        .map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target.join(" ")) }));
      expect(blocking, "serious/critical axe violations").toEqual([]);
      if (size.width === 360) {
        expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
      }
      await page.screenshot({ path: testInfo.outputPath(`user-menu-${size.width}.png`) });
    });
  }
});
