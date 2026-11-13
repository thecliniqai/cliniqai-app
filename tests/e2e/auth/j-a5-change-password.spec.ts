/**
 * J-A5 change password on /profile (V2-03 03-12a; AUTH-04b, FT-05, A00-5). Runs on desktop-chrome and pixel-7. A fresh
 * member signs in on two browser contexts; on the first, a password the loopback fake range API lists as breached is
 * refused with the catalogue copy, then a clear one is accepted with the success copy. The second context is signed
 * out, the new password signs in and the old one is refused.
 */
import { expect, test } from "../fixtures";
import {
  BREACHED_FIXTURE_PASSWORDS,
  clearPassword,
  expectSignInRefused,
  expectSignedOut,
  freshMember,
  otherDevice,
  uiSignIn,
} from "../support/password-journeys";

test.use({ storageState: { cookies: [], origins: [] } });

const BREACHED_COPY = "This password has appeared in a data breach. Choose a different one.";
const SUCCESS_COPY = "Password changed. Other devices were signed out.";

test("J-A5: change password refuses a breached password, accepts a clear one and signs the other device out", async ({
  page,
  browser,
}) => {
  const user = await freshMember();
  await uiSignIn(page, user);
  const device2 = await otherDevice(browser, user);

  await page.goto("/profile");
  const form = page.locator("form", { has: page.getByRole("button", { name: "Change password" }) });
  const submit = form.getByRole("button", { name: "Change password" });
  await expect(submit).toBeEnabled();
  await expect(form).toHaveAttribute("method", "post");

  // A mismatched confirmation is caught before the server is asked.
  await form.getByLabel(/^Current password/).fill(user.password);
  await form.getByLabel(/^New password/).fill(BREACHED_FIXTURE_PASSWORDS[1]);
  await form.getByLabel(/^Confirm new password/).fill(`${BREACHED_FIXTURE_PASSWORDS[1]}x`);
  await submit.click();
  await expect(form.getByText("Passwords do not match")).toBeVisible();

  await form.getByLabel(/^Confirm new password/).fill(BREACHED_FIXTURE_PASSWORDS[1]);
  await submit.click();
  await expect(form.getByText(BREACHED_COPY)).toBeVisible();

  const fresh = clearPassword();
  await form.getByLabel(/^New password/).fill(fresh);
  await form.getByLabel(/^Confirm new password/).fill(fresh);
  await submit.click();
  await expect(form.getByText(SUCCESS_COPY)).toBeVisible();
  await expect(form.getByLabel(/^Current password/)).toHaveValue("");

  // This device stays signed in; the other one is signed out.
  await page.reload();
  await expect(page).toHaveURL((url) => url.pathname === "/profile");
  await expectSignedOut(device2.page);
  expect(device2.blocked).toEqual([]);
  await device2.context.close();

  // The new password signs in; the old one is refused.
  const again = await otherDevice(browser, { email: user.email, password: fresh });
  await again.context.close();
  await expectSignInRefused(browser, user);
});
