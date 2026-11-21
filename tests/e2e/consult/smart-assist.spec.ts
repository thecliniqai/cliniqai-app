/**
 * V2-09b 09B-04a (R-11, R-13; AI-07, AI-10): the read side of Smart Assist on the consult and on Today. Every check runs with AI fully disabled: the e2e
 * server has no provider environment, and `platform_settings.ai_features` (the platform kill switch) is set to all off for the duration of the file and
 * restored after it. Smart Assist is deterministic and does not depend on it.
 *   - "Likely from the complaints": with the doctor's own signed history, one tap adds the diagnosis (the `ux` counter records 1 action, 0 typed);
 *   - typing "htn" finds the hypertension entry (a synonym and the abbreviation table), Enter adds it with its ICD-11 code;
 *   - the snapshot shows on the consult (the patient column at 1280, the Patient sheet at 820) and on Today doctor mode beside the Next card at 820;
 *   - a reopened (amending) record of the doctor's own appears under "Open amendments" on Today and links to its consult.
 * V2-09b 09B-04b (R-14, R-15; AI-09, AI-15): the write side. The shorthand bar inserts "c/o fever 3d, cough 2d; adv steam inhalation BD; f/u 5d" as two complaints
 * with their durations, one advice line and a five-day follow-up, and nothing else, only on Enter; a macro expands; the macro list adds, edits and deletes the
 * doctor's own macros; a follow-up phrase in the advice offers a chip, the tap sets the date, "Book follow-up" opens the booking sheet with the date and one
 * visit is booked; the front desk's Today row offers the same action and hides it after booking; a follow-up that is not booked enqueues no message; with
 * `assist.shorthand` and `assist.followup` overridden off the bar and the chip are absent.
 * Synthetic data only.
 */
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { awaitHydrated } from "../support/hydrated";
import { freeBookingDate, istDate, run, seedPatient, seedPrescription, seedSignedConsultation, seedVisit, signSeededVisit, testTag, visitsOf } from "../support/m0-data";
import { filterToday, openToday, rowOf } from "../support/today-page";
import { bookingSheet, slotsLoaded } from "../support/schedule-page";
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


// ---- 09B-04b: the write side ---------------------------------------------------------------------------------------------------------------

const SHORTHAND = "c/o fever 3d, cough 2d; adv steam inhalation BD; f/u 5d";

async function notesOf(visitId: string) {
  const { data, error } = await admin.from("clinical_notes").select("chief_complaints, clinical_notes, advice, investigations_advised, specialty_data").eq("visit_id", visitId).single();
  if (error) throw new Error(error.message);
  return data;
}

