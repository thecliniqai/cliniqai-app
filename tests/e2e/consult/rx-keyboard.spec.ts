/**
 * V2-09c 09C-01 (R-4, R-5; M4.4 "add Rx line by keyboard only"; roadmap acceptance 1): the Rx builder with the keyboard. This file starts with the tracer
 * (one medicine, the narrowest vertical slice: search route, command, entry row, line list), written first and red on the v1 builder (Enter did nothing).
 * Each test owns its doctor and patient: desktop-chrome, pixel-7 and iphone-15 share one database in the PR lane. Synthetic data only.
 */
import { expect, test } from "../fixtures";
import { awaitHydrated } from "../support/hydrated";
import { run, seedPatient, seedVisit, testTag } from "../support/m0-data";
import { storageStatePath, type RunUser } from "../support/run-data";
import { retireOwnDoctor, seedOwnDoctor, signInAsOwnDoctor } from "../support/own-doctor";
import { RX_EDIT_ROWS, RX_KEYBOARD_ROWS, RX_TRACER_ROW, rxItemsOf, upsertCdciRows } from "../support/cdci-fixtures";
import { commitThenAbort } from "../support/commit-then-abort";
import { getAdminClient } from "../../helpers/supabase-admin";
import { addCustomMedicine, rxField } from "../support/rx-entry";

test.use({ storageState: storageStatePath("doctor") });

let doctor: RunUser | null = null;
test.afterEach(async () => {
  if (doctor) await retireOwnDoctor(doctor);
  doctor = null;
});

const admin = getAdminClient();
type Page = import("@playwright/test").Page;

/** A consult in draft for the test's own doctor, opened with the single-key shortcuts on. */
async function openConsult(page: Page, label: string, status: "in_consultation" | "waiting" = "in_consultation"): Promise<string> {
  const { tenantA } = run();
  const own = await seedOwnDoctor(label);
  doctor = own;
  const patient = await seedPatient(tenantA.id, tenantA.users.owner.id, `E2E Synthetic ${label} ${testTag()}`);
  const visitId = await seedVisit({
    tenantId: tenantA.id,
    patientId: patient.id,
    doctorId: own.id,
    createdBy: tenantA.users.receptionist.id,
    status,
  });
  await signInAsOwnDoctor(page, own);
  await page.addInitScript(() => localStorage.setItem("clinicos.pref.shortcuts", "on"));
  await page.goto(`/consultation/${visitId}`);
  await expect(page.getByLabel("History of Present Illness & Clinical Notes")).toBeVisible();
  await awaitHydrated(page);
  return visitId;
}

test("@golden tracer: one medicine by keyboard (M, four letters, Enter, 2, 5d, Enter) is in the database after a reload, with 0 clicks", async ({ page, ux }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "a hardware keyboard on a fine pointer: the desktop project");
  await upsertCdciRows([RX_TRACER_ROW]);
  const visitId = await openConsult(page, "RxTracer");
  ux.flow("consult-rx-tracer", "One medicine by keyboard: M, four letters, Enter, 2, 5d, Enter");

  const field = page.locator("[data-rx-search]");
  await ux.press(page.locator("body"), "m", "M: focus the medicine field");
  await expect(field).toBeFocused();
  for (const ch of "qzrt") await ux.press(field, ch, `Letter ${ch}`);
  await expect(page.getByText(RX_TRACER_ROW.brand_name).first()).toBeVisible({ timeout: 8_000 });
  await ux.press(field, "Enter", "Enter: pick the top match");
  await expect(page.locator("[data-dose-builder]")).toBeVisible({ timeout: 4_000 });
  await ux.press(field, "2", "2: frequency 1-0-0");
  await ux.press(field, "5", "5: duration digit");
  await ux.press(field, "d", "d: duration unit");
  await ux.press(field, "Enter", "Enter: add the line");
  await expect(page.getByRole("list", { name: "Prescribed medicines" }).getByRole("listitem")).toHaveCount(1, { timeout: 8_000 });
  ux.done();
  expect(ux.counts()).toMatchObject({ clicks: 0, fills: 0 });

  await page.reload();
  await expect(page.getByRole("list", { name: "Prescribed medicines" }).getByRole("listitem")).toHaveCount(1);
  const items = await rxItemsOf(visitId);
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({
    medicine_name: RX_TRACER_ROW.brand_name,
    dosage: "1-0-0",
    duration: "5 days",
    timing: null,
    cdci_brand_id: RX_TRACER_ROW.id,
  });
});

