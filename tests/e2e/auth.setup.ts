/**
 * Setup project (V2-02 plan 02-03a; TEST_STRATEGY journey 1): signs each seeded tenant-A role in THROUGH THE LOGIN UI
 * with its email and the per-run password, checks it lands on its role's page, and saves the storage state that
 * every device project reuses (one sign-in per role per run keeps the local auth rate limit out of the way).
 */
import { expect, test as setup } from "./fixtures";
import { LANDING, readRunData, ROLES, runPassword, storageStatePath } from "./support/run-data";

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