async function followUpOf(visitId: string) {
  const { data, error } = await admin.from("follow_ups").select("follow_up_date, notes").eq("visit_id", visitId).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

const savedStatus = (page: Page) => page.locator("[data-save-status='saved']");

/** A fresh open consult of the doctor for a new patient; returns the visit id and the patient (the macros of the doctor are removed first). */
async function openFreshConsult(page: Page, label: string) {
  const patient = await seedPatient(run().tenantA.id, run().tenantA.users.owner.id, `E2E Synthetic ${label} ${testTag()}`);
  const visitId = await openConsultFor(page, patient.id);
  return { visitId, patient };
}

async function clearMacros() {
  const { error } = await admin.from("doctor_text_macros").delete().eq("tenant_id", run().tenantA.id);
  if (error) throw new Error(error.message);
}

test.describe("shorthand and follow-up (09B-04b)", () => {
  test.beforeEach(async () => {
    await clearMacros();
  });
  test.afterAll(async () => {
    await clearMacros();
  });

  test("the shorthand lands in Complaints, Advice and the follow-up and nothing else; only Enter inserts it", async ({ page, ux }) => {
    ux.flow("consult-shorthand", "Shorthand: the bar, the text, Enter");
    const { visitId } = await openFreshConsult(page, "Shorthand");
    const before = await notesOf(visitId);

    await ux.click(page.getByRole("button", { name: "Shorthand" }), "Shorthand button");
    const bar = page.getByRole("dialog", { name: "Shorthand" });
    await expect(bar).toBeVisible();
    await ux.fill(bar.getByRole("textbox", { name: "Shorthand" }), SHORTHAND, "Shorthand text");

    // The preview names every part with its section; nothing is in the note yet.
    const preview = bar.locator("[data-shorthand-preview]");
    await expect(preview).toContainText("Smart Assist");
    await expect(preview.locator("[data-shorthand-group='complaints']")).toContainText("Fever");
    await expect(preview.locator("[data-shorthand-group='complaints']")).toContainText("3 days");
    await expect(preview.locator("[data-shorthand-group='complaints']")).toContainText("Cough");
    await expect(preview.locator("[data-shorthand-group='complaints']")).toContainText("2 days");
    await expect(preview.locator("[data-shorthand-group='advice']")).toContainText("steam inhalation twice daily");
    await expect(preview.locator("[data-shorthand-group='follow-up']")).toContainText("5 days");
    await expect(page.getByRole("list", { name: "Complaints added" })).toHaveCount(0);
    expect((await notesOf(visitId)).chief_complaints).toEqual(before.chief_complaints);

    await ux.press(bar.getByRole("textbox", { name: "Shorthand" }), "Enter", "Enter inserts");
    await expect(bar).toHaveCount(0);
    ux.done();
    expect(ux.counts()?.keystrokes).toBe(SHORTHAND.length + 1);
    expect(ux.counts()?.actions).toBe(2);

    const rows = page.getByRole("list", { name: "Complaints added" }).getByRole("listitem");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText("Fever");
    await expect(page.getByRole("radiogroup", { name: "Duration of Fever" }).getByRole("radio", { name: "3d" })).toBeChecked();
    await expect(page.getByRole("radiogroup", { name: "Duration of Cough" }).getByRole("radio", { name: "2d" })).toBeChecked();
    // The line equals the catalogue tile ignoring case, so it is stored in the tile's spelling and the tile shows as chosen.
    await expect(page.getByRole("group", { name: "Diet and general advice" }).getByRole("button", { name: "Steam inhalation twice daily" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("radiogroup", { name: "Follow-up" }).getByRole("radio", { name: /5 days/ })).toBeChecked();

    await expect(savedStatus(page)).toBeVisible({ timeout: 9_000 });
    await expect
      .poll(async () => {
        const n = await notesOf(visitId);
        return {
          complaints: (n.chief_complaints as Array<{ symptom: string; duration_val?: number; duration_unit?: string }>).map((c) => [c.symptom, c.duration_val, c.duration_unit]),
          advice: n.advice,
          note: n.clinical_notes,
          tests: n.investigations_advised,
        };
      }, { timeout: 12_000 })
      .toEqual({
        complaints: [["Fever", 3, "days"], ["Cough", 2, "days"]],
        advice: ["Steam inhalation twice daily"],
        note: before.clinical_notes,
        tests: before.investigations_advised,
      });
    expect(await followUpOf(visitId)).toEqual({ follow_up_date: istDate(5), notes: null });
  });

  test("Escape discards the shorthand: nothing is inserted", async ({ page }) => {
    const { visitId } = await openFreshConsult(page, "ShorthandEscape");
    await page.getByRole("button", { name: "Shorthand" }).click();
    const bar = page.getByRole("dialog", { name: "Shorthand" });
    await bar.getByRole("textbox", { name: "Shorthand" }).fill("c/o headache 2d");
    await expect(bar.locator("[data-shorthand-preview]")).toContainText("Headache");
    await page.keyboard.press("Escape");
    await expect(bar).toHaveCount(0);
    await expect(page.getByRole("list", { name: "Complaints added" })).toHaveCount(0);
    await page.waitForTimeout(500);
    expect((await notesOf(visitId)).chief_complaints).toEqual([]);
    // Re-opening starts empty.
    await page.getByRole("button", { name: "Shorthand" }).click();
    await expect(page.getByRole("dialog", { name: "Shorthand" }).getByRole("textbox", { name: "Shorthand" })).toHaveValue("");
  });

  test("the / key opens the bar when the shortcut switch is on, and a macro expands", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome", "a hardware keyboard shortcut: the fine-pointer desktop only");
    const { tenantA } = run();
    const created = await admin.from("doctor_text_macros").insert({ tenant_id: tenantA.id, doctor_id: tenantA.users.doctor.id, shortcut: ".ur", expansion: "adv rest, plenty of fluids" });
    expect(created.error).toBeNull();
    await page.addInitScript(() => localStorage.setItem("clinicos.pref.shortcuts", "on"));
    const { visitId } = await openFreshConsult(page, "ShorthandMacro");
    await page.keyboard.press("/");
    const bar = page.getByRole("dialog", { name: "Shorthand" });
    await expect(bar).toBeVisible();
    const input = bar.getByRole("textbox", { name: "Shorthand" });
    await expect(input).toBeFocused();
    await input.pressSequentially("c/o cough 2d; .u");
    // The macro that matches what is being typed is listed; a tap completes the token and the preview shows its text.
    await bar.locator("[data-macro-match='.ur']").click();
    await expect(input).toHaveValue("c/o cough 2d; .ur ");
    await expect(bar.locator("[data-shorthand-group='advice']")).toContainText("rest");
    await expect(bar.locator("[data-shorthand-group='advice']")).toContainText("plenty of fluids");
    await input.focus();
    await input.press("Enter");
    await expect(bar).toHaveCount(0);
    await expect(savedStatus(page)).toBeVisible({ timeout: 9_000 });
    await expect.poll(async () => (await notesOf(visitId)).advice, { timeout: 12_000 }).toEqual(["rest", "plenty of fluids"]);
  });

  test("the macro list adds, edits and deletes the doctor's own macros", async ({ page }) => {
    const { tenantA } = run();
    await openFreshConsult(page, "MacroList");
    await page.getByRole("button", { name: "Shorthand" }).click();
    await page.getByRole("dialog", { name: "Shorthand" }).getByRole("button", { name: "Macros" }).click();
    const list = page.getByRole("dialog", { name: "Macros" });
    await expect(list).toBeVisible();
    await list.locator("[data-macro-shortcut]").fill("ZZ1");
    await list.locator("[data-macro-expansion]").fill("adv rest");
    await list.locator("[data-macro-save]").click();
    const row = list.locator("[data-macro-row='.zz1']");
    await expect(row).toContainText("adv rest");
    const stored = await admin.from("doctor_text_macros").select("shortcut, expansion, doctor_id").eq("tenant_id", tenantA.id);
    expect(stored.data).toEqual([{ shortcut: ".zz1", expansion: "adv rest", doctor_id: tenantA.users.doctor.id }]);

    await list.getByRole("button", { name: "Edit .zz1" }).click();
    await list.locator("[data-macro-expansion]").fill("adv rest, fluids");
    await list.locator("[data-macro-save]").click();
    await expect(row).toContainText("adv rest, fluids");
    expect((await admin.from("doctor_text_macros").select("expansion").eq("tenant_id", tenantA.id)).data).toEqual([{ expansion: "adv rest, fluids" }]);

    await list.getByRole("button", { name: "Delete .zz1" }).click();
    await expect(row).toHaveCount(0);
    expect((await admin.from("doctor_text_macros").select("id").eq("tenant_id", tenantA.id)).data).toEqual([]);
  });

  test("a follow-up phrase in the advice offers a chip; the tap sets the date; Book follow-up opens the booking sheet and one visit is booked", async ({ page }) => {
    const { tenantA } = run();
    const doctorId = tenantA.users.doctor.id;
    const { visitId, patient } = await openFreshConsult(page, "FollowUp");
    const advice = page.getByLabel("Custom advice");
    await advice.fill("review after 3 days");
    await advice.press("Enter");

    const chip = page.locator("[data-follow-up-suggestion]");
    await expect(chip).toContainText("Smart Assist");
    await expect(chip.getByRole("button")).toContainText(/^Set follow-up: 3 days \(\w{3}, \d{1,2} \w{3}\)$/);
    // Nothing is set until the tap: the screen still has the preselected default and the database has no follow-up.
    await expect(page.getByRole("radiogroup", { name: "Follow-up" }).getByRole("radio", { name: /5 days/ })).toBeChecked();
    expect(await followUpOf(visitId)).toBeNull();

    await chip.getByRole("button").click();
    await expect(page.getByRole("radiogroup", { name: "Follow-up" }).getByRole("radio", { name: /3 days/ })).toBeChecked();
    await expect(page.locator("#follow-up-date-input")).toHaveValue(istDate(3));
    await expect(page.locator("#follow-up-notes-input")).toHaveValue("review after 3 days");
    await expect(chip).toHaveCount(0);
    await expect(savedStatus(page)).toBeVisible({ timeout: 9_000 });
    await expect.poll(() => followUpOf(visitId), { timeout: 12_000 }).toEqual({ follow_up_date: istDate(3), notes: "review after 3 days" });

    // A follow-up row alone enqueues no message (PO-8).
    const queued = await admin.from("communication_queue").select("id", { count: "exact", head: true }).eq("tenant_id", tenantA.id).eq("patient_id", patient.id);
    expect(queued.count).toBe(0);

    // Book follow-up: the sheet opens over the consult with the patient and the date; the doctor confirms the slot.
    const date = await freeBookingDate(tenantA.id, doctorId);
    await page.locator("#follow-up-date-input").fill(date);
    await page.getByRole("link", { name: "Book follow-up" }).click();
    const sheet = bookingSheet(page);
    await expect(sheet).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`book=1.*date=${date}|date=${date}.*book=1`));
    await expect(sheet.locator("[data-booking-patient]")).toContainText(patient.phone ? /E2E Synthetic FollowUp/ : /E2E/);
    await slotsLoaded(sheet);
    await sheet.getByRole("button", { name: "Book", exact: true }).click();
    await expect(sheet).toHaveCount(0);
    await expect(page.locator("[data-follow-up-booked]")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("link", { name: "Book follow-up" })).toHaveCount(0);
    const booked = (await visitsOf(tenantA.id, patient.id)).filter((v) => v.status === "booked" || v.status === "confirmed");
    expect(booked).toHaveLength(1);
  });

  test("with assist.shorthand and assist.followup overridden off the bar, the chip and Book follow-up are absent", async ({ page }) => {
    const { tenantA } = run();
    const inserted = await admin.from("tenant_entitlement_overrides").insert([
      { tenant_id: tenantA.id, key: "assist.shorthand", enabled: false, reason: "Synthetic test: shorthand off" },
      { tenant_id: tenantA.id, key: "assist.followup", enabled: false, reason: "Synthetic test: follow-up off" },
    ]);
    expect(inserted.error).toBeNull();
    try {
      await page.addInitScript(() => localStorage.setItem("clinicos.pref.shortcuts", "on"));
      await openFreshConsult(page, "AssistOff");
      await expect(page.getByRole("button", { name: "Shorthand" })).toHaveCount(0);
      await page.keyboard.press("/");
      await expect(page.getByRole("dialog", { name: "Shorthand" })).toHaveCount(0);
      const advice = page.getByLabel("Custom advice");
      await advice.fill("review after 3 days");
      await advice.press("Enter");
      await expect(page.getByText("review after 3 days")).toBeVisible();
      await expect(page.locator("[data-follow-up-suggestion]")).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Book follow-up" })).toHaveCount(0);
    } finally {
      await admin.from("tenant_entitlement_overrides").delete().eq("tenant_id", tenantA.id).in("key", ["assist.shorthand", "assist.followup"]);
    }
  });
});

