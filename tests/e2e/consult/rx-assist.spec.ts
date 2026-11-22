/**
 * V2-09c 09C-03 (R-9, R-10; AI-08, SA-02; roadmap acceptance 4): the Rx Smart Assist of the consult, from the doctor's OWN signed history. Each test makes its own
 * doctor (own-doctor.ts) with their own signed visits and reads only what it wrote, because desktop-chrome, pixel-7 and iphone-15 share one database.
 *   - "Your usual for Viral fever" adds the doctor's three usual medicines in 1 tap and 0 typed characters, with the stored doses (a stored null timing stays null)
 *     and the "Repeated" marker until the doctor touches a line;
 *   - three favourite tiles add three lines in 3 taps; a favourite whose stored dose is incomplete opens the dose builder and stores nothing;
 *   - "Same as last visit" copies the diagnosis and the lines in 1 tap; a line that matches a recorded allergy is NOT copied: the dose builder opens flagged;
 *   - with `assist.frequent_rx` overridden off the favourites and the bundle are absent and "Same as last visit" stays;
 *   - another doctor's identical diagnosis never reaches the tiles.
 * Every check runs with AI fully disabled (the platform kill switch is all off for the file; the e2e server has no provider environment). Synthetic data only.
 */
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { awaitHydrated } from "../support/hydrated";
import { run, seedPatient, seedVisit, signSeededVisit, testTag } from "../support/m0-data";
import { storageStatePath, type RunUser } from "../support/run-data";
import { retireOwnDoctor, seedOwnDoctor, signInAsOwnDoctor } from "../support/own-doctor";
import { rxItemsOf } from "../support/cdci-fixtures";
import { getAdminClient } from "../../helpers/supabase-admin";

test.use({ storageState: storageStatePath("doctor") });
test.describe.configure({ mode: "serial" });

const admin = getAdminClient();
let originalAiFeatures: unknown = null;
let doctor: RunUser | null = null;

test.beforeAll(async () => {
  const current = await admin.from("platform_settings").select("ai_features").eq("id", true).single();
  if (current.error) throw new Error(current.error.message);
  originalAiFeatures = current.data.ai_features;
  const off = Object.fromEntries(Object.keys(originalAiFeatures as Record<string, unknown>).map((k) => [k, false]));
  const killed = await admin.from("platform_settings").update({ ai_features: off }).eq("id", true);
  if (killed.error) throw new Error(killed.error.message);
});
test.afterAll(async () => {
  if (originalAiFeatures !== null) await admin.from("platform_settings").update({ ai_features: originalAiFeatures as never }).eq("id", true);
});
test.afterEach(async () => {
  if (doctor) await retireOwnDoctor(doctor);
  doctor = null;
});

interface Line {
  name: string;
  dosage?: string;
  timing?: string | null;
  duration?: string;
}

/** One signed visit of `owner` for `patientId` with a diagnosis and lines (the stored doses exactly), signed through the doctor's own session. */
async function seedSigned(owner: RunUser & { name?: string }, patientId: string, diagnosis: string, lines: Line[]): Promise<string> {
  const { tenantA } = run();
  const visitId = await seedVisit({ tenantId: tenantA.id, patientId, doctorId: owner.id, createdBy: tenantA.users.receptionist.id, status: "waiting" });
  const notes = await admin.from("clinical_notes").update({ clinical_notes: "E2E synthetic history note" }).eq("visit_id", visitId).select("visit_id");
  if (notes.error || notes.data?.length !== 1) throw new Error(`notes: ${notes.error?.message ?? "no row"}`);
  await admin.from("consultation_diagnoses").insert({ tenant_id: tenantA.id, visit_id: visitId, patient_id: patientId, diagnosis_name: diagnosis, icd11_code: "MG26" }).throwOnError();
  const header = await admin.from("prescriptions").insert({ tenant_id: tenantA.id, visit_id: visitId, patient_id: patientId, doctor_id: owner.id, version: 1, status: "active" }).select("id").single();
  if (header.error || !header.data) throw new Error(`header: ${header.error?.message}`);
  await admin
    .from("prescription_items")
    .insert(
      lines.map((l, index) => ({
        tenant_id: tenantA.id,
        prescription_id: header.data.id,
        medicine_name: l.name,
        dosage: l.dosage ?? "1-0-1",
        timing: l.timing === undefined ? "After food" : l.timing,
        duration: l.duration ?? "5 days",
        sort_order: index,
      })),
    )
    .throwOnError();
  await signSeededVisit(tenantA.id, visitId, (owner as RunUser).email);
  return visitId;
}

