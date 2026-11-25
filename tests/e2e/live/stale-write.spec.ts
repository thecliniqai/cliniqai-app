/**
 * Stale-write refusal on screen (V2-09e 09E-07, R-19; threat T-09E-09 "a write based on a stale screen" is High).
 *
 * Two screens of one clinic: A (the receptionist, signed in through the login UI) has Today open with its Realtime frames dropped by `page.routeWebSocket`
 * (the channel stays joined, the badge says Live) and its state reads held, so it stays behind; B is the owner's session acting through the command API (what a
 * second device's click sends).
 * - cancel: B reschedules a visit; A, still showing the old time, cancels it from the row menu. A's dialog says "This changed on another device. The latest is
 *   shown.", the visit is NOT cancelled (database checked), and A's row shows the new time after its board re-read;
 * - payment: A opens the checkout drawer of a completed visit; B adds an item to its invoice; A collects. The drawer says the same, no payment exists (database
 *   checked) and the drawer shows the invoice as it is now (the new balance); the next collect, with the version the drawer then shows, goes through.
 * Synthetic data only. 0 retries: a case that only passes on retry is a defect.
 */
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { uiSignIn } from "../support/password-journeys";
import { invoicesOf, istDate, seedPatient, seedQueueToken, seedVisit, testTag } from "../support/m0-data";
import { seedBookedToday, todayName, visitStatusOf } from "../support/today-data";
import { dropBroadcastFrames, openBill, openToday, rowOf, showLane } from "../support/today-page";
import { addMemberToTenant, seededUserPassword, seedTenantWithOwner } from "../../helpers/tenants";
import { callReschedule, rescheduleArgs } from "../../helpers/scheduling-commands";
import { getAdminClient } from "../../helpers/supabase-admin";
import { formatClinicTime } from "@/lib/datetime/format";
import { ROW_CHANGED_MESSAGE } from "@/lib/errors/row-changed";

test.use({ storageState: { cookies: [], origins: [] } });

const IST = "Asia/Kolkata";

/** Clock time `HH:mm` in the clinic's zone. */
function istClock(at: Date): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: IST, hour: "2-digit", minute: "2-digit", hour12: false }).format(at);
}

/** A clinic of the test's own with a receptionist (screen A) and the owner (B, through the API), A signed in on Today with frames dropped and state reads held. */
async function screenA(page: Page) {
  const owner = await seedTenantWithOwner(`E2E Synthetic Clinic Stale ${testTag()}`);
  const receptionist = await addMemberToTenant(owner.tenantId, "receptionist");
  const clinic = { tenantId: owner.tenantId, ownerId: owner.userId, doctorId: owner.userId, createdBy: receptionist.userId };
  await dropBroadcastFrames(page);
  // The heartbeat and every other state read are held until the test lets them through: A must stay behind the database.
  let hold = true;
  await page.route("**/api/live/state", (route) => (hold ? route.abort() : route.continue()));
  await uiSignIn(page, { email: receptionist.userEmail, password: seededUserPassword() });
  await openToday(page);
  return { owner, receptionist, clinic, release: () => (hold = false) };
}

