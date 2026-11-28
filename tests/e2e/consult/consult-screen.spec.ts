/**
 * V2-09e 09E-05 (R-8, R-9): the consult in one read, and the doctor's lists in its query.
 *   - A full load of a draft consult asks the database for its parts through ONE call (`rpc/consult_screen`): none of the reads the page used to make
 *     (notes, diagnoses, prescriptions, follow-ups, documents, macros, revisions, queue tokens) appears in the Kong window of the server's calls.
 *   - Opening the Templates sheet makes 0 Supabase calls (Kong window, server and browser), twice; the doctor's templates came with the consult.
 *   - Saving a template adds it to the list from the action's result: the save's window holds no re-read of the templates table, and reopening the sheet
 *     makes 0 calls and shows the new template.
 * Each test makes its own doctor (own-doctor.ts) and reads only what it wrote (desktop-chrome, pixel-7 and iphone-15 share one database). retries 0: a pass on
 * retry would hide a defect. Synthetic data only.
 */
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { awaitHydrated } from "../support/hydrated";
import { countKongCalls } from "../support/kong-calls";
import { run, seedPatient, seedPrescription, seedVisit, testTag } from "../support/m0-data";
import { storageStatePath, type RunUser } from "../support/run-data";
import { retireOwnDoctor, seedOwnDoctor, signInAsOwnDoctor } from "../support/own-doctor";
import { getAdminClient } from "../../helpers/supabase-admin";

test.use({ storageState: storageStatePath("doctor") });
test.describe.configure({ mode: "serial" });

const admin = getAdminClient();
let doctor: (RunUser & { name: string }) | null = null;

test.afterEach(async () => {
  if (doctor) await retireOwnDoctor(doctor);
  doctor = null;
});

async function openConsult(page: Page, label: string, withLine: boolean): Promise<{ visitId: string; tag: string }> {
  const { tenantA } = run();
  const own = await seedOwnDoctor(label);
  doctor = own;
  const tag = testTag();
  const patient = await seedPatient(tenantA.id, tenantA.users.owner.id, `E2E Synthetic ${label} ${tag}`);
  const visitId = await seedVisit({ tenantId: tenantA.id, patientId: patient.id, doctorId: own.id, createdBy: tenantA.users.receptionist.id, status: "in_consultation" });
  if (withLine) await seedPrescription({ tenantId: tenantA.id, visitId, patientId: patient.id, doctorId: own.id, medicineName: `E2E Screen Medicine ${tag}` });
  for (const n of ["One", "Two"]) {
    await admin
      .from("doctor_prescription_templates")
      .insert({
        tenant_id: tenantA.id,
        doctor_id: own.id,
        template_name: `E2E Template ${n} ${tag}`,
        items: [{ medicine_name: `E2E Template Line ${n}`, generic_name: null, dose_form: null, dosage: "1-0-1", timing: null, duration: "3 days", sort_order: 0 }],
      })
      .throwOnError();
  }
  await signInAsOwnDoctor(page, own);
  return { visitId, tag };
}

/** Waits until the page has hydrated and its first requests have settled (nothing of the open page's own start-up is in a measured window). */
async function settle(page: Page): Promise<void> {
  await expect(page.getByLabel("History of Present Illness & Clinical Notes")).toBeVisible();
  await awaitHydrated(page);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1_500);
}

const TABLES_THE_OLD_PAGE_READ = /^(GET|HEAD) \/rest\/v1\/(clinical_notes|consultation_diagnoses|prescriptions|prescription_items|follow_ups|queue_tokens|doctor_text_macros|patient_documents|visit_revisions|doctor_prescription_templates)$/;

test("a full load of a draft consult reads its parts through one call, not the old table reads", async ({ page }) => {
  const { visitId } = await openConsult(page, "ScreenOneCall", true);
  const window = await countKongCalls(async () => {
    await page.goto(`/consultation/${visitId}`);
    await settle(page);
  });
  expect(window.serverByPath["POST /rest/v1/rpc/consult_screen"], JSON.stringify(window.serverByPath)).toBe(1);
  const oldReads = Object.keys(window.serverByPath).filter((k) => TABLES_THE_OLD_PAGE_READ.test(k));
  expect(oldReads, JSON.stringify(window.serverByPath)).toEqual([]);
  const assistReads = Object.keys(window.serverByPath).filter((k) => /rpc\/(consult_assist_context|patient_snapshot|rx_allergy_context|my_entitlements)$/.test(k));
  expect(assistReads, JSON.stringify(window.serverByPath)).toEqual([]);
});

test("opening Templates makes 0 Supabase calls, and a saved template joins the list from the action's result", async ({ page }) => {
  const { visitId, tag } = await openConsult(page, "ScreenTemplates", true);
  await page.goto(`/consultation/${visitId}`);
  await settle(page);
  const rx = page.locator("#prescription");

  // Opening the sheet, twice: the doctor's templates are already in the consult's query.
  for (let round = 0; round < 2; round++) {
    const opened = await countKongCalls(async () => {
      await rx.getByRole("button", { name: "Templates" }).click();
      await expect(page.getByRole("dialog", { name: "Templates" }).getByText(`E2E Template One ${tag}`)).toBeVisible();
      await expect(page.getByRole("dialog", { name: "Templates" }).getByText(`E2E Template Two ${tag}`)).toBeVisible();
    });
    expect(opened.calls, JSON.stringify(opened.calls)).toEqual([]);
    if (round === 0) await page.keyboard.press("Escape");
  }

  // Save the prescription as a template: one write, no re-read of the list.
  const sheet = page.getByRole("dialog", { name: "Templates" });
  const name = `E2E Saved Template ${tag}`;
  const saved = await countKongCalls(async () => {
    await sheet.getByLabel("Save this prescription as a template").fill(name);
    await sheet.getByRole("button", { name: "Save", exact: true }).click();
    await expect(sheet.getByText(name)).toBeVisible();
  });
  expect(Object.keys(saved.serverByPath).filter((k) => /^GET \/rest\/v1\/doctor_prescription_templates$/.test(k)), JSON.stringify(saved.serverByPath)).toEqual([]);
  expect(saved.browser, JSON.stringify(saved.browserByPath)).toBe(0);
  // The row is the doctor's own and is stored.
  const stored = await admin.from("doctor_prescription_templates").select("template_name").eq("doctor_id", doctor!.id).eq("template_name", name);
  expect(stored.data).toHaveLength(1);

  // Closed and opened again: still 0 calls, and the new template is there with the two the consult came with.
  await page.keyboard.press("Escape");
  const again = await countKongCalls(async () => {
    await rx.getByRole("button", { name: "Templates" }).click();
    await expect(sheet.getByText(name)).toBeVisible();
    await expect(sheet.getByText(`E2E Template One ${tag}`)).toBeVisible();
  });
  expect(again.calls, JSON.stringify(again.calls)).toEqual([]);
});
