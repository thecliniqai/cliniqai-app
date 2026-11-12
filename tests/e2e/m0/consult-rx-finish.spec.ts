/**
 * M0 characterisation flow 5 — consult → prescription → finish (V2-02 plan 02-03b; FRONTEND_MIGRATION_PLAN M0;
 * also covers TEST_STRATEGY journey 6 on v1, RL-15).
 *
 * The doctor opens a waiting patient from the cabin, records notes and a diagnosis, adds two medicines and signs
 * (routing the fee to reception). Outcomes asserted: the visit is `completed` and signed with the notes saved; one
 * prescription, version 1, sealed (`signed_at`), with the two items; the diagnosis row; the prescription PDF route
 * returns a PDF (`%PDF-`); after signing the workspace no longer offers "Complete & Sign".
 *
 * A signed prescription being fully read-only in the UI (the medicine search disabled) is asserted separately under
 * `test.fail()`: v1 leaves the builder editable after sign-off and the server still accepts items on the signed
 * prescription — clinical immutability is roadmap item P1-03 (V2-09a).
 */
import { expect, test } from "../fixtures";
import {
  diagnosesOf,
  escapeRegExp,
  invoicesOf,
  prescriptionsOf,
  prescriptionItemNames,
  run,
  seedPatient,
  seedQueueToken,
  seedSignedPrescription,
  seedVisit,
  testTag,
  visitById,
} from "../support/m0-data";
import { storageStatePath } from "../support/run-data";

test.use({ storageState: storageStatePath("doctor") });

const NOTES_LABEL = "History of Present Illness & Clinical Notes";
const MEDICINE_SEARCH_LABEL = "Search CDCI Medicine or Brand Name:";

