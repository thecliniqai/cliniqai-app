/**
 * M0 characterisation flow 1 — register a patient (V2-02 plan 02-03b; FRONTEND_MIGRATION_PLAN M0).
 *
 * Outcome asserted: exactly one `patients` row in tenant A with the entered name and the phone normalised to E.164,
 * the new patient's record opens, and the patient is findable in the patient list.
 *
 * Receptionist variant: the CORRECT outcome (the patient is registered) is asserted under `test.fail()` — known v1 bug
 * F-01 (receptionists lack `patients:edit`, the save fails), which flips to a pass when PO-3 lands (V2-05/V2-08); the
 * suite then turns red and this annotation must be removed (RL-19).
 */
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import type { UxCounter } from "../support/ux-counter";
import { patientsByName, run, syntheticPhoneDigits, testTag } from "../support/m0-data";
import { storageStatePath } from "../support/run-data";
import { knownBug, knownBugMessage } from "../support/known-bug";

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

    test("receptionist registers a patient (known v1 bug F-01)", async ({ page, ux }) => {
      await knownBug("F-01", "receptionists cannot register patients in v1 (no patients:edit); fixed by PO-3 in V2-05/V2-08", async () => {
        const { tenantA } = run();
        const fullName = `E2E Synthetic Front Desk ${testTag()}`;
        const phoneDigits = syntheticPhoneDigits();

        await registerPatient(page, ux, fullName, phoneDigits);

        // Correct outcome: the record is created and opens. Only these marked assertions may carry the expected
        // failure (IR-F4); anything failing earlier turns the test red.
        await expect(page, knownBugMessage("F-01", "the new patient's record opens")).toHaveURL(/\/patients\/[0-9a-f-]{36}$/, {
          timeout: 15_000,
        });
        const rows = await patientsByName(tenantA.id, fullName);
        expect(rows, knownBugMessage("F-01", "exactly one patient row")).toHaveLength(1);
        expect(rows[0].phone, knownBugMessage("F-01", "the phone is stored in E.164")).toBe(`+91${phoneDigits}`);
      });
    });
  });
});
