/**
 * Reversible saves on the consult (V2-09e 09E-08, R-11, B-6/B-7; threat T-09E-08 "a save shown as done that failed").
 *
 * The Rx line is the tracer: a line added by keyboard shows at once with a pending marker while its one `change_prescription` call is held (so the database
 * cannot have it yet), the call is the only request the save makes (no RSC page request), the line is what the database stores after a reload, a refused
 * or lost save takes the line back with the fixed error and Retry, and the entry field stays editable while a line is saved (Q-6: keys typed during the
 * save are kept; the 09C field was read-only and dropped them). Diagnosis add, remove and note follow the same rules.
 * Each test owns its doctor and patient. Synthetic data only. 0 retries: a case that only passes on retry is a defect.
 */
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { awaitHydrated } from "../support/hydrated";
import { run, seedPatient, seedVisit, testTag } from "../support/m0-data";
import { storageStatePath, type RunUser } from "../support/run-data";
import { retireOwnDoctor, seedOwnDoctor, signInAsOwnDoctor } from "../support/own-doctor";
import { rxItemsOf } from "../support/cdci-fixtures";
import { addCustomMedicine, rxField } from "../support/rx-entry";
import { countActionPosts, holdActions } from "../support/hold-actions";
import { countRscRequests } from "../support/today-page";
import { getAdminClient } from "../../helpers/supabase-admin";

test.use({ storageState: storageStatePath("doctor") });

let doctor: RunUser | null = null;
test.afterEach(async () => {
  if (doctor) await retireOwnDoctor(doctor);
  doctor = null;
});

const rxList = (page: Page) => page.getByRole("list", { name: "Prescribed medicines" }).getByRole("listitem");
const marker = (prefix: string) => `${prefix} ${testTag().replace(/\W/g, "")}`;

async function openConsult(page: Page, label: string): Promise<string> {
  const { tenantA } = run();
  const own = await seedOwnDoctor(label);
  doctor = own;
  const patient = await seedPatient(tenantA.id, tenantA.users.owner.id, `E2E Synthetic ${label} ${testTag()}`);
  const visitId = await seedVisit({ tenantId: tenantA.id, patientId: patient.id, doctorId: own.id, createdBy: tenantA.users.receptionist.id, status: "in_consultation" });
  await signInAsOwnDoctor(page, own);
  await page.goto(`/consultation/${visitId}`);
  await expect(page.getByLabel("History of Present Illness & Clinical Notes")).toBeVisible();
  await awaitHydrated(page);
  return visitId;
}

/** Types `name`, walks to the "Add" row, picks it, and chooses 1-0-1 for 5 days: the builder is open with a complete dose; the next Enter adds the line. */
async function readyToAdd(page: Page, name: string): Promise<void> {
  const rx = page.locator("#prescription");
  const field = rxField(rx);
  await field.fill(name);
  const add = rx.getByRole("option", { name: new RegExp(`^Add .${name}.$`) });
  await expect(add).toBeVisible({ timeout: 10_000 });
  const options = await rx.getByRole("option").count();
  for (let i = 0; i < Math.max(1, options - 1); i++) await field.press("ArrowDown");
  await expect(add).toHaveAttribute("aria-selected", "true");
  await field.press("Enter");
  await expect(rx.locator("[data-dose-builder]")).toBeVisible();
  await field.press("1");
  for (const ch of "5d") await field.press(ch);
}

const changesOf = (name: string) => (request: import("@playwright/test").Request) => (request.postData() ?? "").includes(name);