const rxList = (page: Page) => page.getByRole("list", { name: "Prescribed medicines" }).getByRole("listitem");
const KBD_NAMES = RX_KEYBOARD_ROWS.map((r) => r.brand_name);

test("@golden three medicines with the keyboard only: Alt+4, Tab, the name, Enter, a frequency key, a duration, Enter; 0 clicks, 3 stored lines (acceptance 1, M4.4)", async ({ page, ux }) => {
  await upsertCdciRows(RX_KEYBOARD_ROWS);
  const visitId = await openConsult(page, "RxThree");
  ux.flow("consult-rx-three", "Three medicines by keyboard only: Alt+4, Tab, name, Enter, frequency key, duration, Enter, three times");

  await ux.press(page.locator("body"), "Alt+Digit4", "Alt+4: the Prescription section");
  await expect(page.locator("#prescription-title")).toBeFocused();
  await ux.press(page.locator("#prescription-title"), "Tab", "Tab: the medicine field");
  const field = rxField(page);
  await expect(field).toBeFocused();
  const doses = [["1", "5d"], ["2", "7d"], ["3", "10d"]] as const;
  for (const [index, name] of ["qzrkey alpha", "qzrkey beta", "qzrkey gamma"].entries()) {
    for (const ch of name) await ux.press(field, ch, `Letter ${ch}`);
    await expect(page.getByRole("option", { name: new RegExp(KBD_NAMES[index]) }).first()).toBeVisible({ timeout: 8_000 });
    await ux.press(field, "Enter", "Enter: pick");
    await expect(page.locator("[data-dose-builder]")).toBeVisible();
    await ux.press(field, doses[index][0], `Frequency ${doses[index][0]}`);
    for (const ch of doses[index][1]) await ux.press(field, ch, `Duration ${ch}`);
    await ux.press(field, "Enter", "Enter: add");
    await expect(rxList(page)).toHaveCount(index + 1, { timeout: 8_000 });
    await expect(field).toBeFocused();
  }
  ux.done();
  expect(ux.counts()).toMatchObject({ clicks: 0, fills: 0, selects: 0, toggles: 0 });

  await expect.poll(async () => (await rxItemsOf(visitId)).map((i) => [i.medicine_name, i.dosage, i.duration, i.timing])).toEqual([
    [KBD_NAMES[0], "1-0-1", "5 days", null],
    [KBD_NAMES[1], "1-0-0", "7 days", null],
    [KBD_NAMES[2], "0-0-1", "10 days", null],
  ]);
});

test("a custom medicine's stored dose is taken with Enter, Enter: nothing else is typed", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "a hardware keyboard on a fine pointer: the desktop project");
  const visitId = await openConsult(page, "RxUsual");
  const name = `Qzxusual Mix ${testTag().replace(/\W/g, "")}`;
  const own = doctor!;
  await admin.from("doctor_custom_medicines").insert({
    tenant_id: run().tenantA.id,
    doctor_id: own.id,
    medicine_name: name,
    generic_name: "Qzxusual",
    dose_form: "Syrup",
    default_dosage: "1-1-1",
    default_timing: "With food",
    default_duration: "3 days",
    use_count: 4,
  }).throwOnError();
  await page.keyboard.press("m");
  await rxField(page).pressSequentially(name.slice(0, 10));
  await expect(page.getByRole("option", { name: new RegExp(name) })).toBeVisible({ timeout: 8_000 });
  await rxField(page).press("Enter");
  await expect(page.locator("[data-dose-summary]")).toHaveText("1-1-1 · With food · 3 days");
  await rxField(page).press("Enter");
  await expect(rxList(page)).toHaveCount(1, { timeout: 8_000 });
  const items = await rxItemsOf(visitId);
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({ medicine_name: name, dosage: "1-1-1", timing: "With food", duration: "3 days", cdci_brand_id: null });
});

