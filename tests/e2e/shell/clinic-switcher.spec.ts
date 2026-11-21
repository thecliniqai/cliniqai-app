/**
 * The clinic switcher (V2-08 08-05, P1-12, R-17): a user of two clinics, real browser, built app.
 *
 * - Two clinics and none chosen on this device: "Choose a clinic" (it was the error page), axe-clean; choosing one opens its Today and pins
 *   the device with the HttpOnly, SameSite=Lax, Path=/, 400-day `clinic_active_tenant` cookie.
 * - The patient list differs after a switch (clinic A's patient is not in clinic B), the switch is from the account menu (and the sidebar
 *   at desktop width), and it is a hard navigation to Today.
 * - Realtime follows the switch: after switching to B, a visit created in B appears on Today by itself (the new clinic's private topic),
 *   and a visit created in A never does.
 * - A removed membership signs the device out (M-REMOVED is unchanged by the switcher).
 * Synthetic data only; fresh clinics and a fresh user per test.
 */
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { getAdminClient } from "../../helpers/supabase-admin";
import { createDualMembershipUser, seedTenantWithOwner, seededUserPassword } from "../../helpers/tenants";
import { seedPatient, testTag } from "../support/m0-data";
import { uiSignIn } from "../support/password-journeys";
import { storageStatePath } from "../support/run-data";
import { openToday, rowInLane, showLane } from "../support/today-page";

test.use({ storageState: { cookies: [], origins: [] } });

const COOKIE = "clinic_active_tenant";
const TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];

async function twoClinics() {
  const tag = testTag();
  const a = await seedTenantWithOwner(`E2E Synthetic Switch Alpha ${tag}`);
  const b = await seedTenantWithOwner(`E2E Synthetic Switch Beta ${tag}`);
  const dual = await createDualMembershipUser(a.tenantId, "receptionist", b.tenantId, "receptionist");
  const nameA = `E2E Synthetic SwitchPatientA ${tag}`;
  const nameB = `E2E Synthetic SwitchPatientB ${tag}`;
  await seedPatient(a.tenantId, a.userId, nameA);
  await seedPatient(b.tenantId, b.userId, nameB);
  return { tag, a, b, dual, nameA, nameB };
}

