/**
 * M0 characterisation flow 2 — walk-in to token (V2-02 plan 02-03b; FRONTEND_MIGRATION_PLAN M0).
 *
 * The front desk adds an EXISTING patient as a walk-in for the doctor. Outcome asserted: one `visits` row (walk-in,
 * status `waiting`, that doctor) and one `queue_tokens` row with the next token number for today, and the patient's
 * row on Today shows that token. (V2-08 08-03b: the walk-in is a sheet on Today, `?walkin=1`.)
 *
 * Characterised as-is: tokens are numbered per clinic per day, not per doctor, so "next number" is the tenant's next
 * number today (v1 read max + 1; since V2-05 05-08 a per-clinic, per-day counter row, `issue_queue_token` since 05-11a, which
 * continues from the day's maximum).
 */
import { expect, test } from "../fixtures";
import { appToday, maxTokenToday, run, seedPatient, testTag, tokenOf, visitsOf } from "../support/m0-data";
import { storageStatePath } from "../support/run-data";
import { filterToday, openToday, rowOf, showLane } from "../support/today-page";

test.use({ storageState: storageStatePath("receptionist") });

test("walk-in for an existing patient → waiting visit + next queue token, visible in the queue", { tag: "@golden" }, async ({ page, ux }) => {
  ux.flow("walk-in-token", "Front desk adds an existing patient as a walk-in and issues a token");
  const { tenantA } = run();
  const doctorId = tenantA.users.doctor.id;
  const patientName = `E2E Synthetic Walk-in ${testTag()}`;
  const patient = await seedPatient(tenantA.id, tenantA.users.owner.id, patientName);

  await openToday(page);
  const before = await maxTokenToday(tenantA.id);

  // 08-03b: the walk-in is a sheet on Today (`?walkin=1`). Keyboard path: search, Enter picks the patient, Enter adds them.
  await ux.click(page.getByRole("link", { name: "Add walk-in" }), "Add walk-in");
  const sheet = page.getByRole("dialog", { name: "Add walk-in" });
  await expect(sheet).toBeVisible();

  // Search; Enter picks the highlighted patient. The results can list other patients (the search also matches phones
  // containing the query's digits); this patient's name is unique, so the best match is theirs.
  await expect(sheet.getByText("Loading doctors…")).toHaveCount(0);
  await ux.fill(sheet.getByRole("combobox", { name: "Patient" }), patientName, "Patient");
  await expect(sheet.getByRole("option", { name: new RegExp(patientName) })).toBeVisible();
  await ux.press(sheet.getByRole("combobox", { name: "Patient" }), "Enter", "Enter (pick the patient)");

  // The doctor select shows when the clinic has more than one doctor (the owner practises here): name the doctor.
  await expect(sheet.locator("[data-walkin-patient]")).toContainText(patientName);
  const doctorSelect = sheet.getByRole("combobox", { name: "Doctor" });
  if (await doctorSelect.isVisible()) await ux.select(doctorSelect, doctorId, "Doctor");
  await ux.click(sheet.getByRole("button", { name: "Add to queue" }), "Add to queue");

  // The sheet closes and the patient's row shows the issued token.
  await expect(page.getByRole("dialog", { name: "Add walk-in" })).toHaveCount(0);
  await filterToday(page, patientName);
  await showLane(page, "Waiting");
  const row = rowOf(page, patientName);
  await expect(row).toBeVisible();
  ux.done();

  // Database: one walk-in visit for the doctor, now waiting, with the next token for today.
  const visits = await visitsOf(tenantA.id, patient.id);
  expect(visits).toHaveLength(1);
  expect(visits[0]).toMatchObject({ origin_type: "walk_in", status: "waiting", doctor_id: doctorId });
  const token = await tokenOf(visits[0].id);
  expect(token).not.toBeNull();
  expect(token!.date).toBe(appToday());
  expect(token!.token_number).toBeGreaterThan(before);
  expect(token!.token_number).toBe(before + 1);

  await expect(row.locator("[data-token-chip]")).toContainText(String(token!.token_number));
  await expect(row).toContainText("Walk-in");
});
