/**
 * V2-09c 09C-02 (R-6 to R-8; roadmap acceptance 3): the allergy check on the consult. A known allergen triggers an inline warning BEFORE the medicine is added;
 * it is stored only with a reason (and the database refuses it otherwise); "not recorded", "no known allergies" and "known" stay distinct; the allergies are
 * recorded through the editor's substance typeahead; a free-text allergy is checked by name. Synthetic CDCI rows (a made-up substance and brands), one doctor
 * and one patient per test (desktop-chrome, pixel-7 and iphone-15 share one database in the PR lane).
 */
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { awaitHydrated } from "../support/hydrated";
import { run, seedPatient, seedVisit, testTag } from "../support/m0-data";
import { storageStatePath, type RunUser } from "../support/run-data";
import { retireOwnDoctor, seedOwnDoctor, signInAsOwnDoctor } from "../support/own-doctor";
import { addCustomMedicine, rxField, rxStored } from "../support/rx-entry";
import { getAdminClient } from "../../helpers/supabase-admin";
import { AL_BRANDS, AL_SUBSTANCES, seedAllergyCatalogue } from "../../helpers/cdci-allergy";

test.use({ storageState: storageStatePath("doctor") });

const admin = getAdminClient();
let doctor: RunUser | null = null;
test.afterEach(async () => {
  if (doctor) await retireOwnDoctor(doctor);
  doctor = null;
});

/** A consult for the test's own doctor and a new patient with the given allergies (`null`: not recorded). */
async function openConsult(page: Page, label: string, allergies: string[] | null): Promise<{ visitId: string; patientId: string }> {
  await seedAllergyCatalogue();
  const { tenantA } = run();
  const own = await seedOwnDoctor(label);
  doctor = own;
  const patient = await seedPatient(tenantA.id, tenantA.users.owner.id, `E2E Synthetic ${label} ${testTag()}`);
  await admin.from("patients").update({ allergies }).eq("id", patient.id).throwOnError();
  const visitId = await seedVisit({ tenantId: tenantA.id, patientId: patient.id, doctorId: own.id, createdBy: tenantA.users.receptionist.id, status: "in_consultation" });
  await signInAsOwnDoctor(page, own);
  await page.addInitScript(() => localStorage.setItem("clinicos.pref.shortcuts", "on"));
  await page.goto(`/consultation/${visitId}`);
  await expect(page.getByLabel("History of Present Illness & Clinical Notes")).toBeVisible();
  await awaitHydrated(page);
  return { visitId, patientId: patient.id };
}

const rxList = (page: Page) => page.getByRole("list", { name: "Prescribed medicines" }).getByRole("listitem");
const storedAllergies = async (patientId: string) => (await admin.from("patients").select("allergies").eq("id", patientId).single()).data?.allergies;

test("@golden a known allergen is flagged before it is added, stored only with a reason, and the line shows it (acceptance 3)", async ({ page }) => {
  const { visitId } = await openConsult(page, "AllergyFlag", [AL_SUBSTANCES.amox.name]);
  const rx = page.locator("#prescription");
  await expect(page.locator("[data-allergy-strip]")).toContainText(`Allergy: ${AL_SUBSTANCES.amox.name}`);

  // The search result carries the danger chip before anything is added.
  await rxField(rx).fill("qzxmoxy");
  const option = rx.getByRole("option", { name: new RegExp(AL_BRANDS.amoxBrand.brand) });
  await expect(option).toBeVisible({ timeout: 10_000 });
  await expect(option.locator("[data-allergy-chip]")).toHaveText("Allergy");
  await rxField(rx).press("Enter");
  // The dose builder says what it matches.
  await expect(rx.locator("[data-dose-notice]")).toHaveText(`Matches allergy: ${AL_SUBSTANCES.amox.name}`);
  for (const key of ["1", "5", "d"]) await rxField(rx).press(key);
  // Enter asks for the reason instead of adding.
  await rxField(rx).press("Enter");
  const reasonField = rx.getByLabel("Reason to prescribe anyway");
  await expect(reasonField).toBeVisible();
  await expect(reasonField).toBeFocused();
  await expect(rx.getByRole("button", { name: "Prescribe anyway" })).toBeVisible();
  // Enter without a reason adds nothing and says why.
  await reasonField.press("Enter");
  await expect(rx.getByRole("alert").filter({ hasText: /reason of at least 5 characters/ })).toBeVisible();
  await page.waitForTimeout(400);
  expect(await rxStored(page, visitId)).toEqual([]);
  // "Prescribe anyway" with a reason stores the line and its override.
  await reasonField.fill("Tolerated before, patient informed");
  await rx.getByRole("button", { name: "Prescribe anyway" }).click();
  await expect(rxList(page)).toHaveCount(1, { timeout: 10_000 });
  await expect(rx.locator("[data-rx-note]")).toContainText("Prescribed despite allergy: Tolerated before, patient informed");
  const { data } = await admin
    .from("prescription_items")
    .select("medicine_name, allergy_override")
    .eq("prescription_id", (await admin.from("prescriptions").select("id").eq("visit_id", visitId).single()).data!.id);
  expect(data).toHaveLength(1);
  expect(data![0].medicine_name).toBe(AL_BRANDS.amoxBrand.brand);
  expect(data![0].allergy_override).toMatchObject({ reason: "Tolerated before, patient informed", allergens: [AL_SUBSTANCES.amox.name] });
  // A medicine that matches nothing needs no reason.
  await rxField(rx).fill("qzxdolo");
  await expect(rx.getByRole("option", { name: new RegExp(AL_BRANDS.paraBrand.brand) })).toBeVisible({ timeout: 10_000 });
  await expect(rx.locator("[data-allergy-chip]")).toHaveCount(0);
});