test("a catalogue medicine has no usual dose: Enter after the pick says what to choose and stores nothing", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "a hardware keyboard on a fine pointer: the desktop project");
  await upsertCdciRows(RX_KEYBOARD_ROWS);
  const visitId = await openConsult(page, "RxNoUsual");
  await page.keyboard.press("m");
  await rxField(page).pressSequentially("qzrkey alpha");
  await expect(page.getByRole("option", { name: /Qzrkey Alpha/ })).toBeVisible({ timeout: 8_000 });
  await rxField(page).press("Enter");
  await expect(page.locator("[data-dose-builder]")).toBeVisible();
  // Nothing is chosen: no frequency, no timing, no duration are selected for the doctor.
  await expect(page.getByRole("radiogroup", { name: "Frequency" }).getByRole("radio", { checked: true })).toHaveCount(0);
  await expect(page.getByRole("radiogroup", { name: "Timing" }).getByRole("radio", { checked: true })).toHaveCount(0);
  await expect(page.getByRole("radiogroup", { name: "Duration" }).getByRole("radio", { checked: true })).toHaveCount(0);
  await rxField(page).press("Enter");
  await expect(page.getByRole("alert").filter({ hasText: "Choose a frequency (1 to 5) and a duration such as 5d" })).toBeVisible();
  await page.waitForTimeout(500);
  expect(await rxItemsOf(visitId)).toEqual([]);
  // The doctor chooses: only a frequency is still not enough, then the duration completes the line.
  await rxField(page).press("2");
  await rxField(page).press("Enter");
  await expect(page.getByRole("alert").filter({ hasText: /Type the duration/ })).toBeVisible();
  for (const key of ["7", "d", "Enter"]) await rxField(page).press(key);
  await expect(rxList(page)).toHaveCount(1, { timeout: 8_000 });
  expect((await rxItemsOf(visitId))[0]).toMatchObject({ dosage: "1-0-0", duration: "7 days", timing: null });
});

test("a committed line's duration is edited in 3 taps: the pill, the duration tile, Update line; the row keeps its id", async ({ page, ux }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "the tap count is the desktop project's");
  await upsertCdciRows(RX_EDIT_ROWS);
  const visitId = await openConsult(page, "RxEdit");
  await page.keyboard.press("m");
  await rxField(page).pressSequentially("qzredit");
  await expect(page.getByRole("option", { name: /Qzredit Alpha/ })).toBeVisible({ timeout: 8_000 });
  for (const key of ["Enter", "1", "5", "d", "Enter"]) await rxField(page).press(key);
  await expect(rxList(page)).toHaveCount(1, { timeout: 8_000 });
  const before = (await rxItemsOf(visitId))[0];

  ux.flow("consult-rx-edit", "Edit a committed line's duration: pill, tile, Update line");
  await ux.click(page.getByRole("button", { name: /5 days\. Edit dose of Qzredit Alpha 100/ }), "Duration pill");
  await ux.click(page.getByRole("radiogroup", { name: "Duration" }).getByRole("radio", { name: "10 days" }), "Tile: 10 days");
  await ux.click(page.getByRole("button", { name: "Update line" }), "Update line");
  await expect(page.getByRole("button", { name: /10 days\. Edit dose of Qzredit Alpha 100/ })).toBeVisible({ timeout: 8_000 });
  ux.done();
  expect(ux.counts()).toMatchObject({ clicks: 3, keystrokes: 0 });

  const after = await rxItemsOf(visitId);
  expect(after).toHaveLength(1);
  expect(after[0]).toMatchObject({ id: before.id, medicine_name: before.medicine_name, dosage: "1-0-1", duration: "10 days" });
});

