/**
 * V2-09b 09B-04a (R-11, R-13; AI-07, AI-10): the read side of Smart Assist on the consult and on Today. Every check runs with AI fully disabled: the e2e
 * server has no provider environment, and `platform_settings.ai_features` (the platform kill switch) is set to all off for the duration of the file and
 * restored after it. Smart Assist is deterministic and does not depend on it.
 *   - "Likely from the complaints": with the doctor's own signed history, one tap adds the diagnosis (the `ux` counter records 1 action, 0 typed);
 *   - typing "htn" finds the hypertension entry (a synonym and the abbreviation table), Enter adds it with its ICD-11 code;
 *   - the snapshot shows on the consult (the patient column at 1280, the Patient sheet at 820) and on Today doctor mode beside the Next card at 820;
 *   - a reopened (amending) record of the doctor's own appears under "Open amendments" on Today and links to its consult.
 * Synthetic data only.
 */
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { awaitHydrated } from "../support/hydrated";
import { istDate, run, seedPatient, seedPrescription, seedSignedConsultation, seedVisit, signSeededVisit, testTag } from "../support/m0-data";
import { openToday } from "../support/today-page";
import { getAdminClient } from "../../helpers/supabase-admin";
import { storageStatePath } from "../support/run-data";

test.use({ storageState: storageStatePath("doctor") });
test.describe.configure({ mode: "serial" });

const admin = getAdminClient();
const DIAGNOSIS = "Viral fever E2E";
const HTN = "Hypertension E2E";
const CATALOGUE_IDS: string[] = [];
let originalAiFeatures: unknown = null;

async function seedSignedFor(patientId: string, opts: { complaint: string; diagnosis: string; icd11: string; medicine?: string; followUpDate?: string; followUpWrittenDaysAgo?: number }) {
  const { tenantA } = run();
  const doctor = tenantA.users.doctor;
  const visitId = await seedVisit({ tenantId: tenantA.id, patientId, doctorId: doctor.id, createdBy: tenantA.users.receptionist.id, status: "waiting" });
  const notes = await admin
    .from("clinical_notes")
    .update({ clinical_notes: "E2E synthetic history note", chief_complaints: [{ symptom: opts.complaint, duration_val: 2, duration_unit: "days" }] })
    .eq("visit_id", visitId);
  if (notes.error) throw new Error(notes.error.message);
  const dx = await admin.from("consultation_diagnoses").insert({ tenant_id: tenantA.id, visit_id: visitId, patient_id: patientId, diagnosis_name: opts.diagnosis, icd11_code: opts.icd11 });
  if (dx.error) throw new Error(dx.error.message);
  if (opts.medicine) await seedPrescription({ tenantId: tenantA.id, visitId, patientId, doctorId: doctor.id, medicineName: opts.medicine });
  if (opts.followUpDate) {
    const fu = await admin.from("follow_ups").insert({
      tenant_id: tenantA.id,
      visit_id: visitId,
      patient_id: patientId,
      doctor_id: doctor.id,
      follow_up_date: opts.followUpDate,
      created_at: new Date(Date.now() - (opts.followUpWrittenDaysAgo ?? 0) * 86_400_000).toISOString(),
    });
    if (fu.error) throw new Error(fu.error.message);
  }
  await signSeededVisit(tenantA.id, visitId, doctor.email);
  return visitId;
}

test.beforeAll(async () => {
  test.setTimeout(180_000);
  const { tenantA } = run();
  // AI fully disabled: the platform kill switch is all off while this file runs.
  const current = await admin.from("platform_settings").select("ai_features").eq("id", true).single();
  if (current.error) throw new Error(current.error.message);
  originalAiFeatures = current.data.ai_features;
  const off = Object.fromEntries(Object.keys(originalAiFeatures as Record<string, unknown>).map((k) => [k, false]));
  const killed = await admin.from("platform_settings").update({ ai_features: off }).eq("id", true);
  if (killed.error) throw new Error(killed.error.message);

  const catalogue = await admin
    .from("opd_diagnoses")
    .insert([
      { name: HTN, icd11_code: "BA00", snomed_concept_id: "38341003", synonyms: ["HTN", "high blood pressure"], specialties: ["general_physician"], is_chronic: true },
      { name: "Essential hypertension E2E", icd11_code: "BA00.1", synonyms: [], specialties: ["general_physician"], is_chronic: true },
    ])
    .select("id");
  if (catalogue.error) throw new Error(catalogue.error.message);
  CATALOGUE_IDS.push(...(catalogue.data ?? []).map((r) => r.id));

  // The doctor's own signed history: "Fever" with "Viral fever E2E", three times.
  for (let i = 0; i < 3; i++) {
    const patient = await seedPatient(tenantA.id, tenantA.users.owner.id, `E2E Synthetic Assist History ${i} ${testTag()}`);
    await seedSignedFor(patient.id, { complaint: "Fever", diagnosis: DIAGNOSIS, icd11: "MG26" });
  }
});