test("a free-text allergy flags a custom line by name, and a line with no substances says it was checked by name only", async ({ page }) => {
  const { visitId } = await openConsult(page, "AllergyName", ["Augmentin"]);
  const rx = page.locator("#prescription");
  const name = "Augmentin 625";
  await rxField(rx).fill(name);
  await expect(rx.getByRole("option", { name: new RegExp(`^Add .${name}.$`) })).toBeVisible({ timeout: 10_000 });
  const options = await rx.getByRole("option").count();
  for (let i = 0; i < Math.max(1, options - 1); i++) await rxField(rx).press("ArrowDown");
  await rxField(rx).press("Enter");
  await expect(rx.locator("[data-dose-notice]")).toHaveText("Matches allergy: Augmentin");
  for (const key of ["1", "5", "d", "Enter"]) await rxField(rx).press(key);
  await rx.getByLabel("Reason to prescribe anyway").fill("Different brand, reviewed");
  await rx.getByLabel("Reason to prescribe anyway").press("Enter");
  await expect(rxList(page)).toHaveCount(1, { timeout: 10_000 });
  // Another custom medicine with no match: the line says it was checked by name only (the allergies are known).
  await addCustomMedicine(rx, `E2E Plain Tablet ${testTag()}`);
  await expect(rx.locator("[data-rx-note]").filter({ hasText: "Checked by name only" })).toHaveCount(1, { timeout: 10_000 });
  expect((await rxStored(page, visitId)).length).toBe(2);
});

test("an allergy recorded after a line was added flags it, and 'Prescribe anyway' with a reason confirms it", async ({ page }) => {
  const { visitId, patientId } = await openConsult(page, "AllergyLate", null);
  const rx = page.locator("#prescription");
  await rxField(rx).fill("qzxmoxy");
  await expect(rx.getByRole("option", { name: new RegExp(AL_BRANDS.amoxBrand.brand) })).toBeVisible({ timeout: 10_000 });
  for (const key of ["Enter", "1", "5", "d", "Enter"]) await rxField(rx).press(key);
  await expect(rxList(page)).toHaveCount(1, { timeout: 10_000 });
  // The allergy is recorded afterwards (here by the clinic's own tools): the page reads the context again after the next change.
  await admin.from("patients").update({ allergies: [AL_SUBSTANCES.amox.name] }).eq("id", patientId).throwOnError();
  await page.reload();
  await awaitHydrated(page);
  const line = page.locator("[data-rx-line]");
  await expect(line).toHaveAttribute("data-flagged", "true");
  await expect(line.locator("[data-allergy-match]")).toContainText(`Matches allergy: ${AL_SUBSTANCES.amox.name}`);
  await line.getByRole("button", { name: "Prescribe anyway…" }).click();
  await line.getByLabel("Reason to prescribe anyway").fill("Reviewed with the patient");
  await line.getByRole("button", { name: "Prescribe anyway", exact: true }).click();
  await expect(line.locator("[data-allergy-match]")).toHaveCount(0, { timeout: 10_000 });
  await expect(rx.locator("[data-rx-note]")).toContainText("Prescribed despite allergy: Reviewed with the patient");
  expect(visitId).toBeTruthy();
});

