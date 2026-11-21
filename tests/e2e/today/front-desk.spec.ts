/**
 * Today's modes and the walk-in sheet (V2-08 08-03b, P1-29, R-1, R-6, R-7, R-13, R-14).
 *
 * - nurse (triage mode): Record vitals from the row stores the vitals the consult reads and the row shows them;
 * - doctor (My queue): a booked patient's "Start consultation" checks them in and starts the consult in one command
 *   (one token, `in_consultation`); the pinned Next card carries "Call in" for the first patient waiting; a doctor sees only
 *   their own queue; the owner toggles Front desk and My queue;
 * - receptionist: no consult action anywhere on the board (the database refuses a direct call too: `start-consultation-rpc.spec.ts`);
 * - keyboard: W opens the walk-in sheet, the mobile number, Enter, Enter queues the patient (three key presses besides the typing);
 *   `?` lists the shortcuts and the switch turns W and N off for the device;
 * - a new patient is registered inside the walk-in sheet in one command;
 * - axe at 360, 820 and 1280 on the walk-in sheet and on each mode.
 * Synthetic data only; tenant A is shared, so every row is found by its own unique name.
 */
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { appToday, patientsByName, run, seedPatient, syntheticPhoneDigits, testTag, tokenOf, visitsOf } from "../support/m0-data";
import { storageStatePath } from "../support/run-data";
import { settleAnimations } from "../support/settle";
import { seedBookedToday, seedWaitingToday, todayName, tokensOfVisit, visitStatusOf, vitalsOfVisit } from "../support/today-data";
import { filterToday, openToday, rowInLane, rowOf, showLane } from "../support/today-page";

const TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const BLOCKING = new Set(["serious", "critical"]);
const blockingRules = async (page: Page, include?: string) => {
  const builder = new AxeBuilder({ page }).withTags(TAGS);
  const results = await (include ? builder.include(include) : builder).analyze();
  return results.violations.filter((v) => BLOCKING.has(v.impact ?? "")).map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target.join(" ")) }));
};

test.describe("nurse: triage mode", () => {
  test.use({ storageState: storageStatePath("nurse") });

  test("Record vitals from the row stores the vitals and the row shows them", async ({ page }) => {
    const { visitId, name } = await seedWaitingToday(todayName("Triage"));
    await openToday(page);
    await filterToday(page, name);
    await showLane(page, "Waiting");
    const row = rowOf(page, name);
    await expect(row).toBeVisible();
    await expect(row.getByRole("button", { name: `Check in ${name}` })).toHaveCount(0);
    await row.getByRole("button", { name: `Record vitals for ${name}` }).click();

    const sheet = page.getByRole("dialog", { name: "Record vitals" });
    await expect(sheet).toBeVisible();
    await sheet.locator('[data-vital="systolic"]').fill("124");
    await sheet.locator('[data-vital="diastolic"]').fill("82");
    await sheet.locator('[data-vital="pulse"]').fill("76");
    await sheet.getByRole("button", { name: "Save vitals" }).click();
    await expect(sheet).toHaveCount(0);

    await expect.poll(() => vitalsOfVisit(visitId), { timeout: 20_000 }).toMatchObject({ systolic: 124, diastolic: 82, pulse: 76 });
    await expect(rowOf(page, name)).toContainText("BP 124/82", { timeout: 20_000 });
  });

  test("a nurse is offered no consult action", async ({ page }) => {
    const { name } = await seedWaitingToday(todayName("NurseNoConsult"));
    await openToday(page);
    await filterToday(page, name);
    await expect(rowOf(page, name)).toBeVisible();
    await expect(page.getByRole("button", { name: /^(Call in|Start consultation|Open consult)/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /^Open consult/ })).toHaveCount(0);
  });
});

