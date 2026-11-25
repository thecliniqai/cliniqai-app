/**
 * V2-09e 09E-14a, finding A (independent M1, adversarial M-2): two tabs of one browser. Tab 1 switches from clinic A to clinic B; tab 2 was left open on A's Today.
 * Its next read (a live signal of A, or a check) is answered for the session's clinic, B: it must never store or render a B row under A. The client names its clinic
 * on every board and live-state read, the server answers 409 CLINIC_CHANGED, and tab 2 clears its data and loads B's Today as a new document.
 * Synthetic data only; fresh clinics and a fresh user.
 */
import { expect, test } from "../fixtures";
import { getAdminClient } from "../../helpers/supabase-admin";
import { createDualMembershipUser, seedTenantWithOwner, seededUserPassword } from "../../helpers/tenants";
import { seedPatient, testTag } from "../support/m0-data";
import { uiSignIn } from "../support/password-journeys";
import { openToday, rowInLane, showLane } from "../support/today-page";

test.use({ storageState: { cookies: [], origins: [] } });

async function seedWaiting(tenant: { tenantId: string; userId: string }, name: string): Promise<void> {
  const patient = await seedPatient(tenant.tenantId, tenant.userId, name);
  const { error } = await getAdminClient().from("visits").insert({
    tenant_id: tenant.tenantId,
    patient_id: patient.id,
    doctor_id: tenant.userId,
    origin_type: "walk_in",
    status: "waiting",
    estimated_duration_minutes: 15,
    created_by: tenant.userId,
  });
  if (error) throw new Error(`seed waiting visit: ${error.message}`);
}

test("a tab left open across a clinic switch never shows the new clinic's rows under the old clinic", async ({ page, context }) => {
  const tag = testTag();
  const a = await seedTenantWithOwner(`E2E Synthetic TwoTab Alpha ${tag}`);
  const b = await seedTenantWithOwner(`E2E Synthetic TwoTab Beta ${tag}`);
  const dual = await createDualMembershipUser(a.tenantId, "receptionist", b.tenantId, "receptionist");
  await uiSignIn(page, { email: dual.userEmail, password: seededUserPassword() });
  await page.getByRole("button", { name: a.tenantName }).click();
  await page.locator("[data-today-board]").filter({ visible: true }).waitFor({ timeout: 30_000 });

  // Tab 2 stays on A's Today; a marker on its first document and a watcher that records (in sessionStorage, which survives its reload) if a B row is ever in the DOM.
  const arrivalA = `E2E Synthetic TwoTabArrivalA ${tag}`;
  const arrivalB = `E2E Synthetic TwoTabArrivalB ${tag}`;
  const tab2 = await context.newPage();
  await openToday(tab2);
  await expect(tab2.locator("[data-live-status]")).toHaveText("Live", { timeout: 20_000 });
  await tab2.evaluate((needle) => {
    (window as unknown as { __firstDocument: boolean }).__firstDocument = true;
    sessionStorage.removeItem("sawOtherClinic");
    const check = () => {
      if (document.body.textContent?.includes(needle)) sessionStorage.setItem("sawOtherClinic", "1");
    };
    new MutationObserver(check).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  }, arrivalB);
  const boardStatuses: number[] = [];
  tab2.on("response", (r) => {
    if (r.url().includes("/api/today/board") || r.url().includes("/api/live/state")) boardStatuses.push(r.status());
  });

  // Tab 1 switches to B (the device is now pinned to B).
  await page.getByRole("button", { name: /^Account menu/ }).click();
  await page.getByRole("menuitem", { name: `Switch to ${b.tenantName}` }).click();
  await page.waitForURL((url) => url.pathname === "/today", { timeout: 30_000 });

  // A new visit in each clinic: A's signal reaches tab 2's channel; its board read is answered for B and refused.
  await seedWaiting(a, arrivalA);
  await seedWaiting(b, arrivalB);
  await tab2.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));

  // Tab 2 loads B's Today as a new document (the marker is gone) and shows B's row there; the old document never had it.
  await tab2.waitForFunction(() => !(window as unknown as { __firstDocument?: boolean }).__firstDocument, undefined, { timeout: 30_000 });
  await tab2.locator("[data-today-board]").filter({ visible: true }).waitFor({ timeout: 30_000 });
  await showLane(tab2, "Waiting");
  await expect(rowInLane(tab2, "waiting", arrivalB)).toBeVisible({ timeout: 15_000 });
  await expect(rowInLane(tab2, "waiting", arrivalA)).toHaveCount(0);
  expect(await tab2.evaluate(() => sessionStorage.getItem("sawOtherClinic")), "a B row was in the DOM of the A document").toBeNull();
  expect(boardStatuses).toContain(409);
});
