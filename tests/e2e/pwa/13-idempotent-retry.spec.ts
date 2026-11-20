/**
 * PWA spec 7 (PWA_STRATEGY §9.1; V2-08 08-01a, PWA-06b): idempotent retry after the server committed but the response
 * was lost. The harness (`support/commit-then-abort.ts`) lets the Server Action POST reach the server, then aborts the
 * response. `useCommand` retries once with the same `client_request_id` (R-20); the server replays the first result.
 *
 * Payment leg (this plan), on the current checkout drawer:
 *   1. the response is lost once: the automatic retry succeeds; exactly one invoice and one payment exist;
 *   2. every attempt is lost (the payment and the reload that follows): the form keeps its values and shows an error;
 *      after the route is cleared a manual retry gives exactly one invoice and one payment.
 * Walk-in and booking legs are added by 08-03b and 08-04b. Synthetic data only.
 */
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { invoicesOf, run, seedPatient, seedQueueToken, seedVisit, testTag } from "../support/m0-data";
import { storageStatePath } from "../support/run-data";
import { commitThenAbort } from "../support/commit-then-abort";

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

  await page.goto("/queue");
  const card = page
    .getByRole("heading", { name: patientName, exact: true })
    .locator("xpath=ancestor::div[contains(@class,'rounded-2xl')][1]");
  await card.getByRole("button", { name: /Checkout/ }).click();
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
