/**
 * PWA spec 7 (PWA_STRATEGY §9.1; V2-08 08-01a, PWA-06b): idempotent retry after the server committed but the response
 * was lost. The harness (`support/commit-then-abort.ts`) lets the Server Action POST reach the server, then aborts the
 * response. `useCommand` retries once with the same `client_request_id` (R-20); the server replays the first result.
 *
 * Payment leg (this plan), on the current checkout drawer:
 *   1. the response is lost once: the automatic retry succeeds; exactly one invoice and one payment exist;
 *   2. every attempt is lost (the payment and the reload that follows): the form keeps its values and shows an error;
 *      after the route is cleared a manual retry gives exactly one invoice and one payment.
 * Walk-in leg (08-03b), a NEW patient in the walk-in sheet, where the patient, the visit and the token are one command:
 *   3. the response is lost once: the automatic retry succeeds; exactly one patient, one visit and one token exist;
 *   4. every attempt is lost: the sheet keeps what was typed and says so; the server committed once; after the route is
 *      cleared a manual retry changes nothing (still one patient, one visit, one token; no orphan patient).
 * Booking leg (08-04b), a NEW patient in the booking sheet, where the patient and the visit are one command (`register_and_book`):
 *   5. the response is lost once: the automatic retry succeeds; exactly one patient and one booked visit exist;
 *   6. every attempt is lost: the sheet keeps what was typed and says so; the server committed once; after the route is cleared
 *      "Retry" (the form's own submit, same request id) changes nothing (still one patient, one visit; no orphan patient).
 * Synthetic data only.
 */
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { freeBookingDate, invoicesOf, istInstant, patientsByName, run, seedPatient, seedQueueToken, seedVisit, syntheticPhoneDigits, testTag, tokenOf, visitsOf } from "../support/m0-data";
import { storageStatePath } from "../support/run-data";
import { commitThenAbort } from "../support/commit-then-abort";
import { openBill, openToday } from "../support/today-page";
import { openBookingSheet, setSlot } from "../support/schedule-page";

test.use({ storageState: storageStatePath("receptionist") });

function checkoutDrawer(page: Page): Locator {
  return page
    .getByRole("heading", { name: "Patient Checkout & Billing" })
    .locator("xpath=ancestor::div[contains(@class,'fixed')][1]");
}

/** A completed, signed visit with no invoice, open in the checkout drawer with a UPI reference typed. */
async function openCheckout(page: Page, utr: string): Promise<{ visitId: string; drawer: Locator }> {
  const { tenantA } = run();
  const patientName = `E2E Synthetic Retry ${testTag()}`;
  const patient = await seedPatient(tenantA.id, tenantA.users.owner.id, patientName);
  const visitId = await seedVisit({
    tenantId: tenantA.id,
    patientId: patient.id,
    doctorId: tenantA.users.doctor.id,
    createdBy: tenantA.users.receptionist.id,
    status: "completed",
    signedAt: new Date().toISOString(),
  });
  await seedQueueToken(tenantA.id, visitId);

  await openToday(page);
  await openBill(page, patientName);
  const drawer = checkoutDrawer(page);
  await expect(drawer).toBeVisible();
  await drawer.getByLabel(/^OPD Consultation Fee/).fill("600");
  await expect(drawer.getByLabel(/^Amount to Collect/)).toHaveValue("600");
  await drawer.getByRole("button", { name: "UPI / QR" }).click();
  await drawer.getByLabel("UPI UTR / Reference ID").fill(utr);
  return { visitId, drawer };
}

