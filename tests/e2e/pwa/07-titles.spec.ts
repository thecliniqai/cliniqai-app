/**
 * V2-06 06-09a (independent review L-2): the root title template adds the product name, so a page title names it
 * once. Before 06-09a four v1 pages carried their own suffix and read "My Profile · ClinicOS · CliniQ AI".
 */
import { expect, test } from "../fixtures";
import { storageStatePath } from "../support/run-data";
import { PRODUCT_NAME } from "@/lib/design/brand";

test.use({ storageState: storageStatePath("owner") });

for (const [path, words] of [
  ["/profile", "My Profile"],
  ["/referrals", "Referrals Register"],
  ["/billing/reports", "Billing & Financial Reports"],
  ["/settings/developer", "Developer Settings"],
] as const) {
  test(`${path}: the title is "${words} · ${PRODUCT_NAME}", the brand once`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome", "metadata is device-independent");
    await page.goto(path);
    await expect(page).toHaveTitle(`${words} · ${PRODUCT_NAME}`);
    const title = await page.title();
    for (const brand of [PRODUCT_NAME, "ClinicOS", "ClinicQ"]) {
      expect(title.split(brand).length - 1, brand).toBeLessThanOrEqual(1);
    }
  });
}