test.afterAll(async () => {
  if (originalAiFeatures !== null) await admin.from("platform_settings").update({ ai_features: originalAiFeatures as never }).eq("id", true);
  if (CATALOGUE_IDS.length > 0) await admin.from("opd_diagnoses").delete().in("id", CATALOGUE_IDS);
});

/** A patient with a history worth a snapshot: a signed visit with a medicine, and a follow-up written 10 days ago that came due 2 days ago. One per test: a visit opened for them counts as "a visit since". */
async function seedHistoryPatient(label: string): Promise<{ id: string; name: string }> {
  const { tenantA } = run();
  const name = `E2E Synthetic Snapshot ${label} ${testTag()}`;
  const patient = await seedPatient(tenantA.id, tenantA.users.owner.id, name);
  await seedSignedFor(patient.id, {
    complaint: "Headache",
    diagnosis: "Essential hypertension",
    icd11: "BA00",
    medicine: "E2E Synthetic Telmisartan 40 mg",
    followUpDate: istDate(-2),
    followUpWrittenDaysAgo: 10,
  });
  return { id: patient.id, name };
}

async function openConsultFor(page: Page, patientId: string, complaint?: string) {
  const { tenantA } = run();
  const visitId = await seedVisit({ tenantId: tenantA.id, patientId, doctorId: tenantA.users.doctor.id, createdBy: tenantA.users.receptionist.id, status: "in_consultation" });
  if (complaint) {
    const notes = await admin.from("clinical_notes").update({ chief_complaints: [{ symptom: complaint, duration_val: 2, duration_unit: "days" }] }).eq("visit_id", visitId);
    if (notes.error) throw new Error(notes.error.message);
  }
  await page.goto(`/consultation/${visitId}`);
  await expect(page.getByLabel("History of Present Illness & Clinical Notes")).toBeVisible();
  await awaitHydrated(page);
  return visitId;
}

async function diagnosesOf(visitId: string) {
  const { data, error } = await admin.from("consultation_diagnoses").select("diagnosis_name, icd11_code, is_custom").eq("visit_id", visitId);
  if (error) throw new Error(error.message);
  return data ?? [];
}

test("AI is off for this file: the platform switch is all false and no AI control is on the consult", async ({ page }) => {
  const { data } = await admin.from("platform_settings").select("ai_features").eq("id", true).single();
  expect(Object.values(data!.ai_features as Record<string, boolean>).every((v) => v === false)).toBe(true);
  const patient = await seedPatient(run().tenantA.id, run().tenantA.users.owner.id, `E2E Synthetic Assist Off ${testTag()}`);
  await openConsultFor(page, patient.id);
  await expect(page.getByRole("button", { name: /AI Assist|AI Scribe|Generate AI/i })).toHaveCount(0);
});

test("the likely tile adds the diagnosis in one tap (Smart Assist, from the doctor's own history)", async ({ page, ux }) => {
  ux.flow("consult-likely-diagnosis", "A likely diagnosis from the complaints in one tap");
  const patient = await seedPatient(run().tenantA.id, run().tenantA.users.owner.id, `E2E Synthetic Assist Likely ${testTag()}`);
  const visitId = await openConsultFor(page, patient.id, "Fever");

  const likely = page.locator("[data-diagnosis-likely]");
  await expect(likely).toContainText("Likely from the complaints");
  await expect(likely).toContainText("Smart Assist");
  await ux.click(likely.getByRole("button", { name: new RegExp(`^${DIAGNOSIS}`) }), `Likely: ${DIAGNOSIS}`);
  await expect(page.getByRole("list", { name: "Diagnoses" })).toContainText(DIAGNOSIS);
  ux.done();
  expect(ux.counts()?.actions).toBe(1);
  expect(ux.counts()?.keystrokes).toBe(0);
  await expect.poll(() => diagnosesOf(visitId), { timeout: 12_000 }).toEqual([{ diagnosis_name: DIAGNOSIS, icd11_code: "MG26", is_custom: false }]);
  // The tile that was tapped has left the group: nothing is added twice.
  await expect(likely.getByRole("button", { name: new RegExp(`^${DIAGNOSIS}`) })).toHaveCount(0);
});

test("typing 'htn' finds the hypertension entry; Enter adds it with its ICD-11 code", async ({ page }) => {
  const patient = await seedPatient(run().tenantA.id, run().tenantA.users.owner.id, `E2E Synthetic Assist Search ${testTag()}`);
  const visitId = await openConsultFor(page, patient.id);
  const input = page.getByPlaceholder(/Search diagnosis name/);
  await input.fill("htn");
  const option = page.getByRole("option", { name: new RegExp(HTN) });
  await expect(option).toBeVisible({ timeout: 8_000 });
  await expect(option).toContainText("ICD-11 BA00");
  await input.press("Enter");
  await expect(page.getByRole("list", { name: "Diagnoses" })).toContainText(HTN);
  await expect.poll(() => diagnosesOf(visitId), { timeout: 12_000 }).toEqual([{ diagnosis_name: HTN, icd11_code: "BA00", is_custom: false }]);
});

