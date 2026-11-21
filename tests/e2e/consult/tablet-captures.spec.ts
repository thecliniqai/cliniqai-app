/**
 * V2-09b 09B-02b (PWA-03b, R-7): the consult at 360, 744, 820, 1180, 1280 and 1440 px, draft and amending. Per width the structural assertions
 * (which regions exist, the label column, the summary pane's default) and a capture written to
 * `.planning/phases/09B-consult-workspace/evidence/screens/`, next to the V2-DX references in
 * `.planning/sketches/v2-dx-evidence/screens/consult*`. The captures are produced by this run, never hand-made; the reviewer judges them against
 * the references. The PR lane runs it on desktop-chrome; the nightly tablet projects (ipad-mini-744, android-tablet-800, ipad-gen7, the landscape ones)
 * run it once for the 09B-02b gate. Synthetic data only.
 */
import fs from "node:fs";
import path from "node:path";
import type { Page, TestInfo } from "@playwright/test";
import { expect, test } from "../fixtures";
import { ROOT } from "../support/app-env";
import { getAdminClient } from "../../helpers/supabase-admin";
import { seedClinicalNotes } from "../../helpers/clinical-notes";
import { run, seedPatient, seedSignedConsultation, seedVisit, testTag } from "../support/m0-data";
import { storageStatePath } from "../support/run-data";

test.use({ storageState: storageStatePath("doctor") });

const OUT_DIR = path.join(ROOT, ".planning/phases/09B-consult-workspace/evidence/screens");
const REASON = "Added the missing antibiotic after the patient called back";

interface Expect {
  width: number;
  height: number;
  strip: boolean;
  finishBar: boolean;
  patientColumn: boolean;
  patientButton: boolean;
  summaryToggle: boolean;
  summaryPane: boolean;
  labelColumn: number | "stacked";
}

const WIDTHS: Expect[] = [
  { width: 360, height: 780, strip: true, finishBar: true, patientColumn: false, patientButton: true, summaryToggle: false, summaryPane: false, labelColumn: "stacked" },
  { width: 744, height: 1000, strip: true, finishBar: true, patientColumn: false, patientButton: true, summaryToggle: false, summaryPane: false, labelColumn: "stacked" },
  { width: 820, height: 1180, strip: false, finishBar: false, patientColumn: false, patientButton: true, summaryToggle: false, summaryPane: false, labelColumn: 96 },
  { width: 1180, height: 820, strip: false, finishBar: false, patientColumn: true, patientButton: false, summaryToggle: false, summaryPane: false, labelColumn: 120 },
  { width: 1280, height: 800, strip: false, finishBar: false, patientColumn: true, patientButton: false, summaryToggle: true, summaryPane: false, labelColumn: 120 },
  { width: 1440, height: 900, strip: false, finishBar: false, patientColumn: true, patientButton: false, summaryToggle: true, summaryPane: true, labelColumn: 120 },
];

async function seedDraft(): Promise<string> {
  const { tenantA } = run();
  const patient = await seedPatient(tenantA.id, tenantA.users.owner.id, `E2E Synthetic Capture ${testTag()}`);
  const { error } = await getAdminClient().from("patients").update({ allergies: ["Penicillin"], chronic_conditions: ["T2DM", "HTN"] }).eq("id", patient.id);
  if (error) throw new Error(error.message);
  const visitId = await seedVisit({
    tenantId: tenantA.id,
    patientId: patient.id,
    doctorId: tenantA.users.doctor.id,
    createdBy: tenantA.users.receptionist.id,
    status: "in_consultation",
  });
  await seedClinicalNotes(visitId, {
    vitals: { systolic: 148, diastolic: 92, pulse: 84, temperature: 99.1, spo2: 98, weight: 71 },
    chief_complaints: [
      { id: "c1", symptom: "Fever", duration_val: 3, duration_unit: "days", notes: null },
      { id: "c2", symptom: "Cough", duration_val: 5, duration_unit: "days", notes: "dry, worse at night" },
    ],
    clinical_notes: "Synthetic note: fever for three days with a dry cough, no breathlessness.",
    investigations_advised: ["Complete Blood Count (CBC)"],
    advice: ["Steam inhalation twice daily"],
  });
  return visitId;
}

