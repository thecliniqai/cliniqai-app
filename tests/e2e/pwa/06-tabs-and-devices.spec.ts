/**
 * V2-06 06-09a: sign-out across tabs and devices (PWA_STRATEGY §4 D-5; T-06-03), on desktop Chromium, Pixel 7 and the
 * WebKit iPhone 15 (`@golden`). Each case uses a fresh synthetic nurse, so the shared seeded sessions are never ended.
 *
 * - M-TABS: signing out in one tab sends every other open tab of the device to `/login` within 2 s, with the patient
 *   gone from its screen (before 06-09a: the second tab kept the patient record on screen indefinitely, adversarial
 *   review A, M-2).
 * - M-EVERYWHERE: "Sign out of all devices" never reports a success it did not get. With the app's sign-out route
 *   unreachable but GoTrue reachable, the browser client revokes every session and device 2 is signed out; with GoTrue
 *   unreachable too, this device is still signed out and the user is told the other devices are not (device 2 really
 *   is still signed in: the notice is the truth). Before 06-09a: a silent this-device-only sign-out (review A, M-1).
 * - IND L-6: a session that ended without `hardSignOut()` (here: its cookies are gone, as after the proxy's H-AUTH
 *   revocation or a reset's global sign-out) purges the device on arrival at `/login`, and other tabs leave.
 */
import type { Page } from "@playwright/test";
import {
  authCookies,
  deviceState,
  expect,
  test,
  waitForServiceWorker,
} from "./fixtures";
import { readRunData } from "../support/run-data";
import {
  freshMember,
  otherDevice,
  uiSignIn,
  expectSignedOut,
} from "../support/password-journeys";
import { PARTIAL_SIGN_OUT_NOTICE } from "@/lib/auth/hard-sign-out";

test.use({ storageState: { cookies: [], origins: [] } });

async function menuItem(page: Page, name: string) {
  await page.getByRole("button", { name: /^Account menu/ }).click();
  await expect(page.getByRole("menu")).toBeVisible();
  return page.getByRole("menuitem", { name, exact: true });
}

async function openPatient(page: Page) {
  const { patientId, patientName } = readRunData().tenantA;
  await page.goto(`/patients/${patientId}`);
  await expect(page.getByText(patientName).first()).toBeVisible();
}

test("M-TABS: signing out in one tab sends the other tab to /login within 2 s, patient gone @golden", async ({
  page,
  context,
}) => {
  const user = await freshMember();
  await uiSignIn(page, user);
  await waitForServiceWorker(page);
  const tab2 = await context.newPage();
  await openPatient(tab2);

  await (await menuItem(page, "Sign out")).click();
  const clicked = Date.now();
  await expect(tab2).toHaveURL((url) => url.pathname === "/login", {
    timeout: 2_000,
  });
  expect(
    Date.now() - clicked,
    "the second tab left within 2 s"
  ).toBeLessThanOrEqual(2_000);
  await expect(tab2.getByText(readRunData().tenantA.patientName)).toHaveCount(
    0
  );
  await page.waitForURL((url) => url.pathname === "/login");
  expect(await authCookies(context)).toEqual([]);
  // The tab that heard the signal purged too (sessionStorage is per tab).
  expect((await deviceState(tab2)).sessionKeys).toEqual([]);
});

// These two cases intercept the app's own calls with page.route; on WebKit a worker-controlled page sends them past the
// route (fixtures.ts), so the worker is off here: the cases test the sign-out logic, not the worker.
test.describe("M-EVERYWHERE (no service worker: page.route must see the app's calls on every browser)", () => {
  test.use({ serviceWorkers: "block" });

  test("M-EVERYWHERE: route unreachable, GoTrue reachable: the browser client revokes every session; device 2 is signed out @golden", async ({
    page,
    context,
    browser,
  }) => {
    const user = await freshMember();
    await uiSignIn(page, user);
    const device2 = await otherDevice(browser, user);
    await page.route("**/auth/signout", (route) => route.abort("timedout"));

    await (await menuItem(page, "Sign out of all devices")).click();
    await page.waitForURL((url) => url.pathname === "/login");
    expect(
      new URL(page.url()).search,
      "no partial notice: every session was revoked"
    ).toBe("");
    await expect(page.getByText(PARTIAL_SIGN_OUT_NOTICE)).toHaveCount(0);
    expect(await authCookies(context)).toEqual([]);
    await expectSignedOut(device2.page);
    expect(device2.blocked).toEqual([]);
    await device2.context.close();
  });

  test("M-EVERYWHERE: neither the route nor GoTrue reachable: this device is signed out and the user is told; device 2 is not @golden", async ({
    page,
    context,
    browser,
  }) => {
    const user = await freshMember();
    await uiSignIn(page, user);
    const device2 = await otherDevice(browser, user);
    await page.route("**/auth/signout", (route) => route.abort("timedout"));
    await page.route("**/auth/v1/logout**", (route) => route.abort("timedout"));

    await (await menuItem(page, "Sign out of all devices")).click();
    await page.waitForURL(
      (url) =>
        url.pathname === "/login" &&
        url.searchParams.get("signout") === "partial"
    );
    await expect(page.getByText(PARTIAL_SIGN_OUT_NOTICE)).toBeVisible();
    expect(
      await authCookies(context),
      "this device is signed out anyway"
    ).toEqual([]);
    // The notice is the truth: the other device still has its session.
    await device2.page.goto("/patients");
    await expect(device2.page).toHaveURL((url) => url.pathname === "/patients");
    await device2.context.close();
  });
});

test("IND L-6: a session ended without hardSignOut purges the device on arrival at /login; other tabs leave @golden", async ({
  page,
  context,
}) => {
  const user = await freshMember();
  await uiSignIn(page, user);
  await waitForServiceWorker(page);
  const tab2 = await context.newPage();
  await openPatient(tab2);
  await page.evaluate(async () => {
    localStorage.setItem("clinicos.pref.density", "compact");
    localStorage.setItem("recentPatient", "synthetic");
    await (
      await caches.open("rogue-cache")
    ).put("/api/patients", new Response("synthetic api"));
  });

  // The server ended the session (proxy revocation, reset sign-out): the cookies are gone, no hardSignOut ran.
  await context.clearCookies();
  await page.goto("/patients");
  await expect(page).toHaveURL((url) => url.pathname === "/login");
  await expect
    .poll(async () => (await deviceState(page)).localKeys)
    .toEqual(["clinicos.pref.density"]);
  expect((await deviceState(page)).cacheNames).not.toContain("rogue-cache");
  await expect(tab2).toHaveURL((url) => url.pathname === "/login", {
    timeout: 2_000,
  });
  await expect(tab2.getByText(readRunData().tenantA.patientName)).toHaveCount(
    0
  );
});
