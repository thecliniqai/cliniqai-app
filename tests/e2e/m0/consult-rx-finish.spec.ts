/**
 * M0 characterisation flow 5 — consult → prescription → finish (V2-02 plan 02-03b; FRONTEND_MIGRATION_PLAN M0;
 * also covers TEST_STRATEGY journey 6 on v1, RL-15).
 *
 * The doctor opens a waiting patient from the cabin, records notes and a diagnosis, adds two medicines and signs
 * (routing the fee to reception). Outcomes asserted: the visit is `completed` and signed with the notes saved; one
 * prescription, version 1, sealed (`signed_at`), with the two items; the diagnosis row; the prescription PDF route
 * returns a PDF (`%PDF-`); after signing the workspace no longer offers "Complete & Sign".
 *
 * A signed consultation is read-only in the workspace (P1-03, closed in V2-09a): the medicine search, "Remove medication", the notes, the
 * diagnosis search and the vitals editor are disabled or gone, and Amend is offered. The journey-6 tail amends it: a reason of 10 characters
 * reopens it (the confirm button is disabled below that), the banner names the versions, a second medicine is added, and Finalize amendment
 * leaves one revision row holding the signed version, Rx version 2 with both items, the two audit rows, the re-issued `prescription.issued`
 * event, `rx_v1.pdf` and `rx_v2.pdf` archived once each with their own SHA-256, and the PDF route serving the archived v2 bytes.
 */
import { createHash } from "node:crypto";
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
  seedSignedConsultation,
  seedVisit,
  testTag,
  visitById,
} from "../support/m0-data";
import { auditRows } from "../../helpers/billing-commands";
import { deactivateSubscription, outboxRows, subscribeSignEvents } from "../../helpers/clinical-commands";
import { getAdminClient } from "../../helpers/supabase-admin";
import { storageStatePath } from "../support/run-data";
import { openToday, rowOf } from "../support/today-page";

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

  // Open the waiting patient from the doctor's Today (R-14: the cabin is "My queue"); the filter box finds this patient among
  // the clinic's shared synthetic rows and the row's own action calls them in.
  await openToday(page, "/today?mode=doctor");
  await ux.fill(page.getByLabel("Token, name or mobile"), patientName, "Token, name or mobile");
  await ux.click(rowOf(page, patientName).getByRole("button", { name: `Call in ${patientName}` }), "Call in");
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
  // PO-3 (V2-05 05-02b): a doctor does not collect. The "collect at desk" toggle is not offered; the bill goes to
  // reception (the server refuses a doctor's collection regardless: tests/billing/collect-permission.spec.ts).
  await expect(dialog.getByRole("checkbox")).toHaveCount(0);
  await expect(dialog.getByRole("note")).toContainText("Payment at reception");
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
  const pdfBytes = await pdf.body();
  expect(pdfBytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  // V2-09a (R-12): the PDF is archived once, at the versioned key, and its SHA-256 is stored; the route served those very bytes (hash read from the database).
  const admin = getAdminClient();
  const { data: archived, error: archivedErr } = await admin
    .from("prescriptions")
    .select("pdf_storage_path, pdf_sha256")
    .eq("visit_id", visitId)
    .single();
  expect(archivedErr).toBeNull();
  expect(archived?.pdf_storage_path).toBe(`${tenantA.id}/${visitId}/rx_v1.pdf`);
  expect(archived?.pdf_sha256).toBe(createHash("sha256").update(pdfBytes).digest("hex"));
  const { data: stored } = await admin.storage.from("prescriptions").download(archived!.pdf_storage_path!);
  expect(createHash("sha256").update(Buffer.from(await stored!.arrayBuffer())).digest("hex")).toBe(archived?.pdf_sha256);

  // After sign-off the workspace offers Print Rx (and Amend), not "Complete & Sign".
  await page.goto(`/consultation/${visitId}`);
  await expect(page.getByRole("link", { name: /Print Rx/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Complete & Sign/ })).toHaveCount(0);
});