test("remove, then Undo within the toast: one row with the same values", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "the toast and the pointer are the desktop project's");
  await upsertCdciRows(RX_EDIT_ROWS);
  const visitId = await openConsult(page, "RxUndo");
  await page.keyboard.press("m");
  await rxField(page).pressSequentially("qzredit");
  await expect(page.getByRole("option", { name: /Qzredit Alpha/ })).toBeVisible({ timeout: 8_000 });
  for (const key of ["Enter", "4", "7", "d", "Enter"]) await rxField(page).press(key);
  await expect(rxList(page)).toHaveCount(1, { timeout: 8_000 });
  const before = (await rxItemsOf(visitId))[0];

  await page.getByRole("button", { name: "Remove Qzredit Alpha 100" }).click();
  await expect(rxList(page)).toHaveCount(0);
  await expect.poll(async () => (await rxItemsOf(visitId)).length).toBe(0);
  await page.getByRole("status").getByRole("button", { name: "Undo" }).click();
  await expect(rxList(page)).toHaveCount(1, { timeout: 8_000 });
  // 09C-06a: Undo puts back the doctor's own line, not a suggestion: no "Repeated" marker.
  await expect(rxList(page).first()).not.toContainText("Repeated");
  const after = await rxItemsOf(visitId);
  expect(after).toHaveLength(1);
  expect(after[0]).toMatchObject({ medicine_name: before.medicine_name, dosage: before.dosage, duration: before.duration, timing: before.timing, cdci_brand_id: before.cdci_brand_id });
});

test("a lost response after the commit is retried with the same request id and stores one line", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "the retry timing is the desktop project's");
  const visitId = await openConsult(page, "RxLost");
  const marker = `Qzxlost ${testTag().replace(/\W/g, "")}`;
  const cut = await commitThenAbort(page, { first: 1, matches: (r) => (r.postData() ?? "").includes(marker) });
  await addCustomMedicine(page.locator("#prescription"), marker);
  await cut.clear();
  expect(cut.aborted).toBe(1);
  await expect.poll(async () => (await rxItemsOf(visitId)).map((i) => i.medicine_name)).toEqual([marker]);
});

test("09C-06a A-1: every attempt aborted after the commit: the lines are read again, the committed line is on the list, the builder closes, nothing is added twice", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "the retry timing is the desktop project's");
  const visitId = await openConsult(page, "RxAbort");
  const marker = `Qzxabort ${testTag().replace(/\W/g, "")}`;
  const rx = page.locator("#prescription");
  // Only the change command carries the marker; the read that reconciles the list passes through.
  const cut = await commitThenAbort(page, { first: "all", matches: (r) => (r.postData() ?? "").includes(marker) });
  await rxField(rx).fill(marker);
  await expect(rx.getByRole("option", { name: new RegExp(`^Add .${marker}.$`) })).toBeVisible({ timeout: 10_000 });
  for (const key of ["ArrowDown", "Enter", "1", "5", "d", "Enter"]) await rxField(rx).press(key);
  // The command committed on the server (its response was cut every time); the screen does not guess: it reads the lines and shows the committed one.
  await expect(rxList(page)).toHaveCount(1, { timeout: 40_000 });
  await expect(rxList(page).first()).toContainText(marker);
  await expect(rx.locator("[data-dose-builder]")).toHaveCount(0);
  expect(cut.aborted).toBeGreaterThanOrEqual(1);
  await cut.clear();
  // Escape and another change do not lose it, and nothing was stored twice.
  await rxField(rx).press("Escape");
  await expect(rxList(page)).toHaveCount(1);
  await expect.poll(async () => (await rxItemsOf(visitId)).map((i) => i.medicine_name)).toEqual([marker]);
});

