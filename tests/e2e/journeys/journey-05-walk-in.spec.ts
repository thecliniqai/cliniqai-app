/**
 * TEST_STRATEGY journey 5 — walk-in to token, the doctor calls the patient in (V2-08 08-03b, R-1, R-19, P1-29, P1-42).
 *
 * As the receptionist: add an existing patient as a walk-in from Today (the walk-in sheet; existing patient = search, Enter,
 * Enter), the token appears on the patient's row. In the doctor's own browser the same patient is under "Waiting (mine)" of
 * "My queue"; "Call in" starts the consultation (one command: the visit is `in_consultation`) and opens the consult. The walk-in
 * sheet is axe-clean (0 serious or critical) at the project's width. The `ux` counter writes the receptionist's interaction
 * counts (`test-results/m0/counts/journey-05-walk-in.json`, desktop-chrome). Synthetic data only.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, routeLoopbackOnly } from "../fixtures";
import { E2E_BASE_URL } from "../support/app-env";
import { appToday, run, seedPatient, testTag, tokenOf, visitsOf } from "../support/m0-data";
import { storageStatePath } from "../support/run-data";
import { settleAnimations } from "../support/settle";
import { visitStatusOf } from "../support/today-data";
import { openToday, rowInLane, rowOf, filterToday } from "../support/today-page";

test.use({ storageState: storageStatePath("receptionist") });

const TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];

test("@golden journey 5: the receptionist adds a walk-in, the doctor sees it in Waiting (mine), Call in opens the consult", async ({ page, browser, ux }) => {
  ux.flow("journey-05-walk-in", "Receptionist adds an existing patient as a walk-in; the doctor calls them in");
  const { tenantA } = run();
  const doctorId = tenantA.users.doctor.id;
  const name = `E2E Synthetic Journey5 ${testTag()}`;
  const patient = await seedPatient(tenantA.id, tenantA.users.owner.id, name);

  await openToday(page);
  await ux.click(page.getByRole("link", { name: "Add walk-in" }), "Add walk-in");
  const sheet = page.getByRole("dialog", { name: "Add walk-in" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText("Loading doctors…")).toHaveCount(0);

  // The sheet is axe-clean (find stage) at this width.
  await settleAnimations(page);
  const axe = await new AxeBuilder({ page }).include("[data-walkin-sheet-root]").withTags(TAGS).analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);

  // Existing patient: type the mobile number, Enter picks the patient, the doctor, Add to queue.
  await ux.fill(sheet.getByRole("combobox", { name: "Patient" }), patient.phone.slice(-10), "Mobile number");
  await expect(sheet.getByRole("option", { name: new RegExp(name) })).toBeVisible();
  await ux.press(sheet.getByRole("combobox", { name: "Patient" }), "Enter", "Enter (pick the patient)");
  await expect(sheet.locator("[data-walkin-patient]")).toContainText(name);
  const doctorSelect = sheet.getByRole("combobox", { name: "Doctor" });
  if (await doctorSelect.isVisible()) await ux.select(doctorSelect, doctorId, "Doctor");
  await ux.click(sheet.getByRole("button", { name: "Add to queue" }), "Add to queue");
  await expect(page.getByRole("dialog", { name: "Add walk-in" })).toHaveCount(0);
  ux.done();

  // The token is on the patient's row.
  await filterToday(page, name);
  const row = rowOf(page, name);
  await expect(row).toBeVisible();
  const visits = await visitsOf(tenantA.id, patient.id);
  expect(visits).toHaveLength(1);
  expect(visits[0]).toMatchObject({ origin_type: "walk_in", status: "waiting", doctor_id: doctorId });
  const token = await tokenOf(visits[0].id);
  expect(token?.date).toBe(appToday());
  await expect(row.locator("[data-token-chip]")).toContainText(String(token!.token_number));

  // The doctor's own browser: Waiting (mine), then Call in.
  const blocked: string[] = [];
  const other = await browser.newContext({
    baseURL: E2E_BASE_URL,
    serviceWorkers: "block",
    storageState: storageStatePath("doctor"),
    viewport: { width: 1280, height: 900 },
  });
  await routeLoopbackOnly(other, blocked);
  try {
    const doctor = await other.newPage();
    await openToday(doctor);
    await expect(doctor.getByRole("heading", { name: "Waiting (mine)" })).toBeVisible();
    await filterToday(doctor, name);
    await expect(rowInLane(doctor, "waiting", name)).toBeVisible();
    await doctor.getByRole("button", { name: `Call in ${name}` }).click();
    await expect(doctor).toHaveURL(new RegExp(`/consultation/${visits[0].id}$`), { timeout: 20_000 });
    expect(await visitStatusOf(visits[0].id)).toBe("in_consultation");
  } finally {
    await other.close();
  }
  expect(blocked, "no non-loopback request").toEqual([]);
});
