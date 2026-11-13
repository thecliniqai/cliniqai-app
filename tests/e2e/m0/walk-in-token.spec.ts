/**
 * M0 characterisation flow 2 — walk-in to token (V2-02 plan 02-03b; FRONTEND_MIGRATION_PLAN M0).
 *
 * The front desk adds an EXISTING patient as a walk-in for the doctor. Outcome asserted: one `visits` row (walk-in,
 * status `waiting`, that doctor) and one `queue_tokens` row with the next token number for today, and the patient's
 * card in the live queue shows that token.
 *
 * Characterised as-is: v1 numbers tokens per clinic per day (`generate_daily_queue_token(tenant, date)`, max + 1),
 * not per doctor, so "next number" is the tenant's next number today.
 */
import { expect, test } from "../fixtures";
import { appToday, maxTokenToday, run, seedPatient, testTag, tokenOf, visitsOf } from "../support/m0-data";
import { storageStatePath } from "../support/run-data";

test.use({ storageState: storageStatePath("receptionist") });

test("walk-in for an existing patient → waiting visit + next queue token, visible in the queue", { tag: "@golden" }, async ({ page, ux }) => {
  ux.flow("walk-in-token", "Front desk adds an existing patient as a walk-in and issues a token");
  const { tenantA } = run();
  const doctorId = tenantA.users.doctor.id;
  const patientName = `E2E Synthetic Walk-in ${testTag()}`;
  const patient = await seedPatient(tenantA.id, tenantA.users.owner.id, patientName);

  await page.goto("/queue");
  await expect(page.getByRole("heading", { name: "Live Reception Queue" })).toBeVisible();
  const before = await maxTokenToday(tenantA.id);

  await ux.click(page.getByRole("button", { name: "+ Add Walk-In" }), "+ Add Walk-In");
  const drawer = page
    .getByRole("heading", { name: "Quick Walk-In Registration" })
    .locator("xpath=ancestor::div[contains(@class,'fixed')][1]");
  await expect(drawer).toBeVisible();

  await ux.select(drawer.getByRole("combobox"), doctorId, "Consulting Doctor");
  await ux.fill(drawer.getByLabel("Search by Name or Phone"), patientName, "Search by Name or Phone");
  // The results can list other patients: tenant A is shared by every spec and device project, and the search also
  // matches phones containing all the query's digits run together ("E2E … eab1a8" searched phones for "218", which
  // another synthetic patient's random number contained, in CI run 43324692904). Issue the token from this patient's
  // own row, as the front desk would.
  const result = drawer
    .getByRole("heading", { name: patientName, exact: true })
    .locator("xpath=ancestor::div[contains(@class,'rounded-xl')][1]");
  await expect(result).toBeVisible();
  await ux.click(result.getByRole("button", { name: "Issue Token" }), "Issue Token");

  // The drawer closes and the patient's card shows the issued token.
  await expect(page.getByRole("heading", { name: "Quick Walk-In Registration" })).toHaveCount(0);
  const card = page
    .getByRole("heading", { name: patientName, exact: true })
    .locator("xpath=ancestor::div[contains(@class,'rounded-2xl')][1]");
  await expect(card).toBeVisible();
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

  await expect(card).toContainText(`#${String(token!.token_number).padStart(2, "0")}`);
  await expect(card).toContainText("Waiting");
});
