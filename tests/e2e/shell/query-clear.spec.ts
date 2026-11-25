/**
 * The client data layer is cleared on every exit (V2-09e 09E-03, R-14, T-09E-04; "data crossing clinics" is High).
 *
 * - Clinic switch: a MutationObserver installed in every document before the click records the text of every Today row. After the
 *   switch has been accepted, the old document holds no row of clinic A while the navigation is still held (the client was cleared
 *   before anything else), and no document opened after the click ever shows a row of clinic A.
 * - Sign-out, then another user on the same browser context: no row of the first clinic ever renders in a document opened after
 *   the sign-out.
 * - V2-09e 09E-12: the same for the Schedule's ranges: after a clinic switch and after a sign-out, no appointment of the first clinic ever renders on the
 *   Schedule (its range queries are cleared with the rest).
 * Synthetic data only; fresh clinics and users per test.
 */
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { getAdminClient } from "../../helpers/supabase-admin";
import { createDualMembershipUser, seedTenantWithOwner, seededUserPassword } from "../../helpers/tenants";
import { seedPatient, testTag } from "../support/m0-data";
import { uiSignIn } from "../support/password-journeys";

test.use({ storageState: { cookies: [], origins: [] } });

interface RowRecord {
  origin: number;
  text: string;
}

/**
 * Records every Today row's text (empty when there is none) on every mutation of every document of the page, with the document's time
 * origin. The page cannot be queried while a navigation is pending (Playwright waits for it), but this callback keeps reporting from it.
 */
async function recordRows(page: Page, selector = "[data-queue-row]"): Promise<RowRecord[]> {
  const records: RowRecord[] = [];
  await page.exposeFunction("__recordRows", (origin: number, text: string) => {
    records.push({ origin, text });
  });
  await page.addInitScript((rowSelector) => {
    const send = () => {
      const rows = Array.from(document.querySelectorAll(rowSelector)).map((el) => el.textContent ?? "");
      void (window as unknown as { __recordRows: (o: number, t: string) => Promise<void> }).__recordRows(performance.timeOrigin, rows.join("\n"));
    };
    const start = () => {
      send();
      new MutationObserver(send).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    };
    if (document.documentElement) start();
    else document.addEventListener("readystatechange", start, { once: true });
  }, selector);
  return records;
}

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

const board = (page: Page) => page.locator("[data-today-board]").filter({ visible: true });

test("clinic switch: no row of clinic A is on the old page once the switch is accepted, and none ever renders after it", async ({ page }) => {
  const tag = testTag();
  const a = await seedTenantWithOwner(`E2E Synthetic Clear Alpha ${tag}`);
  const b = await seedTenantWithOwner(`E2E Synthetic Clear Beta ${tag}`);
  const dual = await createDualMembershipUser(a.tenantId, "receptionist", b.tenantId, "receptionist");
  const nameA = `E2E Synthetic ClearRowA ${tag}`;
  const nameB = `E2E Synthetic ClearRowB ${tag}`;
  await seedWaiting(a, nameA);
  await seedWaiting(b, nameB);

  const records = await recordRows(page);
  await uiSignIn(page, { email: dual.userEmail, password: seededUserPassword() });
  await page.getByRole("button", { name: a.tenantName }).click();
  await board(page).waitFor({ timeout: 30_000 });
  await expect.poll(() => records.some((r) => r.text.includes(nameA)), { message: "the observer saw clinic A's row" }).toBe(true);

  // Hold the navigation to Today of clinic B: the old document stays on screen for a while, as it does on a slow network.
  let held = false;
  await page.route(
    (url) => url.pathname === "/today",
    async (route) => {
      if (route.request().isNavigationRequest() && held) await new Promise((resolve) => setTimeout(resolve, 3_000));
      await route.continue();
    },
  );
  const switchedAt = Date.now();
  records.push({ origin: -1, text: "<click>" });
  held = true;
  await page.getByRole("button", { name: /^Account menu/ }).click();
  await page.getByRole("menuitem", { name: `Switch to ${b.tenantName}` }).click();

  await page.waitForURL((url) => url.pathname === "/today", { timeout: 30_000 });
  await board(page).waitFor();
  await expect.poll(() => records.some((r) => r.origin > switchedAt && r.text.includes(nameB))).toBe(true);
  expect(
    records.filter((r) => r.origin > switchedAt && r.text.includes(nameA)),
    "no document opened after the switch ever rendered a row of clinic A",
  ).toEqual([]);

  // The client was cleared before the navigation: the last thing the old document reported while it waited (its navigation was held for
  // 3 s) is "no rows". Without the cleanup the old page keeps clinic A's row on screen until the new document replaces it.
  const afterClick = records.slice(records.findIndex((r) => r.origin === -1) + 1).filter((r) => r.origin < switchedAt);
  expect(afterClick.length, "the old document reported after the click").toBeGreaterThan(0);
  expect(afterClick.at(-1)?.text, "the old page held no row of clinic A once the switch was accepted").toBe("");
});