/** A new doctor of the test, signed in, with a consult open for a new patient (optionally with a diagnosis already on it and recorded allergies). */
async function openConsult(
  page: Page,
  label: string,
  opts: { diagnosis?: string; allergies?: string[]; patientId?: string; history?: (d: RunUser, patientId: string, tag: string) => Promise<void> } = {},
): Promise<{ visitId: string; patientId: string; tag: string; owner: RunUser }> {
  const { tenantA } = run();
  const own = await seedOwnDoctor(label);
  doctor = own;
  const tag = testTag();
  const patient = opts.patientId ? { id: opts.patientId } : await seedPatient(tenantA.id, tenantA.users.owner.id, `E2E Synthetic ${label} ${tag}`);
  await admin.from("patients").update({ allergies: opts.allergies ?? [] }).eq("id", patient.id).throwOnError();
  if (opts.history) await opts.history(own, patient.id, tag);
  const visitId = await seedVisit({ tenantId: tenantA.id, patientId: patient.id, doctorId: own.id, createdBy: tenantA.users.receptionist.id, status: "in_consultation" });
  if (opts.diagnosis) {
    await admin.from("consultation_diagnoses").insert({ tenant_id: tenantA.id, visit_id: visitId, patient_id: patient.id, diagnosis_name: opts.diagnosis, icd11_code: "MG26" }).throwOnError();
  }
  await signInAsOwnDoctor(page, own);
  await page.goto(`/consultation/${visitId}`);
  await expect(page.getByLabel("History of Present Illness & Clinical Notes")).toBeVisible();
  await awaitHydrated(page);
  return { visitId, patientId: patient.id, tag, owner: own };
}

/** The doctor's own history: `n` signed visits of other patients with the same diagnosis and the three medicines. */
async function bundleHistory(d: RunUser, tag: string, diagnosis: string, n = 3) {
  const { tenantA } = run();
  for (let i = 0; i < n; i++) {
    const p = await seedPatient(tenantA.id, tenantA.users.owner.id, `E2E Synthetic History ${i} ${tag}`);
    await seedSigned(d, p.id, diagnosis, [
      { name: `Alpha Syrup ${tag}`, dosage: "1-0-1", timing: "After food", duration: "5 days" },
      { name: `Beta Tablet ${tag}`, dosage: "0-0-1", timing: null, duration: "3 days" },
      { name: `Gamma Drops ${tag}`, dosage: "1-1-1", timing: "With food", duration: "7 days" },
    ]);
  }
}

const rxList = (page: Page) => page.getByRole("list", { name: "Prescribed medicines" }).getByRole("listitem");

