/**
 * Setup project (V2-02 plan 02-03a; TEST_STRATEGY journey 1): signs each seeded tenant-A role in THROUGH THE LOGIN UI
 * with its email and the per-run password, checks it lands on its role's page, and saves the storage state that
 * every device project reuses (one sign-in per role per run keeps the local auth rate limit out of the way). V2-05
 * 05-10b adds the locked and onboarding clinics' users (`ACCESS_USERS`).
 */
import { expect, test as setup } from "./fixtures";
import {
  ACCESS_LANDING,
  ACCESS_USERS,
  accessRunUser,
  accessStatePath,
  LANDING,
  readRunData,
  ROLES,
  runPassword,
  storageStatePath,
} from "./support/run-data";

for (const role of ROLES) {
  setup(`${role} signs in through the login UI`, async ({ page }) => {
    const user = readRunData().tenantA.users[role];

    await page.goto("/login");
    await page.getByLabel(/^Email/).fill(user.email);
    await page.getByLabel(/^Password/).fill(runPassword());
    await page.getByRole("button", { name: "Sign in", exact: true }).click();

    await page.waitForURL((url) => url.pathname === LANDING[role], { timeout: 30_000 });
    await expect(page.getByRole("main")).toBeVisible();
    await page.context().storageState({ path: storageStatePath(role) });
  });
}

// V2-05 05-10b (SUB-02): the locked and onboarding clinics' users sign in the same way; the dashboard layout sends each
// to its locked/onboarding page (the first proof of the redirect), and the state is kept for the locked-user specs.
for (const accessUser of ACCESS_USERS) {
  setup(`${accessUser} signs in through the login UI and lands on ${ACCESS_LANDING[accessUser]}`, async ({ page }) => {
    const user = accessRunUser(readRunData(), accessUser);

    await page.goto("/login");
    await page.getByLabel(/^Email/).fill(user.email);
    await page.getByLabel(/^Password/).fill(runPassword());
    await page.getByRole("button", { name: "Sign in", exact: true }).click();

    await page.waitForURL((url) => url.pathname === ACCESS_LANDING[accessUser], { timeout: 30_000 });
    await expect(page.getByRole("main")).toBeVisible();
    await page.context().storageState({ path: accessStatePath(accessUser) });
  });
}
