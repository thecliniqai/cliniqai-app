/**
 * TEST_STRATEGY journey 6 — the consult on the V2-09b workspace (V2-09b 09B-05, P1-42, Q-1; AI-07, P1-24, R-6, R-7, R-8).
 *
 * The doctor opens a waiting patient from Today ("Call in"), enters two complaints and a respiratory exam by taps, adds the diagnosis from the "Likely
 * from the complaints" tile (the doctor's own signed history), adds two medicines with the existing builder, uploads a report, waits for "Saved", and
 * finishes through Sign & Bill (the fee goes to reception). The sealed record is read-only (no drop zone, Amend offered); the Rx PDF is a PDF whose hash is
 * the stored one; the doctor amends it with a reason and finalizes (version 2). Every screen is axe-clean (0 serious or critical) at the project's width.
 * The Rx-by-keyboard leg is V2-09c's (Q-1); V2-09a's amendment tail stays in tests/e2e/m0/consult-rx-finish.spec.ts. Synthetic data only.
 */
import { addCustomMedicine } from "../support/rx-entry";
import { createHash } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { awaitHydrated } from "../support/hydrated";
import {
  diagnosesOf,
  invoicesOf,
  prescriptionItemNames,
  prescriptionsOf,
  run,
  seedPatient,
  seedQueueToken,
  seedVisit,
  signSeededVisit,
  testTag,
  visitById,
} from "../support/m0-data";
import { getAdminClient } from "../../helpers/supabase-admin";
import { storageStatePath } from "../support/run-data";
import { settleAnimations } from "../support/settle";
import { openToday, rowOf } from "../support/today-page";

test.use({ storageState: storageStatePath("doctor") });

const TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const NOTES_LABEL = "History of Present Illness & Clinical Notes";
const COMPLAINT = "Acidity";
const DIAGNOSIS = "Gastritis E2E J6";
const admin = getAdminClient();