test("a diagnosis that is not in the catalogue is added as the doctor's own, from the last row", async ({ page }) => {
  const patient = await seedPatient(run().tenantA.id, run().tenantA.users.owner.id, `E2E Synthetic Assist Custom ${testTag()}`);
  const visitId = await openConsultFor(page, patient.id);
  const name = `Zzz e2e own diagnosis ${testTag()}`;
  const input = page.getByPlaceholder(/Search diagnosis name/);
  await input.fill(name);
  const row = page.getByRole("option", { name: new RegExp(`Add .${name.slice(0, 20)}`) });
  await expect(row).toBeVisible({ timeout: 8_000 });
  await row.click();
  await expect.poll(() => diagnosesOf(visitId), { timeout: 12_000 }).toEqual([{ diagnosis_name: name, icd11_code: null, is_custom: true }]);
});

test("the snapshot shows on the consult: the patient column at 1280 and the Patient sheet at 820", async ({ page }) => {
  const historyPatient = await seedHistoryPatient("Consult");
  await page.setViewportSize({ width: 1280, height: 900 });
  await openConsultFor(page, historyPatient.id);
  const snapshot = page.locator("[data-patient-column] [data-patient-snapshot]");
  await expect(snapshot).toBeVisible();
  await expect(snapshot).toContainText("Smart Assist");
  await expect(snapshot).toContainText("Last seen");
  await expect(snapshot).toContainText("Essential hypertension");
  await expect(snapshot).toContainText("E2E Synthetic Telmisartan 40 mg · 1-0-1 · 5 days");
  await expect(snapshot).toContainText("Due follow-up");
  await expect(snapshot).toContainText("(no visit since)");

  await page.setViewportSize({ width: 820, height: 1000 });
  await page.getByRole("button", { name: "Patient", exact: true }).first().click();
  const sheet = page.locator("[data-patient-sheet]");
  await expect(sheet.locator("[data-patient-snapshot]")).toContainText("Last seen");
});

test("Today doctor mode shows the Next patient's snapshot beside the Next card at 820", async ({ page }) => {
  const historyPatient = await seedHistoryPatient("Today");
  await page.setViewportSize({ width: 820, height: 1000 });
  // The history patient arrives again: a waiting visit with an urgent token, so they are the doctor's Next.
  const { tenantA } = run();
  const waitingVisit = await seedVisit({ tenantId: tenantA.id, patientId: historyPatient.id, doctorId: tenantA.users.doctor.id, createdBy: tenantA.users.receptionist.id, status: "waiting" });
  const top = await admin.from("queue_tokens").select("token_number").eq("tenant_id", tenantA.id).eq("date", istDate()).order("token_number", { ascending: false }).limit(1).maybeSingle();
  const token = await admin
    .from("queue_tokens")
    .insert({ tenant_id: tenantA.id, visit_id: waitingVisit, token_number: (top.data?.token_number ?? 0) + 1, date: istDate(), priority: "urgent" });
  if (token.error) throw new Error(token.error.message);
  await openToday(page, "/today?mode=doctor");
  const next = page.locator("[data-next-patient]");
  await expect(next).toContainText(historyPatient.name);
  const panel = page.locator("[data-snapshot-panel]");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText(historyPatient.name);
  await expect(panel).toContainText("Last seen");
  await expect(panel).toContainText("Due follow-up");
  await expect(panel).toContainText("Smart Assist");
  // Below 768 px the panel is not drawn (the consult has the same lines).
  await page.setViewportSize({ width: 600, height: 900 });
  await expect(panel).toBeHidden();
});

test("an open amendment of the doctor's own appears under Open amendments on Today and links to its consult", async ({ page }) => {
  const { visitId } = await seedSignedConsultation("OpenAmendment");
  await page.goto(`/consultation/${visitId}`);
  await page.getByRole("button", { name: "Amend", exact: true }).click();
  const reopen = page.getByRole("dialog", { name: "Reopen Visit for Clinical Amendment" });
  await reopen.getByLabel(/Reason for Amendment/).fill("Reopened to list it under open amendments");
  await reopen.getByRole("button", { name: /Confirm & Reopen for Amendment/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "Amending a signed consultation" })).toBeVisible({ timeout: 30_000 });

  await openToday(page, "/today?mode=doctor");
  const section = page.locator("[data-open-amendments]");
  await expect(section).toBeVisible();
  await expect(section.getByRole("heading")).toContainText(/Open amendments \(\d+\)/);
  const link = section.locator(`a[href="/consultation/${visitId}"]`);
  await expect(link).toContainText("opened");
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/consultation/${visitId}$`));
  await expect(page.getByRole("status").filter({ hasText: "Amending a signed consultation" })).toBeVisible();
});