/** A walk-in already waiting in `tenant` (inserted in its final state, as the Today specs do). */
async function seedWaiting(tenant: { tenantId: string; userId: string }, name: string): Promise<void> {
  const admin = getAdminClient();
  const patient = await seedPatient(tenant.tenantId, tenant.userId, name);
  const { error } = await admin.from("visits").insert({
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

async function openAccountMenu(page: Page) {
  await page.getByRole("button", { name: /^Account menu/ }).click();
}

test("@golden two clinics: choose a clinic, the cookie pins the device, the patient list differs after a switch, Realtime follows", async ({ page, context }) => {
  const { a, b, dual, nameA, nameB, tag } = await twoClinics();
  await uiSignIn(page, { email: dual.userEmail, password: seededUserPassword() });

  // 1. No clinic chosen on this device: the picker, not an error page.
  await expect(page.getByRole("heading", { name: "Choose a clinic" })).toBeVisible();
  await expect(page.locator("[data-app-shell]")).toHaveCount(0);
  const axe = await new AxeBuilder({ page }).include("[data-clinic-picker]").withTags(TAGS).analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
  await expect(page.getByRole("button", { name: a.tenantName })).toBeVisible();
  await expect(page.getByRole("button", { name: b.tenantName })).toBeVisible();

  // 2. Choosing A opens A's Today and pins the device.
  // The lifetime is asserted on the server's Set-Cookie (Max-Age 400 days): WebKit on Linux stores at most 365 days
  // (CI 44864640479 and 44874140074, iphone-15: 365.0), so the jar only proves the cookie was kept for most of a year.
  const pinned = page.waitForResponse(async (r) =>
    (await r.headersArray()).some((h) => h.name.toLowerCase() === "set-cookie" && h.value.startsWith(`${COOKIE}=`)),
  );
  await page.getByRole("button", { name: a.tenantName }).click();
  // WebKit splits Set-Cookie at the comma of `Expires=Sun, ...`: match the joined values.
  const header = (await (await pinned).headersArray())
    .filter((h) => h.name.toLowerCase() === "set-cookie")
    .map((h) => h.value)
    .join(", ");
  expect(header, "400-day cookie").toMatch(new RegExp(`${COOKIE}=[^\\n]*?;\\s*Max-Age=34560000(;|,|$)`, "i"));
  await page.locator("[data-today-board]").waitFor({ timeout: 30_000 });
  const cookie = (await context.cookies()).find((c) => c.name === COOKIE);
  expect(cookie?.value).toBe(a.tenantId);
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/" });
  const days = ((cookie?.expires ?? 0) * 1000 - Date.now()) / 86_400_000;
  expect(days).toBeGreaterThan(364);
  expect(days).toBeLessThan(401);

  // 3. A's patient is on the list, B's is not.
  await page.goto("/patients");
  await expect(page.getByText(nameA)).toBeVisible();
  await expect(page.getByText(nameB)).toHaveCount(0);

  // 4. Switch to B from the account menu: a hard navigation to Today; the list now shows B's patient only.
  await openAccountMenu(page);
  await page.getByRole("menuitem", { name: `Switch to ${b.tenantName}` }).click();
  await page.waitForURL((url) => url.pathname === "/today", { timeout: 30_000 });
  await page.locator("[data-today-board]").waitFor();
  expect((await context.cookies()).find((c) => c.name === COOKIE)?.value).toBe(b.tenantId);
  await page.goto("/patients");
  await expect(page.getByText(nameB)).toBeVisible();
  await expect(page.getByText(nameA)).toHaveCount(0);

  // 5. Realtime follows the switch: B's new visit appears on Today by itself; A's never does.
  await openToday(page);
  await expect(page.locator("[data-live-status]")).toHaveText("Live", { timeout: 20_000 });
  const arrivalA = `E2E Synthetic SwitchArrivalA ${tag}`;
  const arrivalB = `E2E Synthetic SwitchArrivalB ${tag}`;
  await seedWaiting(a, arrivalA);
  await seedWaiting(b, arrivalB);
  await showLane(page, "Waiting");
  await expect(rowInLane(page, "waiting", arrivalB)).toBeVisible({ timeout: 15_000 });
  await expect(rowInLane(page, "waiting", arrivalA)).toHaveCount(0);
});

test("a removed membership of the chosen clinic signs the device out, whatever clinic is left", async ({ page }) => {
  const { a, b, dual } = await twoClinics();
  await uiSignIn(page, { email: dual.userEmail, password: seededUserPassword() });
  await page.getByRole("button", { name: b.tenantName }).click();
  await page.locator("[data-today-board]").waitFor({ timeout: 30_000 });

  const { error } = await getAdminClient()
    .from("memberships")
    .update({ status: "removed", removed_at: new Date().toISOString() })
    .eq("tenant_id", b.tenantId)
    .eq("user_id", dual.userId);
  expect(error).toBeNull();

  await page.goto("/today");
  await page.waitForURL((url) => url.pathname === "/login", { timeout: 30_000 });
  void a;
});

test("desktop width: the sidebar's clinic block is the switcher too", async ({ page }) => {
  const viewport = page.viewportSize();
  test.skip((viewport?.width ?? 0) < 1280, "the sidebar shows from 1280 px");
  const { a, b, dual } = await twoClinics();
  await uiSignIn(page, { email: dual.userEmail, password: seededUserPassword() });
  await page.getByRole("button", { name: a.tenantName }).click();
  await page.locator("[data-today-board]").waitFor({ timeout: 30_000 });
  await page.locator("[data-clinic-switcher]").click();
  await page.getByRole("menuitem", { name: b.tenantName }).click();
  await page.waitForURL((url) => url.pathname === "/today", { timeout: 30_000 });
  await page.locator("[data-today-board]").waitFor();
  await expect(page.locator("[data-clinic-switcher]")).toHaveAttribute("aria-label", new RegExp(b.tenantName));
});

test.describe("a user who already has a clinic", () => {
  test.use({ storageState: storageStatePath("receptionist") });

  test("/clinic/new says so with the fixed text and offers no form", async ({ page }) => {
    await page.goto("/clinic/new");
    await expect(page.getByRole("heading", { name: "You already have a clinic" })).toBeVisible();
    await expect(page.getByText("Your account already belongs to a clinic. Use the clinic switcher to change clinics.")).toBeVisible();
    await expect(page.getByLabel(/Clinic Name/)).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Go to Today" })).toHaveAttribute("href", "/today");
  });
});