test("@golden 'Your usual for Viral fever' adds the three usual medicines in 1 tap and 0 typed, with the stored doses and the Repeated marker", async ({ page, ux }) => {
  ux.flow("consult-rx-usual", "Your usual for Viral fever: three medicines with the doctor's own stored doses");
  const tag = testTag();
  const { visitId } = await openConsult(page, "RxUsual", {
    diagnosis: "Viral fever",
    history: (d) => bundleHistory(d, tag, "Viral fever"),
  });
  const rx = page.locator("#prescription");
  const tile = rx.getByRole("button", { name: /^Your usual for Viral fever/ });
  await expect(tile).toBeVisible();
  await expect(rx.locator("[data-rx-bundles]")).toContainText("Smart Assist");
  await ux.click(tile, "Tile: Your usual for Viral fever");
  await expect(rxList(page)).toHaveCount(3, { timeout: 15_000 });
  ux.done();
  const counts = ux.counts();
  expect(counts?.clicks).toBe(1);
  expect(counts?.fills).toBe(0);
  expect(counts?.keystrokes).toBe(0);

  // The database holds the doctor's stored doses: a stored null timing stays null, nothing is invented.
  const items = await rxItemsOf(visitId);
  expect(items.map((i) => [i.medicine_name, i.dosage, i.timing, i.duration])).toEqual([
    [`Alpha Syrup ${tag}`, "1-0-1", "After food", "5 days"],
    [`Beta Tablet ${tag}`, "0-0-1", null, "3 days"],
    [`Gamma Drops ${tag}`, "1-1-1", "With food", "7 days"],
  ]);
  // The lines carry "Repeated" until the doctor touches them; the tile is gone (nothing is missing).
  await expect(rxList(page).filter({ hasText: "Repeated" })).toHaveCount(3);
  await expect(rx.getByRole("button", { name: /^Your usual for Viral fever/ })).toHaveCount(0);
  await rxList(page).first().getByRole("button", { name: /Edit dose of/ }).first().click();
  await expect(rxList(page).first().getByText("Repeated")).toHaveCount(0);
  await expect(rxList(page).filter({ hasText: "Repeated" })).toHaveCount(2);
});

test("three favourite tiles add three lines in 3 taps with the stored doses; another doctor's identical diagnosis never reaches the tiles", async ({ page, ux }) => {
  ux.flow("consult-rx-favourites", "Three favourite medicines in three taps");
  const tag = testTag();
  const { tenantA } = run();
  // Another doctor of the clinic with the same diagnosis and medicines of their own: never offered to this doctor.
  const other = await seedOwnDoctor("RxOther");
  try {
    for (let i = 0; i < 2; i++) {
      const p = await seedPatient(tenantA.id, tenantA.users.owner.id, `E2E Synthetic Other History ${i} ${tag}`);
      await seedSigned(other, p.id, "Viral fever", [{ name: `Other Doctor Syrup ${tag}`, dosage: "1-1-1", timing: "With food", duration: "4 days" }]);
    }
    await openConsult(page, "RxFavs", { history: (d) => bundleHistory(d, tag, "Viral fever") });
    const rx = page.locator("#prescription");
    const favourites = rx.locator("[data-rx-favourites]");
    await expect(favourites).toBeVisible();
    await expect(favourites).toContainText("Smart Assist");
    await expect(favourites.getByRole("button", { name: new RegExp(`Alpha Syrup ${tag}`) })).toBeVisible();
    await expect(rx.getByText(`Other Doctor Syrup ${tag}`)).toHaveCount(0);
    for (const name of ["Alpha Syrup", "Beta Tablet", "Gamma Drops"]) {
      await ux.click(favourites.getByRole("button", { name: new RegExp(`${name} ${tag}`) }), `Favourite tile: ${name}`);
    }
    await expect(rxList(page)).toHaveCount(3, { timeout: 15_000 });
    ux.done();
    const counts = ux.counts();
    expect(counts?.clicks).toBe(3);
    expect(counts?.keystrokes).toBe(0);
  } finally {
    await retireOwnDoctor(other);
  }
});

