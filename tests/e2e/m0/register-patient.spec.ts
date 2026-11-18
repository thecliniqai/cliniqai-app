/**
 * M0 characterisation flow 1 — register a patient (V2-02 plan 02-03b; FRONTEND_MIGRATION_PLAN M0).
 *
 * Outcome asserted: exactly one `patients` row in tenant A with the entered name and the phone normalised to E.164,
 * the new patient's record opens, and the patient is findable in the patient list.
 *
 * Receptionist variant: known v1 bug F-01 (receptionists lacked `patients:edit`, the save failed) is fixed by PO-3
 * (V2-05 05-01b: receptionists hold `patients:edit`, ruling R-6), so the `knownBug` marker is gone (RL-19) and the
 * correct outcome is a plain expectation.
 */
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import type { UxCounter } from "../support/ux-counter";
import { patientsByName, run, syntheticPhoneDigits, testTag } from "../support/m0-data";
import { storageStatePath } from "../support/run-data";

async function registerPatient(page: Page, ux: UxCounter, fullName: string, phoneDigits: string): Promise<void> {
  await page.goto("/patients");
  await ux.click(page.getByRole("link", { name: /Register Patient/ }).first(), "Register Patient");
  await expect(page.getByRole("heading", { name: "Register New Patient" })).toBeVisible();

  await ux.fill(page.getByLabel(/^Patient Full Name/), fullName, "Patient Full Name");
  await ux.fill(page.getByLabel(/^Mobile Phone Number/), phoneDigits, "Mobile Phone Number");
  await ux.fill(page.getByLabel("Age (Years)"), "34", "Age (Years)");
  await ux.select(page.getByLabel("Sex / Gender"), "female", "Sex / Gender");
  await ux.click(page.getByRole("button", { name: "Save Patient Record" }), "Save Patient Record");
}

test.describe("M0 flow: register patient", () => {
  test.describe("owner", () => {
    test.use({ storageState: storageStatePath("owner") });

    test("owner registers a patient → one patients row (E.164 phone) in tenant A, visible in the list", { tag: "@golden" }, async ({ page, ux }) => {
      ux.flow("register-patient", "Owner registers a new patient from the patient list (name, phone, age, sex)");
      const { tenantA } = run();
      const fullName = `E2E Synthetic Registered ${testTag()}`;
      const phoneDigits = syntheticPhoneDigits();

      await registerPatient(page, ux, fullName, phoneDigits);

      // The new record opens.
      await expect(page).toHaveURL(/\/patients\/[0-9a-f-]{36}$/);
      await expect(page.getByRole("heading", { level: 1, name: fullName })).toBeVisible();
      ux.done();

      // Exactly one row, in tenant A, phone normalised to E.164.
      const rows = await patientsByName(tenantA.id, fullName);
      expect(rows).toHaveLength(1);
      expect(rows[0].phone).toBe(`+91${phoneDigits}`);
      expect(page.url()).toContain(rows[0].id);

      // Visible in the patient list.
      await page.goto("/patients");
      await page.getByPlaceholder("Search by name, phone, or ABHA...").fill(fullName);
      await expect(page.getByRole("link", { name: fullName })).toBeVisible();
    });
  });

  test.describe("receptionist", () => {
    test.use({ storageState: storageStatePath("receptionist") });

    test("receptionist registers a patient → one patients row (E.164 phone) in tenant A (PO-3; v1 bug F-01 fixed)", async ({ page, ux }) => {
      const { tenantA } = run();
      const fullName = `E2E Synthetic Front Desk ${testTag()}`;
      const phoneDigits = syntheticPhoneDigits();

      await registerPatient(page, ux, fullName, phoneDigits);

      await expect(page).toHaveURL(/\/patients\/[0-9a-f-]{36}$/, { timeout: 15_000 });
      const rows = await patientsByName(tenantA.id, fullName);
      expect(rows).toHaveLength(1);
      expect(rows[0].phone).toBe(`+91${phoneDigits}`);
      expect(page.url()).toContain(rows[0].id);
    });
  });
});