test.describe("payment: the response is lost after the commit", () => {
  test("lost once: the automatic retry succeeds with exactly one invoice and one payment", async ({ page }) => {
    const utr = `E2ERETRY${Date.now()}`;
    const { visitId, drawer } = await openCheckout(page, utr);
    const cut = await commitThenAbort(page, { first: 1, matches: (r) => (r.postData() ?? "").includes(utr) });

    await drawer.getByRole("button", { name: "Collect ₹600 & Checkout" }).click();
    await expect(drawer.getByRole("heading", { name: "Patient Checkout Complete" })).toBeVisible({ timeout: 20_000 });
    expect(cut.aborted).toBe(1);
    await cut.clear();

    const invoices = await invoicesOf(visitId);
    expect(invoices).toHaveLength(1);
    expect(invoices[0].status).toBe("paid");
    expect(invoices[0].payments).toEqual([{ amount: 600, payment_method: "upi", reference_number: utr }]);
  });

  test("lost on every attempt: the form keeps its values and shows an error; a manual retry after the route is cleared gives one invoice and one payment", async ({ page }) => {
    const utr = `E2ERETRY${Date.now()}`;
    const { visitId, drawer } = await openCheckout(page, utr);
    // Every Server Action is cut: the payment, its automatic retry, and the reload that checks what was saved.
    const cut = await commitThenAbort(page, { first: "all" });

    await drawer.getByRole("button", { name: "Collect ₹600 & Checkout" }).click();
    await expect(drawer.getByText(/Could not confirm whether the payment was saved/)).toBeVisible({ timeout: 30_000 });
    // The form is still there with what the user typed; nothing says the checkout is complete.
    await expect(drawer.getByRole("heading", { name: "Patient Checkout Complete" })).toHaveCount(0);
    await expect(drawer.getByLabel("UPI UTR / Reference ID")).toHaveValue(utr);
    await expect(drawer.getByLabel(/^Amount to Collect/)).toHaveValue("600");
    expect(cut.aborted).toBeGreaterThanOrEqual(2);
    await cut.clear();

    // The server committed the first attempt, once.
    expect(await invoicesOf(visitId)).toHaveLength(1);

    await drawer.getByRole("button", { name: "Collect ₹600 & Checkout" }).click();
    await expect(drawer.getByRole("heading", { name: "Patient Checkout Complete" })).toBeVisible({ timeout: 20_000 });

    const invoices = await invoicesOf(visitId);
    expect(invoices).toHaveLength(1);
    expect(invoices[0].status).toBe("paid");
    expect(invoices[0].payments).toEqual([{ amount: 600, payment_method: "upi", reference_number: utr }]);
  });
});