async function expectAxeClean(page: Page, screen: string): Promise<void> {
  await settleAnimations(page);
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`), `axe on ${screen}`).toEqual([]);
}

/** The doctor's own signed history: three visits with the same complaint and diagnosis, so the diagnosis is a "Likely from the complaints" tile. */
async function seedLikelyHistory(): Promise<void> {
  const { tenantA } = run();
  const doctor = tenantA.users.doctor;
  for (let i = 0; i < 3; i++) {
    const patient = await seedPatient(tenantA.id, tenantA.users.owner.id, `E2E Synthetic Journey6 History ${i} ${testTag()}`);
    const visitId = await seedVisit({ tenantId: tenantA.id, patientId: patient.id, doctorId: doctor.id, createdBy: tenantA.users.receptionist.id, status: "waiting" });
    const notes = await admin
      .from("clinical_notes")
      .update({ clinical_notes: "E2E synthetic history note", chief_complaints: [{ symptom: COMPLAINT, duration_val: 2, duration_unit: "days" }] })
      .eq("visit_id", visitId);
    if (notes.error) throw new Error(notes.error.message);
    const dx = await admin.from("consultation_diagnoses").insert({ tenant_id: tenantA.id, visit_id: visitId, patient_id: patient.id, diagnosis_name: DIAGNOSIS, icd11_code: "DA42" });
    if (dx.error) throw new Error(dx.error.message);
    await signSeededVisit(tenantA.id, visitId, doctor.email);
  }
}

test("@golden journey 6: Today, tap entry, likely diagnosis, two medicines, a report, Saved, Sign & Bill, the sealed record, the Rx PDF, amend and finalize", async ({ page, ux }) => {
  test.setTimeout(240_000);
  ux.flow("journey-06-consult", "Doctor consult on the V2-09b workspace, from Today to an amended and finalized record");
  const { tenantA } = run();
  const tag = testTag();
  const patientName = `E2E Synthetic Journey6 ${tag}`;
  await seedLikelyHistory();
  const patient = await seedPatient(tenantA.id, tenantA.users.owner.id, patientName);
  const visitId = await seedVisit({ tenantId: tenantA.id, patientId: patient.id, doctorId: tenantA.users.doctor.id, createdBy: tenantA.users.receptionist.id, status: "waiting" });
  await seedQueueToken(tenantA.id, visitId);
  const meds = [`E2E Synthetic J6 Med A ${tag}`, `E2E Synthetic J6 Med B ${tag}`];

  // 1. Today: the waiting patient is in the doctor's queue; Call in opens the consult.
  await openToday(page, "/today?mode=doctor");
  await ux.fill(page.getByLabel("Token, name or mobile"), patientName, "Token, name or mobile");
  await ux.click(rowOf(page, patientName).getByRole("button", { name: `Call in ${patientName}` }), "Call in");
  await expect(page).toHaveURL(new RegExp(`/consultation/${visitId}$`), { timeout: 20_000 });
  await expect(page.getByLabel(NOTES_LABEL)).toBeVisible();
  await awaitHydrated(page);
  await expectAxeClean(page, "the consult, empty");

  // 2. Complaints and an exam by taps.
  const tiles = page.getByRole("group", { name: "Complaints", exact: true });
  await ux.click(tiles.getByRole("button", { name: COMPLAINT, exact: true }), `Complaint tile: ${COMPLAINT}`);
  await ux.click(tiles.getByRole("button", { name: "Vomiting", exact: true }), "Complaint tile: Vomiting");
  await expect(page.getByRole("list", { name: "Complaints added" }).getByRole("listitem")).toHaveCount(2);
  await ux.click(page.getByRole("radiogroup", { name: "Examination template" }).getByRole("radio", { name: /^Respiratory/ }), "Template: Respiratory");
  const rs = page.locator('[data-exam-system="rs"]');
  await ux.click(rs.getByRole("radio", { name: "Abnormal" }), "RS: Abnormal");
  await ux.click(page.getByRole("group", { name: "RS findings" }).getByRole("button", { name: "Crepts", exact: true }), "RS finding: Crepts");

  // 3. The diagnosis from the likely tile (the doctor's own history, one tap).
  const likely = page.locator("[data-diagnosis-likely]");
  await expect(likely).toContainText("Likely from the complaints");
  await ux.click(likely.getByRole("button", { name: new RegExp(`^${DIAGNOSIS}`) }), `Likely: ${DIAGNOSIS}`);
  await expect(page.getByRole("list", { name: "Diagnoses" })).toContainText(DIAGNOSIS);

  // 4. Two medicines with the keyboard builder (V2-09c 09C-01): the name, Enter on the Add row, the key 1 (1-0-1), 5d, Enter.
  const rx = page.locator("#prescription");
  for (const [index, med] of meds.entries()) {
    await addCustomMedicine(rx, med, { ux });
    await expect.poll(() => prescriptionItemNames(visitId)).toHaveLength(index + 1);
  }

  // 5. A report from the drop zone: stored with this visit and listed.
  await page.locator("[data-file-drop] input[type=file]").setInputFiles([
    { name: `journey6-report-${tag.replace(/\W/g, "")}.pdf`, mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n% synthetic journey 6 report\n%%EOF\n") },
  ]);
  await expect(page.locator("[data-file-drop] [data-file-row]").first()).toHaveAttribute("data-status", "stored", { timeout: 30_000 });
  await expect(page.getByRole("list", { name: "Attachments" }).getByRole("listitem")).toHaveCount(1);

  // 6. Saved: the draft reached the server (complaints, the exam and the report's visit link). The status can still show an earlier save while the last edit
  // waits for its autosave (the keyboard builder made steps 4 and 5 faster than the debounce: CI-style race found on pixel-7), so the note is polled, not read once.
  await expect(page.locator("[data-save-status='saved']")).toBeVisible({ timeout: 12_000 });
  await expect
    .poll(
      async () => {
        const note = await admin.from("clinical_notes").select("chief_complaints, specialty_data").eq("visit_id", visitId).single();
        expect(note.error).toBeNull();
        return {
          complaints: (note.data!.chief_complaints as Array<{ symptom: string }>).map((c) => c.symptom),
          exam: (note.data!.specialty_data as { exam?: unknown } | null)?.exam,
        };
      },
      { timeout: 20_000 },
    )
    .toMatchObject({
      complaints: [COMPLAINT, "Vomiting"],
      exam: { template_id: "resp", systems: { rs: { abnormal: true, findings: ["Crepts"] } } },
    });
  expect(await diagnosesOf(visitId)).toEqual([DIAGNOSIS]);
  await expectAxeClean(page, "the filled consult");

  // 7. Finish through Sign & Bill, the fee to reception.
  await ux.click(page.getByRole("button", { name: /Finish visit/ }).first(), "Finish visit");
  const dialog = page.getByRole("dialog", { name: "Complete & Sign Consultation" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("note")).toContainText("Payment at reception");
  await expectAxeClean(page, "the Sign & Bill sheet");
  await ux.click(dialog.getByRole("button", { name: /Sign & Route to Reception/ }), "Sign & Route to Reception");
  await expect(page.getByRole("heading", { name: "Consultation Finalized & Signed" })).toBeVisible({ timeout: 30_000 });
  ux.done();

  const visit = await visitById(visitId);
  expect(visit?.status).toBe("completed");
  expect(visit?.signed_at).toBeTruthy();
  const [signedRx] = await prescriptionsOf(visitId);
  expect(signedRx).toMatchObject({ version: 1, items: 2 });
  expect(await prescriptionItemNames(visitId)).toEqual(meds);
  const invoices = await invoicesOf(visitId);
  expect(invoices).toHaveLength(1);
  expect(invoices[0].payments).toEqual([]);

  // 8. The sealed record: read-only, the report listed, no drop zone, Amend offered.
  await page.goto(`/consultation/${visitId}`);
  await awaitHydrated(page);
  await expect(page.getByTestId("signed-chip")).toContainText("Rx v1");
  await expect(page.getByLabel(NOTES_LABEL)).not.toBeEditable();
  await expect(page.locator("[data-file-drop]")).toHaveCount(0);
  await expect(page.getByRole("list", { name: "Attachments" }).getByRole("listitem")).toHaveCount(1);
  await expect(page.getByRole("button", { name: /Finish visit/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Amend", exact: true })).toBeVisible();
  await expectAxeClean(page, "the sealed record");

  // 9. The Rx PDF is a PDF, and its bytes are the archived ones.
  const pdf = await page.request.get(`/api/visits/${visitId}/prescription-pdf`);
  expect(pdf.status()).toBe(200);
  const pdfBytes = await pdf.body();
  expect(pdfBytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  const header = await admin.from("prescriptions").select("pdf_storage_path, pdf_sha256").eq("visit_id", visitId).single();
  expect(header.error).toBeNull();
  expect(header.data?.pdf_sha256).toBe(createHash("sha256").update(pdfBytes).digest("hex"));

  // 10. Amend with a reason and finalize: version 2, sealed again.
  const reason = "Reopened to add a note after the patient called back";
  await page.getByRole("button", { name: "Amend", exact: true }).click();
  const reopen = page.getByRole("dialog", { name: "Reopen Visit for Clinical Amendment" });
  await reopen.getByLabel(/Reason for Amendment/).fill(reason);
  await reopen.getByRole("button", { name: /Confirm & Reopen for Amendment/ }).click();
  await expect(page.getByTestId("amending-banner")).toContainText(`(v1 to v2): ${reason}`, { timeout: 30_000 });
  await expectAxeClean(page, "the amending record");
  await page.getByRole("button", { name: "Finalize amendment" }).click();
  const finalize = page.getByRole("dialog", { name: "Finalize amendment" });
  await expect(finalize).toBeVisible();
  await finalize.getByRole("button", { name: "Finalize amendment" }).click();
  await expect(page.getByTestId("signed-chip")).toContainText("Rx v2", { timeout: 30_000 });
  expect((await visitById(visitId))?.status).toBe("completed");
  expect((await prescriptionsOf(visitId))[0]).toMatchObject({ version: 2 });
});