test("a favourite with no complete stored dose opens the dose builder instead and stores nothing", async ({ page }) => {
  const tag = testTag();
  const { tenantA } = run();
  const { visitId } = await openConsult(page, "RxIncomplete", {
    history: async (d) => {
      const p = await seedPatient(tenantA.id, tenantA.users.owner.id, `E2E Synthetic Incomplete ${tag}`);
      await seedSigned(d, p.id, "Cold", [{ name: `Blank Dose Tablet ${tag}`, dosage: "", timing: null, duration: "3 days" }]);
    },
  });
  const rx = page.locator("#prescription");
  const tile = rx.locator("[data-rx-favourites]").getByRole("button", { name: new RegExp(`Blank Dose Tablet ${tag}`) });
  await expect(tile).toBeVisible();
  await tile.click();
  await expect(rx.locator("[data-dose-builder]")).toBeVisible();
  await expect(rx.locator("[data-dose-builder]")).toContainText(`Blank Dose Tablet ${tag}`);
  // Nothing is filled in (the stored dose has no frequency, so there is no usual): Enter adds nothing and says what to choose.
  await expect(rx.locator("[data-dose-summary]")).toHaveText("");
  await rx.locator("[data-rx-search]").press("Enter");
  await expect(rx.getByRole("alert").filter({ hasText: "Choose a frequency (1 to 5) and a duration such as 5d" })).toBeVisible();
  await page.waitForTimeout(300);
  expect(await rxItemsOf(visitId)).toEqual([]);
  await expect(rxList(page)).toHaveCount(0);
});

test("@golden 'Same as last visit' copies the diagnosis and the lines in 1 tap (stored doses, a null timing stays null)", async ({ page, ux }) => {
  ux.flow("consult-rx-last-visit", "Same as last visit: the diagnosis and the prescription in one tap");
  const { tenantA } = run();
  const tag = testTag();
  const patient = await seedPatient(tenantA.id, tenantA.users.owner.id, `E2E Synthetic LastVisit ${tag}`);
  const { visitId } = await openConsult(page, "RxLast", {
    patientId: patient.id,
    history: async (d, patientId) => {
      await seedSigned(d, patientId, "Seasonal allergy", [
        { name: `Last Visit Syrup ${tag}`, dosage: "1-0-0", timing: null, duration: "7 days" },
        { name: `Last Visit Tablet ${tag}`, dosage: "0-0-1", timing: "After food", duration: "5 days" },
      ]);
    },
  });
  const rx = page.locator("#prescription");
  const tile = rx.getByRole("button", { name: /^Same as last visit/ });
  await expect(tile).toBeVisible();
  await ux.click(tile, "Same as last visit");
  await expect(rxList(page)).toHaveCount(2, { timeout: 15_000 });
  ux.done();
  const counts = ux.counts();
  expect(counts?.clicks).toBe(1);
  expect(counts?.keystrokes).toBe(0);

  expect((await rxItemsOf(visitId)).map((i) => [i.medicine_name, i.dosage, i.timing, i.duration])).toEqual([
    [`Last Visit Syrup ${tag}`, "1-0-0", null, "7 days"],
    [`Last Visit Tablet ${tag}`, "0-0-1", "After food", "5 days"],
  ]);
  const dx = await admin.from("consultation_diagnoses").select("diagnosis_name, icd11_code").eq("visit_id", visitId);
  expect(dx.data).toEqual([{ diagnosis_name: "Seasonal allergy", icd11_code: "MG26" }]);
  // The diagnosis is on screen without a reload, and the tile is gone (nothing is left to copy).
  await expect(page.locator("#diagnosis")).toContainText("Seasonal allergy");
  await expect(rx.getByRole("button", { name: /^Same as last visit/ })).toHaveCount(0);
  await expect(rxList(page).filter({ hasText: "Repeated" })).toHaveCount(2);
});