/** The walk-in sheet with a NEW patient typed in, ready to submit; the patient's name is unique to the test. */
async function openNewcomer(page: Page): Promise<{ name: string; sheet: Locator }> {
  const name = `E2E Synthetic Retry Walk-in ${testTag()}`;
  await openToday(page, "/today?walkin=1");
  const sheet = page.getByRole("dialog", { name: "Add walk-in" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText("Loading doctors…")).toHaveCount(0);
  await sheet.getByRole("combobox", { name: "Patient" }).fill(name);
  await sheet.getByRole("option", { name: /Register as new patient/ }).click();
  await sheet.getByRole("textbox", { name: "Mobile number" }).fill(syntheticPhoneDigits());
  await sheet.getByRole("textbox", { name: "Age" }).fill("33");
  await sheet.getByRole("radio", { name: "Male", exact: true }).click();
  return { name, sheet };
}

/** One patient, one walk-in visit, one token: what a committed walk-in leaves, however often the request was sent. */
async function expectOneWalkIn(name: string): Promise<string> {
  const { tenantA } = run();
  const patients = await patientsByName(tenantA.id, name);
  expect(patients, "exactly one patient (no orphan from a retry)").toHaveLength(1);
  const visits = await visitsOf(tenantA.id, patients[0].id);
  expect(visits).toHaveLength(1);
  expect(visits[0]).toMatchObject({ origin_type: "walk_in", status: "waiting" });
  expect(await tokenOf(visits[0].id)).not.toBeNull();
  return visits[0].id;
}

test.describe("walk-in: the response is lost after the commit", () => {
  test("lost once: the automatic retry succeeds with one patient, one visit and one token", async ({ page }) => {
    const { name, sheet } = await openNewcomer(page);
    const cut = await commitThenAbort(page, { first: 1, matches: (r) => (r.postData() ?? "").includes(name) });

    await sheet.getByRole("button", { name: "Register and add to queue" }).click();
    await expect(page.getByRole("dialog", { name: "Add walk-in" })).toHaveCount(0, { timeout: 30_000 });
    expect(cut.aborted).toBe(1);
    await cut.clear();
    await expectOneWalkIn(name);
  });

  test("lost on every attempt: the sheet keeps its values and shows an error; a manual retry after the route is cleared adds nothing", async ({ page }) => {
    const { name, sheet } = await openNewcomer(page);
    const cut = await commitThenAbort(page, { first: "all", matches: (r) => (r.postData() ?? "").includes(name) });

    await sheet.getByRole("button", { name: "Register and add to queue" }).click();
    await expect(sheet.getByText(/Couldn't save/)).toBeVisible({ timeout: 40_000 });
    await expect(page.getByRole("dialog", { name: "Add walk-in" })).toBeVisible();
    await expect(sheet.getByRole("textbox", { name: "Full name" })).toHaveValue(name);
    expect(cut.aborted).toBeGreaterThanOrEqual(2);
    await cut.clear();

    // The server committed the first attempt, once.
    await expectOneWalkIn(name);

    await sheet.getByRole("button", { name: "Retry" }).click();
    await expect(page.getByRole("dialog", { name: "Add walk-in" })).toHaveCount(0, { timeout: 30_000 });
    await expectOneWalkIn(name);
  });
});

/** The booking sheet with a NEW patient typed in and a 10:00 slot chosen, ready to submit; the patient's name is unique to the test. */
async function openBookingNewcomer(page: Page, ux: import("../support/ux-counter").UxCounter): Promise<{ name: string; sheet: Locator; date: string }> {
  const { tenantA } = run();
  const name = `E2E Synthetic Retry Booking ${testTag()}`;
  const date = await freeBookingDate(tenantA.id, tenantA.users.doctor.id);
  const sheet = await openBookingSheet(page, ux, date);
  await sheet.getByRole("combobox", { name: "Patient" }).fill(name);
  await sheet.getByRole("option", { name: /Register as new patient/ }).click();
  await setSlot(sheet, ux, "10:00", tenantA.users.doctor.id);
  await sheet.getByRole("textbox", { name: "Mobile number" }).fill(syntheticPhoneDigits());
  await sheet.getByRole("textbox", { name: "Age" }).fill("36");
  await sheet.getByRole("radio", { name: "Female", exact: true }).click();
  return { name, sheet, date };
}

/** One patient and one booked visit at 10:00 IST on `date`: what a committed booking leaves, however often the request was sent. */
async function expectOneBooking(name: string, date: string): Promise<void> {
  const { tenantA } = run();
  const patients = await patientsByName(tenantA.id, name);
  expect(patients, "exactly one patient (no orphan from a retry)").toHaveLength(1);
  const visits = await visitsOf(tenantA.id, patients[0].id);
  expect(visits).toHaveLength(1);
  expect(visits[0]).toMatchObject({ origin_type: "scheduled", status: "booked", is_overbooked: false });
  expect(new Date(visits[0].scheduled_at!).toISOString()).toBe(istInstant(date, "10:00"));
}

test.describe("booking: the response is lost after the commit", () => {
  test("lost once: the automatic retry succeeds with one patient and one booked visit", async ({ page, ux }) => {
    const { name, sheet, date } = await openBookingNewcomer(page, ux);
    const cut = await commitThenAbort(page, { first: 1, matches: (r) => (r.postData() ?? "").includes(name) });

    await sheet.getByRole("button", { name: "Register and book" }).click();
    await expect(page.getByRole("dialog", { name: "Book appointment" })).toHaveCount(0, { timeout: 30_000 });
    expect(cut.aborted).toBe(1);
    await cut.clear();
    await expectOneBooking(name, date);
  });

  test("lost on every attempt: the sheet keeps its values and shows an error; Retry after the route is cleared adds nothing", async ({ page, ux }) => {
    const { name, sheet, date } = await openBookingNewcomer(page, ux);
    const cut = await commitThenAbort(page, { first: "all", matches: (r) => (r.postData() ?? "").includes(name) });

    await sheet.getByRole("button", { name: "Register and book" }).click();
    await expect(sheet.getByText(/Couldn't save/)).toBeVisible({ timeout: 40_000 });
    await expect(page.getByRole("dialog", { name: "Book appointment" })).toBeVisible();
    await expect(sheet.getByRole("textbox", { name: "Full name" })).toHaveValue(name);
    expect(cut.aborted).toBeGreaterThanOrEqual(2);
    await cut.clear();

    // The server committed the first attempt, once.
    await expectOneBooking(name, date);

    await sheet.getByRole("button", { name: "Retry" }).click();
    await expect(page.getByRole("dialog", { name: "Book appointment" })).toHaveCount(0, { timeout: 30_000 });
    await expectOneBooking(name, date);
  });
});
