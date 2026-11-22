/**
 * V2-09b 09B-05 (M4 criterion 3, R-7): the consult with the keyboard only, up to the diagnosis. No pointer action after the page has loaded:
 *   - Alt+1 to Alt+5 move focus to the section headings;
 *   - the shorthand bar opens with `/` (the per-device single-key switch is on), takes "c/o fever 3d, cough 2d", Enter inserts it;
 *   - Tab reaches the examination template group and Space chooses a template; Tab reaches the diagnosis search, the typed name is added with Enter;
 *   - V2-09c 09C-05 (Q-1, M4.4): Alt+4 and M reach the medicine field, a medicine is added with the keyboard (the Add row, the key 1, 5d, Enter) and is
 *     stored: the Rx line by keyboard, in the same pointer-free run;
 *   - Ctrl+S flushes the draft ("Saved").
 * Desktop only: a hardware keyboard on a fine pointer. Synthetic data only.
 */
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { awaitHydrated } from "../support/hydrated";
import { run, seedPatient, seedVisit, testTag } from "../support/m0-data";
import { getAdminClient } from "../../helpers/supabase-admin";
import { storageStatePath, type RunUser } from "../support/run-data";
import { retireOwnDoctor, seedOwnDoctor, signInAsOwnDoctor } from "../support/own-doctor";
import { addCustomMedicine } from "../support/rx-entry";
import { rxItemsOf } from "../support/cdci-fixtures";

test.use({ storageState: storageStatePath("doctor") });

const admin = getAdminClient();

/**
 * The test's own doctor (CI 44924479177, found by the repeat run): the diagnosis search lists the doctor's own custom diagnoses first, matched by name
 * similarity. With the run's doctor, another spec's "Zzz e2e own diagnosis …" (or this test's own earlier attempt) was the highlighted first row, and Enter
 * added it instead of the typed name.
 */
let doctor: RunUser | null = null;
test.afterEach(async () => {
  if (doctor) await retireOwnDoctor(doctor);
  doctor = null;
});

/** Presses Tab until the focused element matches `selector` (at most `max` presses); the keyboard-only way to reach a control. */
async function tabTo(page: Page, selector: string, max = 80): Promise<void> {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    if (await page.evaluate((sel) => document.activeElement?.matches(sel) ?? false, selector)) return;
  }
  throw new Error(`Tab never reached ${selector} in ${max} presses`);
}