test("@golden tracer: an Rx line added by keyboard shows at once with a pending marker while its call is held; one call, no RSC request; the database holds what the screen showed after a reload", async ({ page }) => {
  const visitId = await openConsult(page, "RxTracer");
  const name = marker("Qzxtracer");
  const rx = page.locator("#prescription");
  await readyToAdd(page, name);
  const hold = await holdActions(page, { matches: changesOf(name) });
  const posts = countActionPosts(page, changesOf(name));
  const rsc = countRscRequests(page);

  await rxField(rx).press("Enter");
  // The line is on screen before the database has it: the call is held in the browser, so nothing was written.
  const line = rxList(page).filter({ hasText: name });
  await expect(line).toHaveCount(1);
  await expect(line).toHaveAttribute("data-pending", "true");
  await expect(line).toContainText("Saving");
  await expect.poll(() => hold.waiting()).toBe(1);
  expect(await rxItemsOf(visitId)).toHaveLength(0);
  // The builder closed and the field is free for the next medicine.
  await expect(rx.locator("[data-dose-builder]")).toHaveCount(0);
  await expect(rxField(rx)).toHaveValue("");

  hold.release();
  await expect(line).not.toHaveAttribute("data-pending", "true");
  await expect(line).not.toContainText("Saving");
  await expect.poll(async () => (await rxItemsOf(visitId)).map((i) => i.medicine_name)).toEqual([name]);
  // One command; nothing re-rendered the page; no allergy context was read for it.
  await page.waitForLoadState("networkidle");
  expect(posts()).toBe(1);
  expect(rsc()).toBe(0);

  // After a reload the screen shows what the database holds.
  const stored = (await rxItemsOf(visitId))[0];
  await page.reload();
  await awaitHydrated(page);
  await expect(rxList(page).filter({ hasText: name })).toHaveCount(1);
  expect(stored).toMatchObject({ medicine_name: name, dosage: "1-0-1", duration: "5 days" });
});

test("Q-6: keys typed while a line is being saved are kept; the field stays editable (the 09C field was read-only and dropped them)", async ({ page }) => {
  await openConsult(page, "RxKeys");
  const name = marker("Qzxfirst");
  const rx = page.locator("#prescription");
  await readyToAdd(page, name);
  // The add is held for 400 ms: long enough for the next medicine's first letters to be typed during the save.
  const hold = await holdActions(page, { matches: changesOf(name) });
  await rxField(rx).press("Enter");
  await expect.poll(() => hold.waiting()).toBe(1);
  setTimeout(() => hold.release(), 400);
  await rxField(rx).pressSequentially("Paracetamol");
  await expect.poll(() => hold.waiting()).toBe(0);
  await expect(rxField(rx)).toHaveValue("Paracetamol");
  await expect(rxList(page).filter({ hasText: name })).toHaveCount(1);
});

test("a refused save takes the line back: it disappears, the dose builder returns with the fixed error, and Enter sends the same save again", async ({ page }) => {
  const visitId = await openConsult(page, "RxRefused");
  const name = marker("Qzxrefused");
  const rx = page.locator("#prescription");
  await readyToAdd(page, name);
  const cut = await holdActions(page, { held: false, matches: changesOf(name) });
  cut.cutAll();
  await rxField(rx).press("Enter");
  // Shown at once, then taken back when the command could not be reached (the one automatic retry fails too).
  await expect(rxList(page).filter({ hasText: name })).toHaveCount(1);
  await expect(rxList(page)).toHaveCount(0, { timeout: 30_000 });
  await expect(rx.locator("[data-dose-builder]")).toBeVisible();
  await expect(rx.locator("[data-dose-builder]").getByRole("alert")).toContainText("The change was not saved");
  expect(await rxItemsOf(visitId)).toHaveLength(0);

  cut.pass();
  await rxField(rx).press("Enter");
  await expect(rxList(page).filter({ hasText: name })).toHaveCount(1);
  await expect.poll(async () => (await rxItemsOf(visitId)).map((i) => i.medicine_name)).toEqual([name]);
  await expect(rxList(page).filter({ hasText: name })).not.toHaveAttribute("data-pending", "true");
});

