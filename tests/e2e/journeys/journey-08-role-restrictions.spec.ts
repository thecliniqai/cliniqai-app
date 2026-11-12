/**
 * TEST_STRATEGY journey 8 — role restrictions (V2-02 plan 02-03b, RL-15). The SERVER must refuse what a role may not
 * do; whether v1 also hides the control is characterised as-is (recorded as an annotation, not asserted).
 *
 * - Receptionist, direct URL to a consultation: the correct outcome (the clinical workspace is not served) is asserted
 *   under `test.fail()` — known v1 gap P1-07 (no permission gate on `/consultation/[id]`); signing from it IS refused
 *   by the server (asserted, passes).
 * - Receptionist, `/settings/clinic`: saving clinic settings is refused by the server; the tenant is unchanged.
 * - Nurse, adding a medicine on a consultation: refused by the server; no prescription item is written.
 * - Doctor, billing reports: the server redirects away (no `billing:view`).
 */
import type { Page, TestInfo } from "@playwright/test";
import { expect, test } from "../fixtures";
import { prescriptionItemNames, run, seedPatient, seedVisit, tenantName, testTag, visitById } from "../support/m0-data";
import { storageStatePath } from "../support/run-data";
import { knownBug, knownBugMessage } from "../support/known-bug";

const DENIED = "You do not have permission to perform this action.";
const NOTES_LABEL = "History of Present Illness & Clinical Notes";

async function inConsultationVisit(tag: string): Promise<string> {
  const { tenantA } = run();
  const patient = await seedPatient(tenantA.id, tenantA.users.owner.id, `E2E Synthetic Restricted ${tag}`);
  return seedVisit({
    tenantId: tenantA.id,
    patientId: patient.id,
    doctorId: tenantA.users.doctor.id,
    createdBy: tenantA.users.receptionist.id,
    status: "in_consultation",
  });
}

async function characteriseVisibility(page: Page, testInfo: TestInfo, what: string, name: RegExp): Promise<void> {
  const visible = await page.getByRole("button", { name }).or(page.getByRole("link", { name })).count();
  testInfo.annotations.push({ type: "ui-hiding (characterised)", description: `${what}: ${visible > 0 ? "shown" : "hidden"}` });
}

test.describe("receptionist", () => {
  test.use({ storageState: storageStatePath("receptionist") });

  test("direct URL to a consultation is not served (known v1 gap P1-07)", async ({ page }) => {
    await knownBug("P1-07", "v1 renders /consultation/[id] for roles without consultations:view; the gate lands in V2-08", async () => {
      const visitId = await inConsultationVisit(testTag());

      const response = await page.goto(`/consultation/${visitId}`);
      // Correct outcome: refused (redirect away, 403 or 404) — the clinical workspace never renders. Only these
      // marked assertions may carry the expected failure (IR-F4).
      expect(
        response?.status() === 200 && new URL(page.url()).pathname === `/consultation/${visitId}`,
        knownBugMessage("P1-07", "the consultation URL is refused for a receptionist"),
      ).toBe(false);
      await expect(page.getByLabel(NOTES_LABEL), knownBugMessage("P1-07", "the clinical notes never render")).toHaveCount(0, {
        timeout: 5_000,
      });
    });
  });

  test("signing a consultation from the direct URL is refused by the server", async ({ page }, testInfo) => {
    const visitId = await inConsultationVisit(testTag());

    await page.goto(`/consultation/${visitId}`);
    const sign = page.getByRole("button", { name: /Complete & Sign/ }).first();
    await characteriseVisibility(page, testInfo, "Complete & Sign for a receptionist", /Complete & Sign/);
    await sign.click();
    const dialog = page.getByRole("dialog", { name: "Complete & Sign Consultation" });
    await dialog.getByRole("button", { name: /Sign & Collect/ }).click();

    await expect(dialog.getByText(DENIED)).toBeVisible();
    const visit = await visitById(visitId);
    expect(visit).toMatchObject({ status: "in_consultation", signed_at: null });
  });

  test("saving clinic settings is refused by the server; the clinic is unchanged", async ({ page }, testInfo) => {
    const { tenantA } = run();
    const before = await tenantName(tenantA.id);

    await page.goto("/settings/clinic");
    const nameField = page.getByLabel(/^Clinic Name/);
    await expect(nameField).toBeVisible();
    await characteriseVisibility(page, testInfo, "Save Clinic Settings for a receptionist", /Save Clinic Settings/);
    await nameField.fill(`E2E Synthetic Renamed ${testTag()}`);
    // Submit the form as the browser would, without the v1 client-side required-field checks on the owner-doctor
    // credentials (those belong to the owner): the point is the server's answer to this role.
    await page.locator("form").filter({ has: nameField }).dispatchEvent("submit");

    await expect(page.getByText(DENIED)).toBeVisible();
    expect(await tenantName(tenantA.id)).toBe(before);
  });
});

test.describe("nurse", () => {
  test.use({ storageState: storageStatePath("nurse") });

  test("adding a medicine is refused by the server; no prescription item is written", async ({ page }, testInfo) => {
    const tag = testTag();
    const visitId = await inConsultationVisit(tag);
    const med = `E2E Synthetic Nurse Med ${tag}`;

    await page.goto(`/consultation/${visitId}`);
    const rx = page.locator("#prescription");
    const search = rx.getByLabel("Search CDCI Medicine or Brand Name:");
    await characteriseVisibility(page, testInfo, "Prescription builder for a nurse", /Add to Prescription|Templates/);
    await search.fill(med);
    await rx.getByRole("button", { name: /Add as custom medicine/ }).click();
    await rx.getByRole("button", { name: "Add to Prescription" }).click();

    await expect(rx.getByText(DENIED)).toBeVisible();
    expect(await prescriptionItemNames(visitId)).toEqual([]);
  });
});

test.describe("doctor", () => {
  test.use({ storageState: storageStatePath("doctor") });

  test("billing reports are refused by the server (redirected away)", async ({ page }, testInfo) => {
    await page.goto("/cabin");
    await characteriseVisibility(page, testInfo, "Billing navigation for a doctor", /Billing/);

    for (const path of ["/billing/reports", "/billing/register"]) {
      await page.goto(path);
      await expect(page).toHaveURL((url) => !url.pathname.startsWith("/billing"));
      await expect(page.getByText("Daily collection", { exact: false })).toHaveCount(0);
    }
  });
});