test("09C-06a A-10: Enter on a search with no listed medicine creates nothing; the Add row is an explicit choice (arrow key or tap)", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "the keyboard is the desktop project's");
  const visitId = await openConsult(page, "RxNoMatch");
  const rx = page.locator("#prescription");
  const typed = `Qzxprefix${testTag().replace(/\W/g, "")}`;
  await rxField(rx).fill(typed);
  await expect(rx.getByRole("option", { name: new RegExp(`^Add .${typed}.$`) })).toBeVisible({ timeout: 10_000 });
  await rxField(rx).press("Enter");
  // No dose builder for a medicine nobody chose; the list says how to add it.
  await expect(rx.locator("[data-rx-custom-hint]")).toContainText(`No listed medicine matches “${typed}”`);
  await expect(rx.locator("[data-dose-builder]")).toHaveCount(0);
  for (const key of ["1", "5", "d", "Enter"]) await rxField(rx).press(key);
  await page.waitForTimeout(400);
  expect(await rxItemsOf(visitId)).toEqual([]);
  // The explicit choice: down to the Add row, then Enter.
  await rxField(rx).fill(typed);
  await expect(rx.getByRole("option", { name: new RegExp(`^Add .${typed}.$`) })).toBeVisible({ timeout: 10_000 });
  for (const key of ["ArrowDown", "Enter", "1", "5", "d", "Enter"]) await rxField(rx).press(key);
  await expect(rxList(page)).toHaveCount(1, { timeout: 10_000 });
  expect((await rxItemsOf(visitId)).map((i) => i.medicine_name)).toEqual([typed]);
});

test("09C-06a A-11: Finish waits for an Rx command still queued: a remove sent behind a slow add is on the signed prescription's side, not lost", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "the timing is the desktop project's");
  const visitId = await openConsult(page, "RxQueued");
  const rx = page.locator("#prescription");
  const first = `Qzxqueued One ${testTag().replace(/\W/g, "")}`;
  const slow = `Qzxqueued Slow ${testTag().replace(/\W/g, "")}`;
  await addCustomMedicine(rx, first);
  await page.getByLabel("History of Present Illness & Clinical Notes").fill("E2E synthetic note for the queued Rx case");
  // The add of the second medicine is held for 3 s on its way to the server; the remove of the first queues behind it in the hook.
  const hold = async (route: import("@playwright/test").Route, request: import("@playwright/test").Request) => {
    if (request.method() === "POST" && request.headers()["next-action"] !== undefined && (request.postData() ?? "").includes(slow)) {
      await new Promise((r) => setTimeout(r, 3_000));
    }
    await route.fallback();
  };
  await page.route("**/*", hold);
  await rxField(rx).fill(slow);
  await expect(rx.getByRole("option", { name: new RegExp(`^Add .${slow}.$`) })).toBeVisible({ timeout: 10_000 });
  for (const key of ["ArrowDown", "Enter", "1", "5", "d", "Enter"]) await rxField(rx).press(key);
  await page.getByRole("button", { name: `Remove ${first}` }).click();
  await page.getByRole("button", { name: /Finish visit/ }).first().click();
  const dialog = page.getByRole("dialog", { name: "Complete & Sign Consultation" });
  await dialog.getByRole("button", { name: /Sign & Route to Reception/ }).click();
  await expect(page.getByRole("heading", { name: "Consultation Finalized & Signed" })).toBeVisible({ timeout: 30_000 });
  await page.unroute("**/*", hold);
  // The signed Rx holds exactly what the doctor last saw: the slow medicine, not the removed one.
  await expect.poll(async () => (await rxItemsOf(visitId)).map((i) => i.medicine_name)).toEqual([slow]);
  // Let the success screen's PDF read finish before the test retires its doctor (09C-05 flake 1: a read cut by the retirement logs a missing archive object).
  await expect(page.locator('[data-share-pdf="loading"]')).toHaveCount(0, { timeout: 15_000 });
  await page.waitForLoadState("networkidle");
});

