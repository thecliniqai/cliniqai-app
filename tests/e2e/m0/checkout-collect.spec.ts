/**
 * M0 characterisation flow 6 — checkout and collect (V2-02 plan 02-03b; FRONTEND_MIGRATION_PLAN M0).
 *
 * The front desk bills a completed visit from the live queue and collects in two parts: ₹200 cash, then the ₹400
 * balance by UPI. Outcomes asserted: one invoice for ₹600 that ends `paid`, exactly two `payments` rows (cash 200,
 * UPI 400 with its reference), the receipt PDF route returns a PDF (`%PDF-`), and a double-submit of the final
 * payment records no second payment (01-10 AR3-N2 behaviour: one live invoice, no duplicate collection).
 */
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { invoicesOf, run, seedPatient, seedQueueToken, seedVisit, testTag } from "../support/m0-data";
import { storageStatePath } from "../support/run-data";

test.use({ storageState: storageStatePath("receptionist") });

function queueCard(page: Page, patientName: string): Locator {
  return page
    .getByRole("heading", { name: patientName, exact: true })
    .locator("xpath=ancestor::div[contains(@class,'rounded-2xl')][1]");
}

function checkoutDrawer(page: Page): Locator {
  return page
    .getByRole("heading", { name: "Patient Checkout & Billing" })
    .locator("xpath=ancestor::div[contains(@class,'fixed')][1]");
}

test("bill a completed visit, collect cash then UPI balance → invoice paid, two payments, receipt PDF", async ({ page, ux }) => {
  ux.flow("checkout-collect", "Front desk bills a completed visit (₹600) and collects ₹200 cash, then ₹400 UPI");
  const { tenantA } = run();
  const patientName = `E2E Synthetic Checkout ${testTag()}`;
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
  const utr = `E2E${Date.now()}`;

  await page.goto("/queue");
  const card = queueCard(page, patientName);
  await expect(card).toBeVisible();

  // 1. Create the invoice (₹600) and collect ₹200 in cash.
  await ux.click(card.getByRole("button", { name: /Checkout/ }), "Checkout");
  let drawer = checkoutDrawer(page);
  await expect(drawer).toBeVisible();
  await ux.fill(drawer.getByLabel(/^OPD Consultation Fee/), "600", "OPD Consultation Fee");
  await ux.fill(drawer.getByLabel(/^Amount to Collect/), "200", "Amount to Collect");
  await ux.click(drawer.getByRole("button", { name: "Collect ₹200 & Checkout" }), "Collect ₹200 & Checkout");
  await expect(drawer.getByRole("heading", { name: "Patient Checkout Complete" })).toBeVisible();

  let invoices = await invoicesOf(visitId);
  expect(invoices).toHaveLength(1);
  expect(invoices[0].total_amount).toBe(600);
  expect(invoices[0].status).not.toBe("paid");
  expect(invoices[0].payments).toEqual([{ amount: 200, payment_method: "cash", reference_number: null }]);

  // 2. Reopen and collect the ₹400 balance by UPI; the final submit is double-clicked.
  await ux.click(drawer.getByRole("button", { name: "Close drawer" }), "Close drawer");
  await expect(page.getByRole("heading", { name: "Patient Checkout & Billing" })).toHaveCount(0);
  await ux.click(queueCard(page, patientName).getByRole("button", { name: /Checkout/ }), "Checkout");
  drawer = checkoutDrawer(page);
  await expect(drawer.getByText("₹400 Pending")).toBeVisible();
  await expect(drawer.getByLabel(/^Amount to Collect/)).toHaveValue("400");
  await ux.click(drawer.getByRole("button", { name: "UPI / QR" }), "UPI / QR");
  await ux.fill(drawer.getByLabel("UPI UTR / Reference ID"), utr, "UPI UTR / Reference ID");
  const collect = drawer.getByRole("button", { name: "Collect ₹400 & Checkout" });
  await expect(collect).toBeEnabled();
  await ux.click(collect, "Collect ₹400 & Checkout (double-click)", { clickCount: 2 });
  await expect(drawer.getByRole("heading", { name: "Patient Checkout Complete" })).toBeVisible();
  ux.done();

  // Database: one invoice, paid, exactly two payments (no duplicate from the double-submit).
  await expect.poll(async () => (await invoicesOf(visitId))[0]?.status).toBe("paid");
  invoices = await invoicesOf(visitId);
  expect(invoices).toHaveLength(1);
  expect(invoices[0].payments).toEqual([
    { amount: 200, payment_method: "cash", reference_number: null },
    { amount: 400, payment_method: "upi", reference_number: utr },
  ]);

  // The receipt PDF.
  const pdf = await page.request.get(`/api/invoices/${invoices[0].id}/receipt-pdf`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toContain("application/pdf");
  expect((await pdf.body()).subarray(0, 5).toString("latin1")).toBe("%PDF-");
});