async function widthOf(page: Page, selector: string): Promise<number> {
  return page.locator(selector).first().evaluate((el) => Math.round(el.getBoundingClientRect().width));
}

async function assertStructure(page: Page, e: Expect, state: string): Promise<void> {
  const label = `${state} at ${e.width}px`;
  const count = (selector: string) => page.locator(selector).filter({ visible: true }).count();
  expect(await count("[data-section-strip]") > 0, `section strip, ${label}`).toBe(e.strip);
  expect(await count("[data-finish-bar]") > 0, `Finish bar, ${label}`).toBe(e.finishBar);
  expect(await count("[data-patient-column]") > 0, `patient column, ${label}`).toBe(e.patientColumn);
  expect((await page.getByRole("button", { name: "Patient", exact: true }).filter({ visible: true }).count()) > 0, `Patient button, ${label}`).toBe(e.patientButton);
  expect((await page.getByRole("button", { name: "Summary", exact: true }).filter({ visible: true }).count()) > 0 && e.width >= 768, `Summary toggle, ${label}`).toBe(e.summaryToggle);
  expect(await count("[data-summary-pane]") > 0, `summary pane, ${label}`).toBe(e.summaryPane);
  await expect(page.locator("[data-allergy-strip]"), `allergy strip, ${label}`).toBeVisible();
  const heading = await widthOf(page, "#complaints-title");
  const column = await page.locator("#complaints-title").evaluate((h) => Math.round((h.parentElement as HTMLElement).getBoundingClientRect().width));
  if (e.labelColumn === "stacked") expect(column, `label above the body, ${label}`).toBeGreaterThan(Math.min(e.width, 700) - 80);
  else expect(column, `label column, ${label}`).toBe(e.labelColumn);
  expect(heading).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `no horizontal scroll, ${label}`).toBe(true);
}

async function capture(page: Page, testInfo: TestInfo, state: string, width: number): Promise<void> {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const project = testInfo.project.name === "desktop-chrome" ? "" : `-${testInfo.project.name}`;
  await page.screenshot({ path: path.join(OUT_DIR, `consult-${state}-${width}${project}.png`), animations: "disabled", caret: "hide" });
}

for (const e of WIDTHS) {
  test(`draft at ${e.width} px: structure and capture`, async ({ page }, testInfo) => {
    const visitId = await seedDraft();
    await page.setViewportSize({ width: e.width, height: e.height });
    await page.goto(`/consultation/${visitId}`);
    await expect(page.locator("[data-consult-workspace]")).toBeVisible();
    await expect(page.getByLabel("History of Present Illness & Clinical Notes")).toHaveValue(/dry cough/);
    await assertStructure(page, e, "draft");
    await capture(page, testInfo, "draft", e.width);
  });

  test(`amending at ${e.width} px: structure, banner and capture`, async ({ page }, testInfo) => {
    const { visitId } = await seedSignedConsultation("Capture Amending");
    await page.setViewportSize({ width: e.width, height: e.height });
    await page.goto(`/consultation/${visitId}`);
    await page.getByRole("button", { name: "Amend", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Reopen Visit for Clinical Amendment" });
    await dialog.getByLabel(/Reason for Amendment/).fill(REASON);
    await dialog.getByRole("button", { name: /Confirm & Reopen for Amendment/ }).click();
    await expect(page.getByTestId("amending-banner")).toContainText(`(v1 to v2): ${REASON} · opened`, { timeout: 30_000 });
    await assertStructure(page, e, "amending");
    await capture(page, testInfo, "amending", e.width);
  });
}