test("doctor consults a waiting patient, prescribes two medicines and signs → completed visit, sealed Rx v1, PDF", async ({ page, ux }) => {
  ux.flow("consult-rx-finish", "Doctor opens a waiting patient, notes + diagnosis, 2 medicines, signs (fee to reception)");
  const { tenantA } = run();
  const doctorId = tenantA.users.doctor.id;
  const tag = testTag();
  const patientName = `E2E Synthetic Consult ${tag}`;
  const patient = await seedPatient(tenantA.id, tenantA.users.owner.id, patientName);
  const visitId = await seedVisit({
    tenantId: tenantA.id,
    patientId: patient.id,
    doctorId,
    createdBy: tenantA.users.receptionist.id,
    status: "waiting",
  });
  await seedQueueToken(tenantA.id, visitId);
  const notes = "Synthetic note: two days of mild fever, no red flags.";
  const meds = [`E2E Synthetic Med A ${tag}`, `E2E Synthetic Med B ${tag}`];

  // Open the waiting patient from the cabin.
  await page.goto("/cabin");
  const card = page
    .getByRole("heading", { name: patientName, exact: true })
    .locator("xpath=ancestor::div[.//button[contains(., 'Consultation')]][1]");
  await ux.click(card.getByRole("button", { name: /Start Consultation/ }), "Start Consultation");
  await expect(page).toHaveURL(new RegExp(`/consultation/${visitId}$`));
  // The workspace is open for this patient. (v1 hides the header h1 on narrow screens, so anchor on the notes field,
  // visible at every width, and check the patient's name is in the page's h1 without requiring it to be shown.)
  await expect(page.getByLabel(NOTES_LABEL)).toBeVisible();
  await expect(page.locator("h1").filter({ hasText: patientName })).toHaveCount(1);

  // Notes and a diagnosis.
  await ux.fill(page.getByLabel(NOTES_LABEL), notes, "Clinical notes");
  await ux.click(page.locator("#diagnosis").getByRole("button", { name: /Viral Fever/ }), "Quick diagnosis: Viral Fever");
  await expect.poll(() => diagnosesOf(visitId)).toEqual(["Viral Fever"]);

  // Two medicines (custom names: the local stack's CDCI catalogue content is not part of the contract).
  const rx = page.locator("#prescription");
  for (const [index, med] of meds.entries()) {
    await ux.fill(rx.getByLabel(MEDICINE_SEARCH_LABEL), med, "Medicine search");
    await ux.click(
      rx.getByRole("button", { name: new RegExp(`Add as custom medicine: "${escapeRegExp(med)}"`) }),
      "Add as custom medicine",
    );
    await ux.click(rx.getByRole("button", { name: "Add to Prescription" }), "Add to Prescription");
    await expect.poll(() => prescriptionItemNames(visitId)).toHaveLength(index + 1);
  }

  // Sign, routing the fee to reception (billing is flow 6).
  await ux.click(page.getByRole("button", { name: /Complete & Sign/ }).first(), "Complete & Sign");
  const dialog = page.getByRole("dialog", { name: "Complete & Sign Consultation" });
  await expect(dialog).toBeVisible();
  // The v1 toggle is a visually hidden checkbox inside its label (no accessible name; one checkbox in the dialog).
  await ux.uncheck(dialog.getByRole("checkbox"), "Collect fee at desk: off", { force: true });
  await ux.click(dialog.getByRole("button", { name: /Sign & Route to Reception/ }), "Sign & Route to Reception");
  await expect(page.getByRole("heading", { name: "Consultation Finalized & Signed" })).toBeVisible({ timeout: 30_000 });
  ux.done();

  // Database: completed + signed visit with the notes; one sealed v1 prescription with both items; the diagnosis.
  const visit = await visitById(visitId);
  expect(visit).toMatchObject({ status: "completed", clinical_notes: notes });
  expect(visit?.signed_at).toBeTruthy();
  const prescriptions = await prescriptionsOf(visitId);
  expect(prescriptions).toHaveLength(1);
  expect(prescriptions[0]).toMatchObject({ version: 1, items: 2 });
  expect(prescriptions[0].signed_at).toBeTruthy();
  expect(await prescriptionItemNames(visitId)).toEqual(meds);
  expect(await diagnosesOf(visitId)).toEqual(["Viral Fever"]);
  // Routed to reception: an invoice exists for the front desk, nothing collected yet.
  const invoices = await invoicesOf(visitId);
  expect(invoices).toHaveLength(1);
  expect(invoices[0].payments).toEqual([]);

  // The prescription PDF.
  const pdf = await page.request.get(`/api/visits/${visitId}/prescription-pdf`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toContain("application/pdf");
  expect((await pdf.body()).subarray(0, 5).toString("latin1")).toBe("%PDF-");

  // After sign-off the workspace offers print/re-bill, not "Complete & Sign".
  await page.goto(`/consultation/${visitId}`);
  await expect(page.getByRole("link", { name: /Print Rx/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Complete & Sign/ })).toHaveCount(0);
});

test("a signed prescription is read-only in the workspace (known v1 gap P1-03)", async ({ page }) => {
  test.fail(true, "P1-03: v1 keeps the prescription builder editable after sign-off; clinical immutability lands in V2-09a");
  const { tenantA } = run();
  const doctorId = tenantA.users.doctor.id;
  const tag = testTag();
  const patient = await seedPatient(tenantA.id, tenantA.users.owner.id, `E2E Synthetic Signed ${tag}`);
  const signedAt = new Date().toISOString();
  const visitId = await seedVisit({
    tenantId: tenantA.id,
    patientId: patient.id,
    doctorId,
    createdBy: tenantA.users.receptionist.id,
    status: "completed",
    signedAt,
  });
  await seedSignedPrescription({
    tenantId: tenantA.id,
    visitId,
    patientId: patient.id,
    doctorId,
    signedAt,
    medicineName: `E2E Synthetic Sealed Med ${tag}`,
  });

  await page.goto(`/consultation/${visitId}`);
  await expect(page.getByRole("link", { name: /Print Rx/ })).toBeVisible();
  // Correct outcome: nothing on the sealed prescription can be changed from the workspace.
  await expect(page.getByLabel(MEDICINE_SEARCH_LABEL)).toBeDisabled({ timeout: 5_000 });
  await expect(page.getByRole("button", { name: "Remove medication" })).toBeDisabled({ timeout: 5_000 });
});
