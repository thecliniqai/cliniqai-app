/**
 * J-A4 forgot password with FT-05 (V2-03 03-12a; AUTH-04b reset completion, R-5, A00-5). Runs on desktop-chrome and
 * pixel-7. A fresh member is signed in on a second browser context ("another device"); on the first, the member
 * requests a code, reads it from the local Mailpit, and tries a password the loopback fake range API lists as breached
 * (the catalogue copy is shown and the code stays used), then a clear one. The reset ends signed out on both devices
 * (ruling R-35): the member signs in again with the new password. No network beyond loopback (fixture block + server guard).
 */
import { expect, test } from "../fixtures";
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