test("a refused save after the doctor started the next medicine: the field is not touched, a notice with Retry says the line was not added, and Retry stores it once", async ({ page }) => {
  const visitId = await openConsult(page, "RxLost");
  const name = marker("Qzxlostadd");
  const rx = page.locator("#prescription");
  await readyToAdd(page, name);
  const cut = await holdActions(page, { held: false, matches: changesOf(name) });
  cut.cutAll();
  await rxField(rx).press("Enter");
  await rxField(rx).pressSequentially("Qzxnext");
  const notice = rx.locator("[data-rx-add-failed]");
  await expect(notice).toBeVisible({ timeout: 30_000 });
  await expect(rxField(rx)).toHaveValue("Qzxnext");
  await expect(rxList(page)).toHaveCount(0);
  expect(await rxItemsOf(visitId)).toHaveLength(0);

  cut.pass();
  await notice.getByRole("button", { name: "Retry" }).click();
  await expect(notice).toHaveCount(0);
  await expect.poll(async () => (await rxItemsOf(visitId)).map((i) => i.medicine_name)).toEqual([name]);
  await expect(rxField(rx)).toHaveValue("Qzxnext");
});

test("remove and edit show at once and come back with the fixed error and Retry when the save is refused", async ({ page }) => {
  const visitId = await openConsult(page, "RxEditRm");
  const name = marker("Qzxedit");
  const rx = page.locator("#prescription");
  await addCustomMedicine(rx, name);
  await page.waitForLoadState("networkidle");
  expect(await rxItemsOf(visitId)).toHaveLength(1);

  // Remove: gone at once, back with the error when the command cannot be reached.
  const cut = await holdActions(page, { held: false });
  cut.cutAll();
  await page.getByRole("button", { name: `Remove ${name}` }).click();
  await expect(rxList(page)).toHaveCount(0);
  await expect(rxList(page)).toHaveCount(1, { timeout: 30_000 });
  const alert = rx.getByRole("alert").filter({ hasText: /./ }).first();
  await expect(alert.getByRole("button", { name: "Retry" })).toBeVisible();
  expect(await rxItemsOf(visitId)).toHaveLength(1);
  cut.pass();
  await alert.getByRole("button", { name: "Retry" }).click();
  await expect(rxList(page)).toHaveCount(0);
  await expect.poll(async () => (await rxItemsOf(visitId)).length).toBe(0);
});

test("a diagnosis is added at once, with one call and no RSC request; a refused removal puts it back with Retry", async ({ page }) => {
  await openConsult(page, "DxSave");
  const dx = `Qzxdx${testTag().replace(/\W/g, "")}`;
  await page.getByPlaceholder(/Search diagnosis name/).fill(dx);
  const add = page.getByRole("option", { name: new RegExp(`Add .${dx}. as my own diagnosis`) });
  await expect(add).toBeVisible({ timeout: 20_000 });
  const hold = await holdActions(page);
  const posts = countActionPosts(page);
  const rsc = countRscRequests(page);
  await add.click();
  // Listed before the database has it.
  await expect(page.getByText(dx, { exact: false }).first()).toBeVisible();
  await expect.poll(() => hold.waiting()).toBe(1);
  const { data: before } = await getAdminClient().from("consultation_diagnoses").select("id").eq("diagnosis_name", dx);
  expect(before ?? []).toHaveLength(0);
  hold.release();
  await expect.poll(async () => ((await getAdminClient().from("consultation_diagnoses").select("id").eq("diagnosis_name", dx)).data ?? []).length).toBe(1);
  await page.waitForLoadState("networkidle");
  expect(posts()).toBe(1);
  expect(rsc()).toBe(0);

  // Removal refused: the diagnosis comes back, the notice offers Retry.
  const cut = await holdActions(page, { held: false });
  cut.cutAll();
  await page.getByRole("button", { name: "Remove diagnosis" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /./ }).getByRole("button", { name: "Retry" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(dx, { exact: false }).first()).toBeVisible();
});