test.describe("doctor: My queue", () => {
  test.use({ storageState: storageStatePath("doctor") });

  test("Start consultation on a booked patient checks them in and opens the consult: one token, in consultation (R-1)", async ({ page }) => {
    const { visitId, name } = await seedBookedToday(todayName("StartBooked"), "10:00");
    await openToday(page);
    await filterToday(page, name);
    await showLane(page, "Booked");
    await expect(rowInLane(page, "booked", name)).toBeVisible();
    await page.getByRole("button", { name: `Start consultation ${name}` }).click();
    await expect(page).toHaveURL(new RegExp(`/consultation/${visitId}$`), { timeout: 20_000 });
    expect(await visitStatusOf(visitId)).toBe("in_consultation");
    expect(await tokensOfVisit(visitId)).toHaveLength(1);
  });

  test("the Next card carries Call in for the first waiting patient; a doctor sees only their own queue", async ({ page }) => {
    const { tenantA } = run();
    const mine = await seedWaitingToday(todayName("Mine"));
    const theirs = await seedWaitingToday(todayName("OwnersPatient"), undefined, tenantA.users.owner.id);
    await openToday(page);
    await expect(page.getByRole("heading", { name: "Waiting (mine)" })).toBeVisible();
    await filterToday(page, mine.name);
    await expect(rowOf(page, mine.name)).toBeVisible();
    await filterToday(page, theirs.name);
    await expect(page.getByText(/No one in today's list matches/)).toBeVisible();
    await filterToday(page, "");
    // Nothing in the doctor's board is the owner's patient, and the first waiting patient is on the Next card.
    await expect(rowOf(page, theirs.name)).toHaveCount(0);
    const next = page.locator("[data-next-patient]");
    await expect(next).toBeVisible();
    await expect(next.getByRole("button", { name: /^Call in / })).toBeVisible();
    await expect(next).toContainText("Next");
  });

  test("Call in on a waiting patient starts the consultation without a second check-in", async ({ page }) => {
    const { visitId, name } = await seedWaitingToday(todayName("CallIn"));
    await openToday(page);
    await filterToday(page, name);
    await page.getByRole("button", { name: `Call in ${name}` }).click();
    await expect(page).toHaveURL(new RegExp(`/consultation/${visitId}$`), { timeout: 20_000 });
    expect(await visitStatusOf(visitId)).toBe("in_consultation");
    expect(await tokensOfVisit(visitId)).toHaveLength(1);
  });
});

test.describe("owner: the mode toggle", () => {
  test.use({ storageState: storageStatePath("owner") });

  test("front desk shows everyone; My queue only the owner's own patients", async ({ page }) => {
    const { tenantA } = run();
    const theirs = await seedWaitingToday(todayName("DoctorPatient"));
    const mine = await seedWaitingToday(todayName("OwnerOwn"), undefined, tenantA.users.owner.id);
    await openToday(page);
    await filterToday(page, theirs.name);
    await expect(rowOf(page, theirs.name)).toBeVisible();
    await expect(page.getByRole("radiogroup", { name: "Today mode" })).toBeVisible();
    await page.getByRole("radio", { name: "My queue" }).click();
    await expect(page).toHaveURL(/mode=doctor/);
    await page.locator("[data-today-board]").waitFor();
    await filterToday(page, mine.name);
    await expect(rowOf(page, mine.name)).toBeVisible();
    await filterToday(page, theirs.name);
    await expect(rowOf(page, theirs.name)).toHaveCount(0);
  });
});

test.describe("receptionist", () => {
  test.use({ storageState: storageStatePath("receptionist") });

  test("no consult action on any row, whatever its state", async ({ page }) => {
    const waiting = await seedWaitingToday(todayName("DeskWaiting"));
    const booked = await seedBookedToday(todayName("DeskBooked"), "11:00");
    await openToday(page);
    for (const name of [waiting.name, booked.name]) {
      await filterToday(page, name);
      await showLane(page, name === waiting.name ? "Waiting" : "Booked");
      await expect(rowOf(page, name)).toBeVisible();
    }
    await filterToday(page, "");
    await expect(page.getByRole("button", { name: /^(Call in|Start consultation|Open consult|Record vitals)/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /^Open consult/ })).toHaveCount(0);
  });

  test("a new patient is registered inside the walk-in sheet: one patient, one waiting visit, one token", async ({ page }) => {
    const { tenantA } = run();
    const name = `E2E Synthetic Newcomer ${testTag()}`;
    await openToday(page, "/today?walkin=1");
    const sheet = page.getByRole("dialog", { name: "Add walk-in" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText("Loading doctors…")).toHaveCount(0);
    await sheet.getByRole("combobox", { name: "Patient" }).fill(name);
    await sheet.getByRole("option", { name: /Register as new patient/ }).click();
    await sheet.getByRole("textbox", { name: "Mobile number" }).fill(syntheticPhoneDigits());
    await expect(sheet.getByRole("textbox", { name: "Full name" })).toHaveValue(name);
    await sheet.getByRole("textbox", { name: "Age" }).fill("29");
    await sheet.getByRole("radio", { name: "Female" }).click();
    await sheet.getByRole("button", { name: "Register and add to queue" }).click();
    await expect(page.getByRole("dialog", { name: "Add walk-in" })).toHaveCount(0, { timeout: 20_000 });

    const patients = await patientsByName(tenantA.id, name);
    expect(patients).toHaveLength(1);
    const visits = await visitsOf(tenantA.id, patients[0].id);
    expect(visits).toHaveLength(1);
    expect(visits[0]).toMatchObject({ origin_type: "walk_in", status: "waiting" });
    expect((await tokenOf(visits[0].id))?.date).toBe(appToday());
  });
});

test.describe("keyboard", () => {
  test.use({ storageState: storageStatePath("receptionist") });
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome", "single-key shortcuts are on for a fine pointer at 1024 px and up");
  });

  test("W, the mobile number, Enter, Enter: a keyboard-only walk-in (three key presses besides the typing)", async ({ page, ux }) => {
    ux.flow("walk-in-keyboard", "Receptionist adds an existing patient as a walk-in from the keyboard");
    const { tenantA } = run();
    const name = `E2E Synthetic Keyboard ${testTag()}`;
    const patient = await seedPatient(tenantA.id, tenantA.users.owner.id, name);
    await openToday(page);
    await page.locator("body").click({ position: { x: 5, y: 5 } });

    await ux.press(page.locator("body"), "w", "W");
    const sheet = page.getByRole("dialog", { name: "Add walk-in" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText("Loading doctors…")).toHaveCount(0);
    await expect(sheet.getByRole("combobox", { name: "Patient" })).toBeFocused();
    await ux.fill(sheet.getByRole("combobox", { name: "Patient" }), patient.phone.slice(-10), "Mobile number");
    await expect(sheet.getByRole("option", { name: new RegExp(name) })).toBeVisible();
    await ux.press(sheet.getByRole("combobox", { name: "Patient" }), "Enter", "Enter (pick the patient)");
    await expect(sheet.getByRole("button", { name: "Add to queue" })).toBeFocused();
    await ux.press(page.locator(":focus"), "Enter", "Enter (Add to queue)");
    await expect(page.getByRole("dialog", { name: "Add walk-in" })).toHaveCount(0);
    ux.done();

    expect(ux.counts()?.presses, "W, Enter, Enter").toBe(3);
    const visits = await visitsOf(tenantA.id, patient.id);
    expect(visits).toHaveLength(1);
    expect(visits[0]).toMatchObject({ origin_type: "walk_in", status: "waiting" });
  });

  test("? lists the shortcuts; the switch turns W off for the device and the choice is stored", async ({ page }) => {
    await openToday(page);
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("?");
    const list = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await expect(list).toBeVisible();
    await expect(list.getByText("Add a walk-in")).toBeVisible();
    const toggle = list.getByRole("switch", { name: /single-key shortcuts/ });
    await expect(toggle).toBeChecked();
    await toggle.click();
    expect(await page.evaluate(() => localStorage.getItem("clinicos.pref.shortcuts"))).toBe("off");
    await page.keyboard.press("Escape");
    await expect(list).toHaveCount(0);

    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("w");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(new URL(page.url()).searchParams.get("walkin")).toBeNull();

    // Restore the device default for the specs that follow.
    await page.evaluate(() => localStorage.removeItem("clinicos.pref.shortcuts"));
  });
});

test.describe("axe: the walk-in sheet and each mode", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome", "a11y specs own their viewport");
  });

  for (const width of [360, 820, 1280]) {
    test.describe(`at ${width}`, () => {
      test.describe("receptionist", () => {
        test.use({ storageState: storageStatePath("receptionist") });

        test("the walk-in sheet, find and confirm stages, and the front desk mode", async ({ page }) => {
          const { tenantA } = run();
          const name = `E2E Synthetic AxeWalkIn ${testTag()}`;
          await seedPatient(tenantA.id, tenantA.users.owner.id, name);
          await page.setViewportSize({ width, height: 900 });
          await openToday(page);
          expect(await blockingRules(page), "front desk mode").toEqual([]);

          await openToday(page, "/today?walkin=1");
          const sheet = page.getByRole("dialog", { name: "Add walk-in" });
          await expect(sheet).toBeVisible();
          await expect(sheet.getByText("Loading doctors…")).toHaveCount(0);
          await settleAnimations(page);
          expect(await blockingRules(page, "[data-walkin-sheet-root]"), "find stage").toEqual([]);

          await sheet.getByRole("combobox", { name: "Patient" }).fill(name);
          await sheet.getByRole("option", { name: new RegExp(name) }).click();
          await expect(sheet.locator("[data-walkin-patient]")).toBeVisible();
          await settleAnimations(page);
          expect(await blockingRules(page, "[data-walkin-sheet-root]"), "confirm stage").toEqual([]);
        });
      });

      test.describe("nurse", () => {
        test.use({ storageState: storageStatePath("nurse") });
        test("triage mode and the vitals sheet", async ({ page }) => {
          const { name } = await seedWaitingToday(todayName("AxeTriage"));
          await page.setViewportSize({ width, height: 900 });
          await openToday(page);
          await expect(page.locator("[data-queue-row]:visible").first()).toBeVisible();
          expect(await blockingRules(page), "triage mode").toEqual([]);
          await filterToday(page, name);
          await rowOf(page, name).getByRole("button", { name: `Record vitals for ${name}` }).click();
          await expect(page.getByRole("dialog", { name: "Record vitals" })).toBeVisible();
          await settleAnimations(page);
          expect(await blockingRules(page, "[data-vitals-sheet]"), "vitals sheet").toEqual([]);
        });
      });

      test.describe("doctor", () => {
        test.use({ storageState: storageStatePath("doctor") });
        test("My queue with the Next card", async ({ page }) => {
          await seedWaitingToday(todayName("AxeDoctor"));
          await page.setViewportSize({ width, height: 900 });
          await openToday(page);
          await expect(page.locator("[data-next-patient]")).toBeVisible();
          expect(await blockingRules(page), "doctor mode").toEqual([]);
        });
      });
    });
  }
});