test("a new patient shows 'Allergies not recorded'; Record now records 'No known allergies'; the strip stays on screen while the sheet is open", async ({ page }) => {
  const { patientId } = await openConsult(page, "AllergyNone", null);
  const strip = page.locator("[data-allergy-strip]");
  await expect(strip).toContainText("Allergies not recorded");
  await expect(page.locator("#prescription [data-rx-allergy-unrecorded]")).toContainText("Allergies not recorded");
  await strip.getByRole("button", { name: "Record now" }).click();
  const sheet = page.getByRole("dialog", { name: "Allergies" });
  await expect(sheet).toBeVisible();
  await expect(strip).toBeVisible();
  await sheet.getByRole("button", { name: "No known allergies" }).click();
  await sheet.getByRole("button", { name: "Save allergies" }).click();
  await expect(sheet).toBeHidden({ timeout: 10_000 });
  await expect(strip).toContainText("No known allergies");
  await expect(page.locator("#prescription [data-rx-allergy-unrecorded]")).toHaveCount(0);
  expect(await storedAllergies(patientId)).toEqual([]);
});

test("the editor's substance typeahead codes an allergy; free text is kept and labelled 'checked by name only'", async ({ page }) => {
  const { patientId } = await openConsult(page, "AllergyEditor", null);
  const strip = page.locator("[data-allergy-strip]");
  await strip.getByRole("button", { name: "Record now" }).click();
  const sheet = page.getByRole("dialog", { name: "Allergies" });
  const search = sheet.locator("[data-allergy-search]");
  await search.fill("qzxamox");
  await expect(sheet.getByRole("option", { name: AL_SUBSTANCES.amox.name })).toBeVisible({ timeout: 10_000 });
  await search.press("Enter");
  await search.fill("Latex gloves");
  await expect(sheet.getByRole("option", { name: /^Add .Latex gloves.$/ })).toBeVisible({ timeout: 10_000 });
  await search.press("Enter");
  const entries = sheet.getByRole("list", { name: "Allergies to save" }).getByRole("listitem");
  await expect(entries).toHaveCount(2);
  await expect(entries.nth(0)).toContainText("Checked against medicines");
  await expect(entries.nth(1)).toContainText("Not a listed substance: checked by name only");
  await sheet.getByRole("button", { name: "Save allergies" }).click();
  await expect(sheet).toBeHidden({ timeout: 10_000 });
  await expect(strip).toContainText(`${AL_SUBSTANCES.amox.name}, Latex gloves`);
  expect(await storedAllergies(patientId)).toEqual([AL_SUBSTANCES.amox.name, "Latex gloves"]);
  // Edit reopens the sheet with the list; the coded entry is still labelled coded.
  await strip.getByRole("button", { name: /Edit/ }).click();
  await expect(sheet.getByRole("list", { name: "Allergies to save" }).getByRole("listitem").first()).toContainText("Checked against medicines");
});

// 09C-06a (A-3): per-line recovery. A template line the screen's own rule cannot flag (a catalogue brand saved without its generic) and the database refuses
// with ALLERGY_MATCH no longer blocks the template: the safe line is added and the matched one waits in the dose builder, flagged "Prescribe anyway…".
test("09C-06a A-3: a template with an allergen line adds the safe line and leaves the matched one in the dose builder, flagged", async ({ page }) => {
  const { visitId } = await openConsult(page, "AllergyTemplate", [AL_SUBSTANCES.amox.name]);
  const { tenantA } = run();
  const safe = `E2E Template Safe ${testTag()}`;
  const name = `E2E Allergy Template ${testTag()}`;
  await admin
    .from("doctor_prescription_templates")
    .insert({
      tenant_id: tenantA.id,
      doctor_id: doctor!.id,
      template_name: name,
      items: [
        { medicine_name: AL_BRANDS.amoxBrand.brand, generic_name: null, dose_form: null, dosage: "1-0-1", timing: null, duration: "5 days", cdci_brand_id: AL_BRANDS.amoxBrand.id, sort_order: 0 },
        { medicine_name: safe, generic_name: null, dose_form: null, dosage: "0-0-1", timing: null, duration: "3 days", cdci_brand_id: null, sort_order: 1 },
      ],
    })
    .throwOnError();
  // The doctor's templates come with the consult (09E-05, R-8) and the Templates sheet reads nothing when it opens: a template written after the page
  // was served is on the next load.
  await page.reload();
  await expect(page.getByLabel("History of Present Illness & Clinical Notes")).toBeVisible();
  await awaitHydrated(page);
  const rx = page.locator("#prescription");
  await rx.getByRole("button", { name: "Templates" }).click();
  const sheet = page.getByRole("dialog", { name: "Templates" });
  await sheet.getByRole("button", { name: `Add ${name} to the prescription` }).click();
  await expect(sheet).toBeHidden({ timeout: 15_000 });
  await expect(rxList(page)).toHaveCount(1, { timeout: 15_000 });
  await expect(rxList(page).first()).toContainText(safe);
  const builder = rx.locator("[data-dose-builder]");
  await expect(builder).toBeVisible();
  await expect(builder).toContainText(AL_BRANDS.amoxBrand.brand);
  await expect(rx.locator("[data-dose-notice]")).toHaveText("Matches allergy: a recorded allergy (see the allergy strip)");
  await expect(builder.getByRole("button", { name: "Prescribe anyway…" })).toBeVisible();
  expect((await rxStored(page, visitId)).map((i) => i.medicine_name)).toEqual([safe]);
});