test("the history list's 'Repeat this Rx' copies the lines only, as one command (the diagnosis is not copied)", async ({ page, viewport }) => {
  test.skip(!viewport || viewport.width < 1280, "The history list is in the patient column at 1280 and above; below it is in the Patient sheet (covered by the layout specs)");
  const { tenantA } = run();
  const tag = testTag();
  const patient = await seedPatient(tenantA.id, tenantA.users.owner.id, `E2E Synthetic HistoryRepeat ${tag}`);
  const { visitId } = await openConsult(page, "RxHistory", {
    patientId: patient.id,
    history: async (d, patientId) => {
      await seedSigned(d, patientId, "Gastritis", [{ name: `History Syrup ${tag}`, dosage: "1-0-0", timing: null, duration: "7 days" }]);
    },
  });
  await page.getByRole("button", { name: "Repeat this Rx" }).click();
  await expect(rxList(page)).toHaveCount(1, { timeout: 15_000 });
  expect((await rxItemsOf(visitId)).map((i) => [i.medicine_name, i.dosage, i.timing, i.duration])).toEqual([[`History Syrup ${tag}`, "1-0-0", null, "7 days"]]);
  const dx = await admin.from("consultation_diagnoses").select("diagnosis_name").eq("visit_id", visitId);
  expect(dx.data).toEqual([]);
});

test("'Same as last visit' never copies an allergy-matching medicine silently: it is left out and the dose builder opens flagged", async ({ page }) => {
  const { tenantA } = run();
  const tag = testTag();
  const patient = await seedPatient(tenantA.id, tenantA.users.owner.id, `E2E Synthetic LastAllergy ${tag}`);
  const allergen = `Qzxassistcillin${tag.replace(/[^a-z0-9]/gi, "").slice(0, 8)}`;
  const { visitId } = await openConsult(page, "RxLastAllergy", {
    patientId: patient.id,
    allergies: [allergen],
    history: async (d, patientId) => {
      await seedSigned(d, patientId, "Throat infection", [
        { name: `${allergen} 500`, dosage: "1-0-1", timing: "After food", duration: "5 days" },
        { name: `Safe Lozenge ${tag}`, dosage: "1-0-0", timing: null, duration: "3 days" },
      ]);
    },
  });
  const rx = page.locator("#prescription");
  await rx.getByRole("button", { name: /^Same as last visit/ }).click();
  // The safe line is copied; the matching one is not, and its dose builder is open with the match named.
  await expect(rxList(page)).toHaveCount(1, { timeout: 15_000 });
  await expect(rx.locator("[data-dose-builder]")).toBeVisible();
  await expect(rx.locator("[data-dose-builder]")).toContainText(`${allergen} 500`);
  await expect(rx.locator("[data-dose-notice]")).toContainText("Matches allergy");
  expect((await rxItemsOf(visitId)).map((i) => i.medicine_name)).toEqual([`Safe Lozenge ${tag}`]);
  // Adding it needs a reason (the dose the doctor stored is in the builder).
  await rx.locator("[data-rx-search]").press("Enter");
  await expect(rx.getByLabel("Reason to prescribe anyway")).toBeVisible();
  await rx.getByLabel("Reason to prescribe anyway").fill("Tolerated before, reviewed");
  await rx.getByRole("button", { name: "Prescribe anyway", exact: true }).click();
  await expect(rxList(page)).toHaveCount(2, { timeout: 15_000 });
  const stored = await rxItemsOf(visitId);
  expect(stored.map((i) => [i.medicine_name, i.dosage, i.timing, i.duration])).toContainEqual([`${allergen} 500`, "1-0-1", "After food", "5 days"]);
});

test("a bundle medicine that matches a recorded allergy is left out of the one tap and opened in the dose builder flagged", async ({ page }) => {
  const tag = testTag();
  const allergen = `Qzxbundlemycin${tag.replace(/[^a-z0-9]/gi, "").slice(0, 8)}`;
  const { visitId } = await openConsult(page, "RxBundleAllergy", {
    diagnosis: "Viral fever",
    allergies: [allergen],
    history: async (d) => {
      const { tenantA } = run();
      for (let i = 0; i < 2; i++) {
        const p = await seedPatient(tenantA.id, tenantA.users.owner.id, `E2E Synthetic BundleAllergy ${i} ${tag}`);
        await seedSigned(d, p.id, "Viral fever", [{ name: `Bundle Safe ${tag}` }, { name: `${allergen} 250`, dosage: "1-0-1", timing: "After food", duration: "5 days" }]);
      }
    },
  });
  const rx = page.locator("#prescription");
  await rx.getByRole("button", { name: /^Your usual for Viral fever/ }).click();
  await expect(rxList(page)).toHaveCount(1, { timeout: 15_000 });
  await expect(rx.locator("[data-dose-builder]")).toContainText(`${allergen} 250`);
  await expect(rx.locator("[data-dose-notice]")).toContainText(`Matches allergy: ${allergen}`);
  expect((await rxItemsOf(visitId)).map((i) => i.medicine_name)).toEqual([`Bundle Safe ${tag}`]);
});