test("a signed consultation is read-only in the workspace; Amend is offered (P1-03)", async ({ page }) => {
  // Seeded the way production makes a signed record (V2-09a R-15): an open visit with a note and a prescription, then the doctor's sign-off.
  const { visitId } = await seedSignedConsultation("Signed");

  await page.goto(`/consultation/${visitId}`);
  await expect(page.getByRole("link", { name: /Print Rx/ })).toBeVisible();
  // Nothing on the signed consultation can be changed from the workspace.
  await expect(page.getByLabel(MEDICINE_SEARCH_LABEL)).toBeDisabled();
  await expect(page.getByRole("button", { name: "Remove medication" })).toBeDisabled();
  // V2-09a 09A-06a (review B-6): the signed notes are read-only, not disabled: focusable and scrollable by keyboard, typing changes nothing.
  const notesField = page.getByLabel(NOTES_LABEL);
  await expect(notesField).not.toBeEditable();
  await expect(notesField).toHaveAttribute("aria-readonly", "true");
  await notesField.focus();
  await expect(notesField).toBeFocused();
  await page.keyboard.type("typed into a signed record");
  await expect(notesField).toHaveValue("E2E synthetic note");
  await expect(page.getByPlaceholder(/Search diagnosis name/)).toBeDisabled();
  await expect(page.getByRole("button", { name: /Record Vitals|Edit Vitals/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Complete & Sign/ })).toHaveCount(0);
  await expect(page.getByTestId("signed-chip")).toContainText("Rx v1");
  await expect(page.getByRole("button", { name: "Amend", exact: true })).toBeVisible();
});

