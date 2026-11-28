/**
 * J-A4 forgot password with FT-05 (V2-03 03-12a; AUTH-04b reset completion, R-5, A00-5). Runs on desktop-chrome and
 * pixel-7. A fresh member is signed in on a second browser context ("another device"); on the first, the member
 * requests a code, reads it from the local Mailpit, and tries a password the loopback fake range API lists as breached
 * (the catalogue copy is shown and the code stays used), then a clear one. The reset ends signed out on both devices
 * (ruling R-35): the member signs in again with the new password. No network beyond loopback (fixture block + server guard).
 */
import { expect, test } from "../fixtures";
import { logOffset, readLogFrom, SERVER_STDOUT_LOG } from "../support/server-log";
import {
  BREACHED_FIXTURE_PASSWORDS,
  clearPassword,
  expectSignInRefused,
  expectSignedOut,
  freshMember,
  mailCount,
  newestCode,
  otherDevice,
  uiSignIn,
} from "../support/password-journeys";

test.use({ storageState: { cookies: [], origins: [] } });

const BREACHED_COPY = "This password has appeared in a data breach. Choose a different one.";

test("J-A4: reset refuses a breached password with the catalogue copy, accepts a clear one, signs other devices out", async ({
  page,
  browser,
}) => {
  const user = await freshMember();
  const device2 = await otherDevice(browser, user);

  await page.goto("/forgot-password");
  const send = page.getByRole("button", { name: "Send code" });
  await expect(send).toBeEnabled();
  const before = await mailCount(user.email);
  await page.getByLabel(/^Email/).fill(user.email);
  await send.click();
  await expect(page.getByRole("heading", { name: "Set a new password" })).toBeVisible();
  const code = await newestCode(user.email, before);

  await page.getByLabel(/^8-digit code/).fill(code);
  await page.getByLabel(/^New password/).fill(BREACHED_FIXTURE_PASSWORDS[0]);
  await page.getByLabel(/^Confirm new password/).fill(BREACHED_FIXTURE_PASSWORDS[0]);
  await page.getByRole("button", { name: "Save new password" }).click();

  await expect(page.getByText(BREACHED_COPY)).toBeVisible();
  // The code was used (recovery session open); only the password is retried.
  await expect(page.getByLabel(/^8-digit code/)).toBeDisabled();

  const fresh = clearPassword();
  await page.getByLabel(/^New password/).fill(fresh);
  await page.getByLabel(/^Confirm new password/).fill(fresh);
  await page.getByRole("button", { name: "Save new password" }).click();

  // Ruling R-35 (03-13a, H-AUTH): the reset ends signed out on THIS device too; the user signs in with the new password.
  await expect(page.getByRole("heading", { name: "Password changed" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Your password was changed. Sign in with your new password.")).toBeVisible();
  const authCookies = (await page.context().cookies()).filter((c) => /^sb-.*-auth-token/.test(c.name) && c.value !== "");
  expect(authCookies, "no session cookie survives the reset").toEqual([]);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/login");
  await expectSignedOut(page);
  await uiSignIn(page, { email: user.email, password: fresh });

  // The other device is signed out; the new password signs in, the old one does not.
  await expectSignedOut(device2.page);
  await uiSignIn(device2.page, { email: user.email, password: fresh });
  expect(device2.blocked).toEqual([]);
  await device2.context.close();
  await expectSignInRefused(browser, user);
});

/**
 * 09E-02, staging finding of 2026-11-23: the first save of a reset stalled and the page said "We couldn't reset your password" although the outcome was
 * unknown (the retry saved). The page now never says "failed" for a save whose answer is lost: it checks the recovery session (a reset ends it) and retries
 * once when the session is still open. Two cases, each ending with the NEW password signing in (the real outcome):
 *   1. the server runs the save and the answer is lost on the way back: the page reports "Password changed" and the password changed;
 *   2. the request never reaches the server: the page retries once, the retry saves, "Password changed".
 * The server's log holds the action's own lines: `request.start` with its name and a `request.timing` line.
 */
for (const lostAfterServerRan of [true, false]) {
  test(`J-A4: a save whose answer is lost is not reported as failed (${lostAfterServerRan ? "the server ran it" : "it never arrived"})`, async ({ page }) => {
    const user = await freshMember();
    const logFrom = logOffset(SERVER_STDOUT_LOG);

    await page.goto("/forgot-password");
    const send = page.getByRole("button", { name: "Send code" });
    await expect(send).toBeEnabled();
    const before = await mailCount(user.email);
    await page.getByLabel(/^Email/).fill(user.email);
    await send.click();
    await expect(page.getByRole("heading", { name: "Set a new password" })).toBeVisible();
    const code = await newestCode(user.email, before);

    // The first Server Action call of the save loses its answer; later calls go through.
    let actionCalls = 0;
    let reachedServer = 0;
    await page.route(
      (url) => url.pathname === "/forgot-password",
      async (route) => {
        const request = route.request();
        if (request.method() !== "POST" || request.headers()["next-action"] === undefined) return route.continue();
        actionCalls += 1;
        if (actionCalls > 1) {
          reachedServer += 1;
          return route.continue();
        }
        if (lostAfterServerRan) {
          reachedServer += 1;
          await route.fetch();
        }
        return route.abort("failed");
      },
    );

    const fresh = clearPassword();
    await page.getByLabel(/^8-digit code/).fill(code);
    await page.getByLabel(/^New password/).fill(fresh);
    await page.getByLabel(/^Confirm new password/).fill(fresh);
    await page.getByRole("button", { name: "Save new password" }).click();

    await expect(page.getByRole("heading", { name: "Password changed" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("We couldn't reset your password")).toHaveCount(0);
    expect(actionCalls, lostAfterServerRan ? "no retry once the session check shows the save went through" : "one retry").toBe(lostAfterServerRan ? 1 : 2);
    expect(reachedServer).toBe(lostAfterServerRan ? 1 : 1);

    // The real outcome: the new password signs in.
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL((url) => url.pathname === "/login");
    await uiSignIn(page, { email: user.email, password: fresh });

    // The action's timing lines: its name, and a final line that ended ok.
    const lines = readLogFrom(SERVER_STDOUT_LOG, logFrom)
      .split("\n")
      .filter((l) => l.includes('"action":"auth.set_new_password_action"'))
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(lines.some((l) => l.event === "request.start" && l.timing_kind === "action")).toBe(true);
    expect(lines.some((l) => l.event === "request.timing" && l.timing_kind === "action" && l.outcome === "ok")).toBe(true);
    expect(lines.some((l) => l.event === "request.call" && l.call_kind === "auth")).toBe(true);
  });
}
