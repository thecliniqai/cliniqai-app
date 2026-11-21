/**
 * TEST_STRATEGY journey 3 — the receptionist registers a patient (V2-08 08-02, R-12, R-19, P1-30, P1-42).
 *
 * As a receptionist: open the register sheet from the Patients list, enter mobile number, name, age and sex, tick the
 * patient's AI objection and register; the patient's profile opens and the row, the objection and its stamp are in the
 * database (one patient, `ai_processing_objected`, `objected_at`, the receptionist as the recorder). A second entry with the
 * same mobile number and name shows the Smart Assist duplicate warning (AI-14: probably the same person; age and sex of the
 * candidate, so a family number stays readable), the same mobile with another name shows the information list, and "Use this
 * patient" opens the existing record: still one row. The sheet is axe-clean (0 serious or critical) at the
 * project's width (phone, tablet, desktop projects run the same journey); the interaction counts are written by the `ux`
 * counter (`test-results/m0/counts/journey-03-register-patient.json`, desktop-chrome) for the evidence.
 */
import AxeBuilder from "@axe-core/playwright";
import { getAdminClient } from "../../helpers/supabase-admin";
import { expect, test } from "../fixtures";
import { patientsByName, run, syntheticPhoneDigits, testTag } from "../support/m0-data";
import { storageStatePath } from "../support/run-data";
import { settleAnimations } from "../support/settle";

test.use({ storageState: storageStatePath("receptionist") });

const TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];

test("@golden journey 3: register with the AI objection; the same mobile and name again shows the duplicate banner and 'Use this patient'", async ({ page, ux }) => {
  ux.flow("journey-03-register-patient", "Receptionist registers a patient (mobile, name, age, sex, AI objection)");
  const { tenantA } = run();
  const fullName = `E2E Synthetic Journey3 ${testTag()}`;
  const phoneDigits = syntheticPhoneDigits();

  await page.goto("/patients");
  await ux.click(page.getByRole("link", { name: /Register Patient/ }).first(), "Register Patient");
  const sheet = page.getByRole("dialog", { name: "Register patient" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("textbox", { name: "Mobile number" })).toBeFocused();

  // The sheet holds the interim AI notice with its checkbox, and passes axe at this width.
  await expect(sheet.getByText(/Interim wording/)).toBeVisible();
  await settleAnimations(page);
  const axe = await new AxeBuilder({ page }).include("[data-register-patient-sheet]").withTags(TAGS).analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);

  await ux.fill(sheet.getByRole("textbox", { name: "Mobile number" }), phoneDigits, "Mobile number");
  await ux.fill(sheet.getByRole("textbox", { name: "Full name" }), fullName, "Full name");
  await ux.fill(sheet.getByRole("textbox", { name: "Age" }), "34", "Age");
  await ux.click(sheet.getByRole("radio", { name: "Female" }), "Sex: Female");
  await ux.check(sheet.getByRole("checkbox", { name: "Patient objects to AI-assisted features" }), "AI objection");
  await ux.click(sheet.getByRole("button", { name: "Register patient" }), "Register patient");

  // The new patient's profile opens.
  await expect(page).toHaveURL(/\/patients\/[0-9a-f-]{36}$/, { timeout: 20_000 });
  await expect(page.getByRole("heading", { level: 1, name: fullName })).toBeVisible();
  ux.done();

  const rows = await patientsByName(tenantA.id, fullName);
  expect(rows).toHaveLength(1);
  expect(rows[0].phone).toBe(`+91${phoneDigits}`);
  const patientId = rows[0].id;
  const { data: stored } = await getAdminClient()
    .from("patients")
    .select("ai_processing_objected, objected_at, objection_recorded_by, created_by")
    .eq("id", patientId)
    .single();
  expect(stored).toMatchObject({
    ai_processing_objected: true,
    objection_recorded_by: tenantA.users.receptionist.id,
    created_by: tenantA.users.receptionist.id,
  });
  expect(stored?.objected_at).toBeTruthy();

  // Second entry: the same mobile number shows the candidate with age and sex; "Use this patient" opens the record.
  await page.goto("/patients?new=1");
  const again = page.getByRole("dialog", { name: "Register patient" });
  await expect(again).toBeVisible();
  await again.getByRole("textbox", { name: "Mobile number" }).fill(phoneDigits);
  await again.getByRole("textbox", { name: "Full name" }).fill(fullName);
  // The same mobile and name is probably the same person: Smart Assist (the clinic is entitled) says so as a warning with the
  // candidate's age and sex, never the whole number.
  const banner = again.getByRole("alert").filter({ hasText: "probably already registered" });
  await expect(banner).toBeVisible({ timeout: 20_000 });
  await expect(banner).toContainText("Smart Assist");
  await expect(banner).toContainText(`Same mobile · ${fullName} · 34 y · F`);
  await expect(banner).toContainText(`•${phoneDigits.slice(-4)}`);
  await expect(banner).not.toContainText(phoneDigits);

  // The same mobile with another name is a family number: an information list (possible), not the warning.
  await again.getByRole("textbox", { name: "Full name" }).fill(`E2E Synthetic Family ${testTag()}`);
  const family = again.getByRole("status").filter({ hasText: "may already be registered" });
  await expect(family).toBeVisible({ timeout: 20_000 });
  await expect(family).toContainText(`Same mobile · ${fullName} · 34 y · F`);
  await expect(banner).toHaveCount(0);
  await again.getByRole("textbox", { name: "Full name" }).fill(fullName);
  await expect(banner).toBeVisible({ timeout: 20_000 });
  await banner.getByRole("button", { name: /Use this patient/ }).click();
  await expect(page).toHaveURL(new RegExp(`/patients/${patientId}$`), { timeout: 20_000 });
  expect(await patientsByName(tenantA.id, fullName)).toHaveLength(1);
});