test("sign-out, then another user on the same browser: no row of the first clinic ever renders", async ({ page }) => {
  const tag = testTag();
  const a = await seedTenantWithOwner(`E2E Synthetic ClearOut Alpha ${tag}`);
  const c = await seedTenantWithOwner(`E2E Synthetic ClearOut Gamma ${tag}`);
  const nameA = `E2E Synthetic ClearOutRowA ${tag}`;
  const nameC = `E2E Synthetic ClearOutRowC ${tag}`;
  await seedWaiting(a, nameA);
  await seedWaiting(c, nameC);

  const records = await recordRows(page);
  await uiSignIn(page, { email: a.userEmail, password: seededUserPassword() });
  await board(page).waitFor({ timeout: 30_000 });
  await expect.poll(() => records.some((r) => r.text.includes(nameA))).toBe(true);

  const signedOutAt = Date.now();
  await page.getByRole("button", { name: /^Account menu/ }).click();
  await page.getByRole("menuitem", { name: "Sign out", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/login", { timeout: 30_000 });

  await uiSignIn(page, { email: c.userEmail, password: seededUserPassword() });
  await board(page).waitFor({ timeout: 30_000 });
  await expect.poll(() => records.some((r) => r.origin > signedOutAt && r.text.includes(nameC))).toBe(true);
  expect(
    records.filter((r) => r.origin > signedOutAt && r.text.includes(nameA)),
    "no document opened after the sign-out ever rendered a row of the first clinic",
  ).toEqual([]);
});

async function seedBookedToday(tenant: { tenantId: string; userId: string }, name: string): Promise<void> {
  const patient = await seedPatient(tenant.tenantId, tenant.userId, name);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const { error } = await getAdminClient().from("visits").insert({
    tenant_id: tenant.tenantId,
    patient_id: patient.id,
    doctor_id: tenant.userId,
    origin_type: "scheduled",
    status: "booked",
    scheduled_at: new Date(`${today}T23:30:00+05:30`).toISOString(),
    is_overbooked: true,
    estimated_duration_minutes: 15,
    created_by: tenant.userId,
  });
  if (error) throw new Error(`seed booked visit: ${error.message}`);
}

const scheduleShown = (page: Page) => page.locator("#main [data-schedule]");

test("09E-12: the Schedule's ranges: after a clinic switch and after a sign-out, no appointment of the first clinic ever renders", async ({ page }) => {
  const tag = testTag();
  const a = await seedTenantWithOwner(`E2E Synthetic ClearSched Alpha ${tag}`);
  const b = await seedTenantWithOwner(`E2E Synthetic ClearSched Beta ${tag}`);
  const dual = await createDualMembershipUser(a.tenantId, "receptionist", b.tenantId, "receptionist");
  const nameA = `E2E Synthetic ClearSchedA ${tag}`;
  const nameB = `E2E Synthetic ClearSchedB ${tag}`;
  await seedBookedToday(a, nameA);
  await seedBookedToday(b, nameB);

  const records = await recordRows(page, "[data-appointment]");
  await uiSignIn(page, { email: dual.userEmail, password: seededUserPassword() });
  await page.getByRole("button", { name: a.tenantName }).click();
  await board(page).waitFor({ timeout: 30_000 });
  await page.goto("/schedule?view=agenda");
  await scheduleShown(page).waitFor({ timeout: 30_000 });
  await expect.poll(() => records.some((r) => r.text.includes(nameA)), { message: "the Schedule showed clinic A's appointment" }).toBe(true);

  const switchedAt = Date.now();
  await page.getByRole("button", { name: /^Account menu/ }).click();
  await page.getByRole("menuitem", { name: `Switch to ${b.tenantName}` }).click();
  await page.waitForURL((url) => url.pathname === "/today", { timeout: 30_000 });
  await board(page).waitFor();
  // An in-app move to the Schedule (no new document): what it shows comes from the cleared data layer and a fresh read.
  await page.getByRole("link", { name: "Schedule" }).first().click();
  await page.waitForURL((url) => url.pathname === "/schedule");
  await scheduleShown(page).waitFor({ timeout: 30_000 });
  await page.goto("/schedule?view=agenda");
  await expect.poll(() => records.some((r) => r.origin > switchedAt && r.text.includes(nameB))).toBe(true);
  expect(records.filter((r) => r.origin > switchedAt && r.text.includes(nameA)), "no appointment of clinic A after the switch").toEqual([]);

  const signedOutAt = Date.now();
  await page.getByRole("button", { name: /^Account menu/ }).click();
  await page.getByRole("menuitem", { name: "Sign out", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/login", { timeout: 30_000 });
  await uiSignIn(page, { email: a.userEmail, password: seededUserPassword() });
  await board(page).waitFor({ timeout: 30_000 });
  await page.goto("/schedule?view=agenda");
  await expect.poll(() => records.some((r) => r.origin > signedOutAt && r.text.includes(nameA))).toBe(true);
  expect(records.filter((r) => r.origin > signedOutAt && r.text.includes(nameB)), "no appointment of clinic B after the sign-out").toEqual([]);
});
