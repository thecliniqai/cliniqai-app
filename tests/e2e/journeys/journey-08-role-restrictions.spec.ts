/**
 * TEST_STRATEGY journey 8 — role restrictions (V2-02 plan 02-03b, RL-15). The SERVER must refuse what a role may not
 * do; whether v1 also hides the control is characterised as-is (recorded as an annotation, not asserted).
 *
 * - Receptionist and admin, direct URL to a consultation: not served (V2-08 08-01a, P1-07: the layout and the page
 *   require `consultations:view`); the user lands on their own home screen and no clinical field renders.
 * - Nurse (holds consultations:view, not consultations:edit), signing from the consultation URL: refused by the server.
 * - Receptionist, `/settings/clinic`: saving clinic settings is refused by the server; the tenant is unchanged.
 * - Nurse, adding a medicine on a consultation: refused by the server; no prescription item is written.
 * - Doctor, billing reports: the server redirects away (no `billing:view`).
 */
import { rxField } from "../support/rx-entry";
import type { Page, TestInfo } from "@playwright/test";
import { expect, test } from "../fixtures";
import { prescriptionItemNames, run, seedPatient, seedVisit, tenantName, testTag, visitById } from "../support/m0-data";
import { storageStatePath } from "../support/run-data";

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

async function expectConsultationNotServed(page: Page, role: "receptionist" | "admin"): Promise<void> {
  const visitId = await inConsultationVisit(testTag());
  await page.goto(`/consultation/${visitId}`);
  // Refused: the server redirects to the role's own home; the clinical workspace never renders.
  await expect(page, `${role} must not be served the consultation`).not.toHaveURL(new RegExp(`/consultation/${visitId}`));
  await expect(page.getByLabel(NOTES_LABEL)).toHaveCount(0);
  await expect(page.getByText("Vital Signs")).toHaveCount(0);
}

async function characteriseVisibility(page: Page, testInfo: TestInfo, what: string, name: RegExp): Promise<void> {
  const visible = await page.getByRole("button", { name }).or(page.getByRole("link", { name })).count();
  testInfo.annotations.push({ type: "ui-hiding (characterised)", description: `${what}: ${visible > 0 ? "shown" : "hidden"}` });
}

test.describe("receptionist", () => {
  test.use({ storageState: storageStatePath("receptionist") });

  test("direct URL to a consultation is not served (P1-07)", async ({ page }) => {
    await expectConsultationNotServed(page, "receptionist");
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

test.describe("admin", () => {
  test.use({ storageState: storageStatePath("admin") });

  test("direct URL to a consultation is not served (P1-07)", async ({ page }) => {
    await expectConsultationNotServed(page, "admin");
  });
});

test.describe("nurse", () => {
  test.use({ storageState: storageStatePath("nurse") });

  test("signing a consultation from the direct URL is refused by the server", async ({ page }, testInfo) => {
    const visitId = await inConsultationVisit(testTag());

    await page.goto(`/consultation/${visitId}`);
    const sign = page.getByRole("button", { name: /Finish visit/ }).first();
    await characteriseVisibility(page, testInfo, "Finish visit for a nurse", /Finish visit/);
    await sign.click();
    const dialog = page.getByRole("dialog", { name: "Complete & Sign Consultation" });
    await dialog.getByRole("button", { name: /Sign & (Collect|Route)/ }).click();

    await expect(dialog.getByText(DENIED)).toBeVisible();
    const visit = await visitById(visitId);
    expect(visit).toMatchObject({ status: "in_consultation", signed_at: null });
  });

  test("adding a medicine is refused by the server; no prescription item is written", async ({ page }, testInfo) => {
    const tag = testTag();
    const visitId = await inConsultationVisit(tag);
    const med = `E2E Synthetic Nurse Med ${tag}`;

    await page.goto(`/consultation/${visitId}`);
    const rx = page.locator("#prescription");
    await characteriseVisibility(page, testInfo, "Prescription builder for a nurse", /Add to prescription|Templates/);
    // V2-09c 09C-01: the keyboard builder. The nurse's search is refused (no prescriptions:edit) and the typed name is still offered as an Add row; the
    // command is then refused by the server, which is the outcome this journey asserts.
    const search = rxField(rx);
    await search.fill(med);
    await expect(rx.getByRole("option", { name: /^Add / })).toBeVisible({ timeout: 10_000 });
    await search.press("Enter");
    await expect(rx.locator("[data-dose-builder]")).toBeVisible();
    for (const key of ["1", "5", "d", "Enter"]) await search.press(key);

    await expect(rx.getByText(DENIED)).toBeVisible();
    expect(await prescriptionItemNames(visitId)).toEqual([]);
  });
});

test.describe("doctor", () => {
  test.use({ storageState: storageStatePath("doctor") });

  test("billing reports are refused by the server (redirected away)", async ({ page }, testInfo) => {
    await page.goto("/today");
    await characteriseVisibility(page, testInfo, "Billing navigation for a doctor", /Billing/);

    for (const path of ["/billing/reports", "/billing/register"]) {
      await page.goto(path);
      await expect(page).toHaveURL((url) => !url.pathname.startsWith("/billing"));
      await expect(page.getByText("Daily collection", { exact: false })).toHaveCount(0);
    }
  });
});