test("@golden the consult with the keyboard only: sections, the shorthand bar, a template, a diagnosis, Ctrl+S", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "a hardware keyboard on a fine pointer: the desktop project");
  const { tenantA } = run();
  const own = await seedOwnDoctor("Keyboard");
  doctor = own;
  const patient = await seedPatient(tenantA.id, tenantA.users.owner.id, `E2E Synthetic Keyboard ${testTag()}`);
  const visitId = await seedVisit({
    tenantId: tenantA.id,
    patientId: patient.id,
    doctorId: own.id,
    createdBy: tenantA.users.receptionist.id,
    status: "in_consultation",
  });
  await signInAsOwnDoctor(page, own);
  await page.addInitScript(() => localStorage.setItem("clinicos.pref.shortcuts", "on"));
  await page.goto(`/consultation/${visitId}`);
  await expect(page.getByLabel("History of Present Illness & Clinical Notes")).toBeVisible();
  await awaitHydrated(page);

  // Alt+1 .. Alt+5: focus lands on the section heading each time.
  for (const [n, id] of [[1, "complaints"], [2, "examination"], [3, "diagnosis"], [4, "prescription"], [5, "plan"]] as const) {
    await page.keyboard.press(`Alt+Digit${n}`);
    await expect(page.locator(`#${id}-title`)).toBeFocused();
  }

  // Complaints through the shorthand bar: / opens it, the text, Enter inserts.
  await page.keyboard.press("Alt+Digit1");
  await expect(page.locator("#complaints-title")).toBeFocused();
  await page.keyboard.press("/");
  const bar = page.getByRole("dialog", { name: "Shorthand" });
  await expect(bar).toBeVisible();
  await expect(bar.getByRole("textbox", { name: "Shorthand" })).toBeFocused();
  await page.keyboard.type("c/o fever 3d, cough 2d");
  await expect(bar.locator("[data-shorthand-group='complaints']")).toContainText("Cough");
  await page.keyboard.press("Enter");
  await expect(bar).toHaveCount(0);
  const rows = page.getByRole("list", { name: "Complaints added" }).getByRole("listitem");
  await expect(rows).toHaveCount(2);
  await expect(page.getByRole("radiogroup", { name: "Duration of Fever" }).getByRole("radio", { name: "3d" })).toBeChecked();

  // An examination template: Alt+2, Tab to the template group, Space chooses.
  await page.keyboard.press("Alt+Digit2");
  await expect(page.locator("#examination-title")).toBeFocused();
  await tabTo(page, '[role="radiogroup"][aria-label="Examination template"] [role="radio"]');
  await page.keyboard.press("Space");
  await expect(page.getByRole("radiogroup", { name: "Examination template" }).getByRole("radio", { checked: true })).toHaveCount(1);

  // A diagnosis: Alt+3, Tab to the search, type a name, Enter adds it as the doctor's own.
  await page.keyboard.press("Alt+Digit3");
  await expect(page.locator("#diagnosis-title")).toBeFocused();
  await tabTo(page, 'input[placeholder*="Search diagnosis name"]');
  const name = `Zzz keyboard diagnosis ${testTag().replace(/\W/g, "")}`;
  await page.keyboard.type(name);
  await expect(page.getByRole("option", { name: new RegExp(`Add .${name.slice(0, 18)}`) })).toBeVisible({ timeout: 8_000 });
  await page.keyboard.press("Enter");
  await expect(page.getByRole("list", { name: "Diagnoses" })).toContainText(name);

  // The Rx line by keyboard (V2-09c 09C-05): Alt+4 puts the focus on the section, M on the medicine field; the Add row, the key 1 (1-0-1), 5d, Enter.
  await page.keyboard.press("Alt+Digit4");
  await expect(page.locator("#prescription-title")).toBeFocused();
  await page.keyboard.press("m");
  await expect(page.locator("#prescription [data-rx-search]")).toBeFocused();
  const medicine = `Zzz keyboard medicine ${testTag().replace(/\W/g, "")}`;
  await addCustomMedicine(page.locator("#prescription"), medicine);
  await expect.poll(async () => (await rxItemsOf(visitId)).map((i) => [i.medicine_name, i.dosage, i.duration]), { timeout: 12_000 }).toEqual([[medicine, "1-0-1", "5 days"]]);

  // Ctrl+S flushes the draft.
  await page.keyboard.press("Control+KeyS");
  await expect(page.locator("[data-save-status='saved']")).toBeVisible({ timeout: 12_000 });
  const note = await admin.from("clinical_notes").select("chief_complaints, specialty_data").eq("visit_id", visitId).single();
  expect(note.error).toBeNull();
  expect((note.data!.chief_complaints as Array<{ symptom: string; duration_val: number; duration_unit: string }>).map((c) => [c.symptom, c.duration_val, c.duration_unit])).toEqual([
    ["Fever", 3, "days"],
    ["Cough", 2, "days"],
  ]);
  expect(note.data!.specialty_data).toMatchObject({ exam: { template_id: expect.any(String) } });
  await expect
    .poll(async () => (await admin.from("consultation_diagnoses").select("diagnosis_name, is_custom").eq("visit_id", visitId)).data, { timeout: 12_000 })
    .toEqual([{ diagnosis_name: name, is_custom: true }]);

  // Alt+4 and Alt+5 still work with a filled note.
  await page.keyboard.press("Alt+Digit5");
  await expect(page.locator("#plan-title")).toBeFocused();
});