test.describe("the front desk's Book follow-up on Today (09B-04b)", () => {
  test.use({ storageState: storageStatePath("receptionist") });

  test("a completed visit with a recommended follow-up offers Book follow-up; booking creates one visit and the action goes away", async ({ page }) => {
    const { tenantA } = run();
    const doctorId = tenantA.users.doctor.id;
    const date = await freeBookingDate(tenantA.id, doctorId);
    const name = `E2E Synthetic Desk FollowUp ${testTag()}`;
    const patient = await seedPatient(tenantA.id, tenantA.users.owner.id, name);
    await seedSignedFor(patient.id, { complaint: "Cough", diagnosis: "Viral fever E2E", icd11: "MG26", followUpDate: date });

    await openToday(page, "/today");
    await filterToday(page, name);
    const action = rowOf(page, name).getByRole("link", { name: `Book follow-up for ${name}` });
    await expect(action).toBeVisible();
    await action.click();
    const sheet = bookingSheet(page);
    await expect(sheet).toBeVisible();
    await expect(sheet.locator("[data-booking-patient]")).toContainText(name);
    await slotsLoaded(sheet);
    await sheet.getByRole("button", { name: "Book", exact: true }).click();
    await expect(sheet).toHaveCount(0);
    const booked = (await visitsOf(tenantA.id, patient.id)).filter((v) => v.status === "booked" || v.status === "confirmed");
    expect(booked).toHaveLength(1);
    await filterToday(page, name);
    await expect(rowOf(page, name)).toBeVisible();
    await expect(rowOf(page, name).getByRole("link", { name: `Book follow-up for ${name}` })).toHaveCount(0, { timeout: 15_000 });
  });
});