test("with assist.frequent_rx overridden off the favourites and the bundle are absent and 'Same as last visit' stays", async ({ page }) => {
  const { tenantA } = run();
  const tag = testTag();
  const patient = await seedPatient(tenantA.id, tenantA.users.owner.id, `E2E Synthetic RxOff ${tag}`);
  const off = await admin.from("tenant_entitlement_overrides").insert({ tenant_id: tenantA.id, key: "assist.frequent_rx", enabled: false, reason: "Synthetic test: favourites off" });
  expect(off.error).toBeNull();
  try {
    await openConsult(page, "RxOff", {
      diagnosis: "Viral fever",
      patientId: patient.id,
      history: async (d, patientId) => {
        await bundleHistory(d, tag, "Viral fever");
        await seedSigned(d, patientId, "Cold", [{ name: `Off Switch Tablet ${tag}` }]);
      },
    });
    const rx = page.locator("#prescription");
    await expect(rx.getByRole("button", { name: /^Same as last visit/ })).toBeVisible();
    await expect(rx.locator("[data-rx-favourites]")).toHaveCount(0);
    await expect(rx.locator("[data-rx-bundles]")).toHaveCount(0);
    await expect(rx.getByText("Smart Assist")).toHaveCount(0);
  } finally {
    await admin.from("tenant_entitlement_overrides").delete().eq("tenant_id", tenantA.id).eq("key", "assist.frequent_rx");
  }
});

// V2-09c 09C-05 (M4 criterion 3): the tiles on screen, axe clean at 360, 820, 1180 and 1280. This case lives here, not in a11y/consult-screens, because it needs
// a doctor of its own with visits today: a second doctor with visits makes Today's doctor picker appear and its header wrap, which the front-desk board spec
// (a11y/front-desk-screens, 820 x 1180, which runs earlier) does not allow for.
test("the favourites, your usual and Same as last visit tiles are axe clean at 360, 820, 1180 and 1280 px, and fit with no horizontal scroll", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "a11y specs own their viewport (desktop-chrome)");
  test.setTimeout(120_000);
  const { tenantA } = run();
  const tag = testTag();
  const patient = await seedPatient(tenantA.id, tenantA.users.owner.id, `E2E Synthetic RxAxe ${tag}`);
  await openConsult(page, "RxAxe", {
    diagnosis: "Viral fever",
    patientId: patient.id,
    history: async (d, patientId) => {
      await bundleHistory(d, tag, "Viral fever");
      await seedSigned(d, patientId, "Viral fever", [{ name: `Axe Last Visit Tablet ${tag}`, dosage: "1-0-1", timing: "After food", duration: "5 days" }]);
    },
  });
  const rx = page.locator("#prescription");
  await expect(rx.locator("[data-rx-assist]")).toBeVisible();
  await expect(rx.locator("[data-rx-bundles]")).toBeVisible();
  await expect(rx.locator("[data-rx-favourites]")).toBeVisible();
  await expect(rx.getByRole("button", { name: /^Same as last visit/ })).toBeVisible();
  for (const size of [
    { width: 360, height: 780 },
    { width: 820, height: 1180 },
    { width: 1180, height: 820 },
    { width: 1280, height: 800 },
  ]) {
    await page.setViewportSize(size);
    await rx.scrollIntoViewIfNeeded();
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`), `axe at ${size.width}px`).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `no horizontal scroll at ${size.width}px`).toBe(true);
  }
});