test("09C-06a A-12: an added and a removed line are announced in a polite live region", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "one project covers the announcement");
  await upsertCdciRows(RX_EDIT_ROWS);
  await openConsult(page, "RxAnnounce");
  const rx = page.locator("#prescription");
  const live = page.locator("[data-rx-announce]");
  await expect(live).toHaveAttribute("aria-live", "polite");
  await rxField(rx).fill("qzredit");
  await expect(rx.getByRole("option", { name: /Qzredit Alpha/ })).toBeVisible({ timeout: 8_000 });
  for (const key of ["Enter", "1", "5", "d", "Enter"]) await rxField(rx).press(key);
  await expect(live).toHaveText(/^Qzredit Alpha 100 added, 5 days\s*$/, { timeout: 10_000 });
  await page.getByRole("button", { name: "Remove Qzredit Alpha 100" }).click();
  await expect(live).toHaveText(/^Qzredit Alpha 100 removed\s*$/, { timeout: 10_000 });
});

test("a sealed consult shows the lines with no entry row, no pills and no remove control (the amending record accepts a line: m0/consult-rx-finish)", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "one project covers the record states");
  const visitId = await openConsult(page, "RxSealed");
  const rx = page.locator("#prescription");
  const name = `Qzxsealed ${testTag().replace(/\W/g, "")}`;
  await addCustomMedicine(rx, name);
  // Sign through the command as the doctor would (the sheet's own flow is covered by m0/consult-rx-finish).
  await page.getByLabel("History of Present Illness & Clinical Notes").fill("E2E synthetic note for the sealed Rx case");
  await page.getByRole("button", { name: /Finish visit/ }).first().click();
  const dialog = page.getByRole("dialog", { name: "Complete & Sign Consultation" });
  await dialog.getByRole("button", { name: /Sign & Route to Reception/ }).click();
  await expect(page.getByRole("heading", { name: "Consultation Finalized & Signed" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Review Encounter" }).click();
  await expect(page.getByTestId("signed-chip")).toBeVisible({ timeout: 30_000 });
  await expect(rx.getByText(name)).toBeVisible();
  await expect(rxField(rx)).toHaveCount(0);
  await expect(rx.getByRole("button")).toHaveCount(0);
  expect((await rxItemsOf(visitId)).map((i) => i.medicine_name)).toEqual([name]);
});

test("@golden at 360 px the entry row and the dose builder fit with no horizontal scroll, and a phone adds a line by tapping", async ({ page }, testInfo) => {
  test.skip(!["pixel-7", "iphone-15"].includes(testInfo.project.name), "the phone projects");
  await upsertCdciRows(RX_KEYBOARD_ROWS);
  await openConsult(page, "RxPhone");
  await page.setViewportSize({ width: 360, height: 780 });
  const rx = page.locator("#prescription");
  await rx.scrollIntoViewIfNeeded();
  await rxField(rx).fill("qzrkey alpha");
  await expect(rx.getByRole("option", { name: /Qzrkey Alpha/ })).toBeVisible({ timeout: 8_000 });
  const scrollWidth = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(await scrollWidth()).toBeLessThanOrEqual(0);
  await rx.getByRole("option", { name: /Qzrkey Alpha/ }).click();
  await expect(rx.locator("[data-dose-builder]")).toBeVisible();
  expect(await scrollWidth()).toBeLessThanOrEqual(0);
  const box = await rx.locator("[data-dose-builder]").boundingBox();
  expect(box && box.x >= 0 && box.x + box.width <= 360).toBe(true);
  // A phone adds a line by tapping: the 1-0-1 tile, the 5 days tile, Add to prescription.
  await rx.getByRole("radio", { name: /^1-0-1/ }).click();
  await rx.getByRole("radio", { name: "5 days" }).click();
  await rx.getByRole("button", { name: "Add to prescription" }).click();
  await expect(rxList(page)).toHaveCount(1, { timeout: 8_000 });
  expect(await scrollWidth()).toBeLessThanOrEqual(0);
});