test("journey 6 tail: the doctor amends a signed consultation with a reason and finalizes it → revision, Rx v2, audit, event, both PDFs", async ({ page }) => {
  const { tenantA } = run();
  const { visitId, medicine } = await seedSignedConsultation("Amend");
  const added = `E2E Synthetic Added Med ${testTag()}`;
  const reason = "Added a second medicine after the patient called back";
  // A subscription to the sign-off events, so the re-issued prescription event is queued.
  const subscriptionId = await subscribeSignEvents({ tenantId: tenantA.id, userId: tenantA.users.owner.id });
  try {
    const before = await visitById(visitId);
    expect(before?.status).toBe("completed");
    const [signedRx] = await prescriptionsOf(visitId);
    expect(signedRx).toMatchObject({ version: 1, items: 1 });

    await page.goto(`/consultation/${visitId}`);
    await page.getByRole("button", { name: "Amend", exact: true }).click();
    const reopen = page.getByRole("dialog", { name: "Reopen Visit for Clinical Amendment" });
    await expect(reopen).toBeVisible();
    const confirm = reopen.getByRole("button", { name: /Confirm & Reopen for Amendment/ });
    await expect(confirm).toBeDisabled();
    await reopen.getByLabel(/Reason for Amendment/).fill("too short"); // 9 characters
    await expect(confirm).toBeDisabled();
    await reopen.getByLabel(/Reason for Amendment/).fill(reason);
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(reopen).toBeHidden();

    // The amendment is open: the banner names the versions and the reason, the form is editable, Complete & Sign is not offered.
    await expect(page.getByRole("status").filter({ hasText: `Amending a signed consultation (v1 to v2): ${reason}` })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: /Complete & Sign/ })).toHaveCount(0);
    const rx = page.locator("#prescription");
    await expect(rx.getByLabel(MEDICINE_SEARCH_LABEL)).toBeEnabled();
    await rx.getByLabel(MEDICINE_SEARCH_LABEL).fill(added);
    await rx.getByRole("button", { name: new RegExp(`Add as custom medicine: "${escapeRegExp(added)}"`) }).click();
    await rx.getByRole("button", { name: "Add to Prescription" }).click();
    await expect.poll(() => prescriptionItemNames(visitId)).toEqual([medicine, added]);

    // Finalize: the confirmation, then the consultation is sealed again at version 2.
    await page.getByRole("button", { name: "Finalize amendment" }).click();
    const finalize = page.getByRole("dialog", { name: "Finalize amendment" });
    await expect(finalize).toBeVisible();
    await finalize.getByRole("button", { name: "Finalize amendment" }).click();
    await expect(page.getByTestId("signed-chip")).toContainText("Rx v2", { timeout: 30_000 });
    await expect(page.getByLabel(MEDICINE_SEARCH_LABEL)).toBeDisabled();
    await expect(page.getByRole("button", { name: "Amend", exact: true })).toBeVisible();

    // Database: re-signed and completed; one revision row holding the signed version; the same header at version 2 with both items.
    const after = await visitById(visitId);
    expect(after?.status).toBe("completed");
    expect(after?.signed_at).toBeTruthy();
    expect(after?.signed_at).not.toBe(before?.signed_at);
    const admin = getAdminClient();
    const { data: revisions, error: revisionsErr } = await admin
      .from("visit_revisions")
      .select("revision_number, amendment_reason, snapshot")
      .eq("visit_id", visitId);
    expect(revisionsErr).toBeNull();
    expect(revisions).toHaveLength(1);
    expect(revisions![0]).toMatchObject({ revision_number: 1, amendment_reason: reason });
    const snapshot = revisions![0].snapshot as {
      captured_by: string;
      prescription: { version: number; pdf_storage_path: string | null; pdf_sha256: string | null; items: Array<{ medicine_name: string }> };
    };
    expect(snapshot.captured_by).toBe("database");
    expect(snapshot.prescription.version).toBe(1);
    expect(snapshot.prescription.items.map((i) => i.medicine_name)).toEqual([medicine]);
    const rxs = await prescriptionsOf(visitId);
    expect(rxs).toHaveLength(1);
    expect(rxs[0]).toMatchObject({ id: signedRx.id, version: 2, items: 2 });
    expect(await prescriptionItemNames(visitId)).toEqual([medicine, added]);

    // Audit rows, and the re-issued prescription event: one row for version 2 (the key of version 1 is unchanged; the sign-off preceded the subscription).
    expect(await auditRows(tenantA.id, "visit.reopen_for_amendment", visitId)).toHaveLength(1);
    expect(await auditRows(tenantA.id, "visit.amend_finalized", visitId)).toHaveLength(1);
    const events = await outboxRows(tenantA.id, "prescription.issued", signedRx.id);
    expect(events.map((r) => r.event_key)).toEqual([`prescription.issued:${signedRx.id}:signed:v2`]);
    expect(JSON.parse(events[0].payload as string)).toMatchObject({ event: "prescription.issued", data: { version: 2, prescription_id: signedRx.id } });

    // Both PDFs are archived once at their own key, each with the SHA-256 of its stored bytes; v1 survives in the snapshot, v2 on the header.
    const sha = async (path: string) => {
      const { data, error } = await admin.storage.from("prescriptions").download(path);
      expect(error).toBeNull();
      return createHash("sha256").update(Buffer.from(await data!.arrayBuffer())).digest("hex");
    };
    const v1Path = `${tenantA.id}/${visitId}/rx_v1.pdf`;
    const v2Path = `${tenantA.id}/${visitId}/rx_v2.pdf`;
    expect(snapshot.prescription.pdf_storage_path).toBe(v1Path);
    expect(snapshot.prescription.pdf_sha256).toBe(await sha(v1Path));
    const { data: header, error: headerErr } = await admin.from("prescriptions").select("pdf_storage_path, pdf_sha256").eq("visit_id", visitId).single();
    expect(headerErr).toBeNull();
    expect(header?.pdf_storage_path).toBe(v2Path);
    expect(header?.pdf_sha256).toBe(await sha(v2Path));
    expect(header?.pdf_sha256).not.toBe(snapshot.prescription.pdf_sha256);

    // The PDF route serves the archived version 2.
    const pdf = await page.request.get(`/api/visits/${visitId}/prescription-pdf`);
    expect(pdf.status()).toBe(200);
    const bytes = await pdf.body();
    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(header?.pdf_sha256);
  } finally {
    await deactivateSubscription(subscriptionId);
  }
});