test("@golden cancel from a stale screen: refused with the fixed text, the visit is not cancelled, and A's row shows the new time after the re-read", async ({ page }) => {
  const a = await screenA(page);
  const name = todayName("Stale");
  const { visitId } = await seedBookedToday(name, "10:00", a.clinic);
  await page.reload();
  await openToday(page);
  await showLane(page, "Booked");
  await expect(rowOf(page, name)).toContainText(formatClinicTime("10:00"));

  // B moves the visit to a later time today (ten minutes from now: always in the future; when that falls past the clinic's midnight the row leaves today's board).
  const at = new Date(Date.now() + 10 * 60_000);
  const sameDay = istDate(0) === new Intl.DateTimeFormat("en-CA", { timeZone: IST, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  const moved = await callReschedule(a.owner.client, rescheduleArgs(a.owner, visitId, at.toISOString(), { p_overbook: true }));
  expect(moved.error).toBeNull();
  await page.waitForTimeout(600);
  // A has heard nothing: the old time is still on its screen.
  await expect(rowOf(page, name)).toContainText(formatClinicTime("10:00"));

  a.release();
  await rowOf(page, name).getByRole("button", { name: `More actions for ${name}` }).click();
  await page.getByRole("menuitem", { name: "Cancel appointment" }).click();
  const dialog = page.getByRole("alertdialog");
  await dialog.getByRole("button", { name: "Cancel appointment" }).click();
  await expect(dialog.getByText(ROW_CHANGED_MESSAGE)).toBeVisible();

  // Nothing was cancelled.
  expect(await visitStatusOf(visitId)).toBe("booked");
  // A's row shows the latest after the re-read it asked for.
  await dialog.getByRole("button", { name: "Keep appointment" }).click();
  if (sameDay) {
    await showLane(page, "Booked");
    await expect(rowOf(page, name)).toContainText(formatClinicTime(istClock(at)));
  } else {
    await expect(rowOf(page, name)).toHaveCount(0);
  }
  expect(await visitStatusOf(visitId)).toBe("booked");
});

test("@golden payment from a stale screen: an item added elsewhere refuses the collect, nothing is paid, the drawer shows the invoice as it is now, and the next collect goes through", async ({ page }) => {
  const a = await screenA(page);
  const { tenantId, ownerId, doctorId, createdBy } = a.clinic;
  const name = todayName("StalePay");
  const patient = await seedPatient(tenantId, ownerId, name);
  const visitId = await seedVisit({ tenantId, patientId: patient.id, doctorId, createdBy, status: "completed", signedAt: new Date().toISOString() });
  await seedQueueToken(tenantId, visitId);
  const admin = getAdminClient();
  const { data: invoice, error } = await admin
    .from("invoices")
    .insert({ tenant_id: tenantId, visit_id: visitId, patient_id: patient.id, invoice_number: `E2E-${testTag()}`, total_amount: 700, status: "issued" })
    .select("id")
    .single();
  expect(error).toBeNull();
  const item = (description: string, price: number) => ({ tenant_id: tenantId, invoice_id: invoice!.id, item_type: "procedure" as const, description, unit_price: price, quantity: 1, total_price: price });
  expect((await admin.from("invoice_items").insert(item("Synthetic consultation", 700))).error).toBeNull();

  await page.reload();
  await openToday(page);
  a.release();
  await openBill(page, name);
  const drawer = page.getByRole("heading", { name: "Patient Checkout & Billing" }).locator("xpath=ancestor::div[contains(@class,'fixed')][1]");
  await expect(drawer.getByLabel(/^Amount to Collect/)).toHaveValue("700");

  // B (another device) adds an item: the invoice's total and version move; A's drawer still shows ₹700.
  expect((await admin.from("invoice_items").insert(item("Synthetic extra", 100))).error).toBeNull();

  await drawer.getByRole("button", { name: "Collect ₹700 & Checkout" }).click();
  await expect(drawer.getByText(ROW_CHANGED_MESSAGE)).toBeVisible();
  let invoices = await invoicesOf(visitId);
  expect(invoices).toHaveLength(1);
  expect(invoices[0].payments).toEqual([]);
  // The drawer re-read the invoice: the new balance is on screen.
  await expect(drawer.getByLabel(/^Amount to Collect/)).toHaveValue("800");

  // With the version it shows now the collect goes through.
  await drawer.getByRole("button", { name: "Collect ₹800 & Checkout" }).click();
  await expect(drawer.getByRole("heading", { name: "Patient Checkout Complete" })).toBeVisible();
  await expect.poll(async () => (await invoicesOf(visitId))[0]?.status).toBe("paid");
  invoices = await invoicesOf(visitId);
  expect(invoices[0].payments).toEqual([{ amount: 800, payment_method: "cash", reference_number: null }]);
});