test("09C-06a A-3: Undo of a line prescribed despite an allergy puts it back with its reason (the override is kept)", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "the toast and the pointer are the desktop project's");
  const { visitId } = await openConsult(page, "AllergyUndo", [AL_SUBSTANCES.amox.name]);
  const rx = page.locator("#prescription");
  await rxField(rx).fill("qzxmoxy");
  await expect(rx.getByRole("option", { name: new RegExp(AL_BRANDS.amoxBrand.brand) })).toBeVisible({ timeout: 10_000 });
  for (const key of ["Enter", "1", "5", "d", "Enter"]) await rxField(rx).press(key);
  await rx.getByLabel("Reason to prescribe anyway").fill("Tolerated before, patient informed");
  await rx.getByLabel("Reason to prescribe anyway").press("Enter");
  await expect(rxList(page)).toHaveCount(1, { timeout: 10_000 });
  await expect(rx.locator("[data-rx-note]")).toContainText("Prescribed despite allergy");
  await page.getByRole("button", { name: `Remove ${AL_BRANDS.amoxBrand.brand}` }).click();
  await expect(rxList(page)).toHaveCount(0);
  await page.getByRole("status").getByRole("button", { name: "Undo" }).click();
  await expect(rxList(page)).toHaveCount(1, { timeout: 10_000 });
  // 09E-08 (R-11): the line is back on screen at once (reversible class), before the command has answered: the database is read once it has.
  const stored = async () =>
    (await admin.from("prescription_items").select("medicine_name, allergy_override, prescriptions!inner(visit_id)").eq("prescriptions.visit_id", visitId)).data ?? [];
  await expect.poll(async () => (await stored()).length, { timeout: 10_000 }).toBe(1);
  const data = await stored();
  expect(data[0]!.allergy_override).toMatchObject({ reason: "Tolerated before, patient informed", allergens: [AL_SUBSTANCES.amox.name] });
});

// 09C-06a (A-8): the editor sends the list it opened on; a list recorded meanwhile (another tab, the nurse) is never overwritten by a stale screen.
test("09C-06a A-8: a save from a stale editor is refused, the editor shows the stored list and says so, and nothing of the stale list is written", async ({ page }) => {
  const { patientId } = await openConsult(page, "AllergyStale", [AL_SUBSTANCES.amox.name]);
  const strip = page.locator("[data-allergy-strip]");
  await strip.getByRole("button", { name: /Edit/ }).click();
  const sheet = page.getByRole("dialog", { name: "Allergies" });
  const entries = sheet.getByRole("list", { name: "Allergies to save" }).getByRole("listitem");
  await expect(entries).toHaveCount(1);
  // Someone else records an allergy while the editor is open.
  await admin.from("patients").update({ allergies: [AL_SUBSTANCES.amox.name, "Synthetic Sulfa"] }).eq("id", patientId).throwOnError();
  const search = sheet.locator("[data-allergy-search]");
  await search.fill("Latex gloves");
  await expect(sheet.getByRole("option", { name: /^Add .Latex gloves.$/ })).toBeVisible({ timeout: 10_000 });
  await search.press("Enter");
  await sheet.getByRole("button", { name: "Save allergies" }).click();
  await expect(sheet.getByRole("alert")).toContainText("The allergies were changed by someone else while you were editing.");
  await expect(entries).toHaveCount(2);
  await expect(entries.nth(1)).toContainText("Synthetic Sulfa");
  expect(await storedAllergies(patientId)).toEqual([AL_SUBSTANCES.amox.name, "Synthetic Sulfa"]);
  await expect(strip).toContainText("Synthetic Sulfa");
  // The doctor adds their change again on the stored list; that save goes through.
  await search.fill("Latex gloves");
  await expect(sheet.getByRole("option", { name: /^Add .Latex gloves.$/ })).toBeVisible({ timeout: 10_000 });
  await search.press("Enter");
  await sheet.getByRole("button", { name: "Save allergies" }).click();
  await expect(sheet).toBeHidden({ timeout: 10_000 });
  expect(await storedAllergies(patientId)).toEqual([AL_SUBSTANCES.amox.name, "Synthetic Sulfa", "Latex gloves"]);
});
