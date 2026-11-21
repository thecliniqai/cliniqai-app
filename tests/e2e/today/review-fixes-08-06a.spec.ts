/**
 * V2-08 08-06a review fixes with a UI side (08-REVIEW-TRIAGE.md): each case reproduces the reviewer's scenario and asserts the
 * outcome in the database as well as on the screen. Synthetic data only; tenant A is shared, so every row is found by its own name.
 *
 * - A-1 (nurse): the vitals sheet opens with the readings on record; recording one more reading keeps the earlier ones;
 * - A-4 (receptionist): a completed visit nobody has billed is in To bill and reads "Not billed";
 * - A-10 (receptionist): a late no-show is in Booked (not the collapsed Done column) and checking it in moves it to Waiting;
 * - A-6 (receptionist): a registration sheet that failed to save opens empty and without "Couldn't save" the next time;
 * - A-7 (receptionist): moving a 30-minute visit keeps it a 30-minute visit;
 * - A-8: "Block time" is shown to the owner and the doctor, not to the receptionist.
 */
import type { Page } from "@playwright/test";
import { getAdminClient } from "../../helpers/supabase-admin";
import { expect, test } from "../fixtures";
import { appToday, freeBookingDate, istInstant, run, seedPatient, testTag, visitById } from "../support/m0-data";
import { storageStatePath } from "../support/run-data";
import { appointmentOf, moveSheet, openSchedule, slotsLoaded } from "../support/schedule-page";
import { seedWaitingToday, todayName, visitStatusOf, vitalsOfVisit } from "../support/today-data";
import { filterToday, openToday, rowInLane, rowOf, showLane } from "../support/today-page";

async function seedToday(name: string, status: "completed" | "no_show", time?: string): Promise<{ visitId: string; patientId: string }> {
  const { tenantA } = run();
  const patient = await seedPatient(tenantA.id, tenantA.users.owner.id, name);
  const { data, error } = await getAdminClient()
    .from("visits")
    .insert({
      tenant_id: tenantA.id,
      patient_id: patient.id,
      doctor_id: tenantA.users.doctor.id,
      origin_type: time ? "scheduled" : "walk_in",
      status,
      scheduled_at: time ? istInstant(appToday(), time) : null,
      is_overbooked: true,
      estimated_duration_minutes: 15,
      created_by: tenantA.users.receptionist.id,
      ...(status === "completed" ? { signed_at: new Date().toISOString(), signed_by: tenantA.users.doctor.id } : {}),
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`review-fixes seed failed: ${error?.message}`);
  return { visitId: data.id, patientId: patient.id };
}

test.describe("nurse", () => {
  test.use({ storageState: storageStatePath("nurse") });

  test("A-1: the vitals sheet opens with the recorded readings; a second reading keeps the first (BP, then pulse: both stored)", async ({ page }) => {
    const { visitId, name } = await seedWaitingToday(todayName("VitalsMerge"));
    await openToday(page);
    await filterToday(page, name);
    await showLane(page, "Waiting");
    const open = async () => {
      await rowOf(page, name).getByRole("button", { name: `Record vitals for ${name}` }).click();
      const sheet = page.getByRole("dialog", { name: "Record vitals" });
      await expect(sheet).toBeVisible();
      return sheet;
    };

    const first = await open();
    await expect(first.locator('[data-vital="systolic"]')).toHaveValue("");
    await first.locator('[data-vital="systolic"]').fill("124");
    await first.locator('[data-vital="diastolic"]').fill("82");
    await first.getByRole("button", { name: "Save vitals" }).click();
    await expect(first).toHaveCount(0);
    await expect.poll(() => vitalsOfVisit(visitId), { timeout: 20_000 }).toMatchObject({ systolic: 124, diastolic: 82 });
    await expect(rowOf(page, name)).toContainText("BP 124/82", { timeout: 20_000 });

    // Reopened: the form carries what is on record, and the new reading is added to it.
    const second = await open();
    await expect(second.locator('[data-vital="systolic"]')).toHaveValue("124");
    await expect(second.locator('[data-vital="diastolic"]')).toHaveValue("82");
    await expect(second.locator('[data-vital="pulse"]')).toHaveValue("");
    await second.locator('[data-vital="pulse"]').fill("76");
    await second.getByRole("button", { name: "Save vitals" }).click();
    await expect(second).toHaveCount(0);
    await expect.poll(() => vitalsOfVisit(visitId), { timeout: 20_000 }).toMatchObject({ systolic: 124, diastolic: 82, pulse: 76 });
  });
});

test.describe("receptionist", () => {
  test.use({ storageState: storageStatePath("receptionist") });

  test("A-4: a signed visit nobody has billed is in To bill as Not billed, with a Bill action", async ({ page }) => {
    const name = todayName("Unbilled");
    await seedToday(name, "completed");
    await openToday(page);
    await filterToday(page, name);
    await showLane(page, "Bill");
    const row = rowInLane(page, "to_bill", name);
    await expect(row).toBeVisible();
    await expect(row).toContainText("Not billed");
    await expect(row.getByRole("button", { name: `Open bill of ${name}` })).toBeVisible();
    // It is not hidden in the collapsed Done column.
    await showLane(page, "Done");
    await expect(rowInLane(page, "done", name)).toHaveCount(0);
  });

  test("A-10: a late no-show is in Booked, and checking it in moves it to Waiting", async ({ page }) => {
    const name = todayName("LateArrival");
    const { visitId } = await seedToday(name, "no_show", "00:05");
    await openToday(page);
    await filterToday(page, name);
    await showLane(page, "Booked");
    const row = rowInLane(page, "booked", name);
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: `Check in ${name}` }).click();
    await showLane(page, "Waiting");
    await expect(rowInLane(page, "waiting", name)).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => visitStatusOf(visitId), { timeout: 20_000 }).toBe("waiting");
  });

  test("A-6: a registration that failed to save leaves no 'Couldn't save' behind: the next open is an empty form", async ({ page }) => {
    await page.goto("/patients");
    await page.locator("main").waitFor();
    const link = page.getByRole("link", { name: /Register Patient/ }).first();
    await link.click();
    const sheet = page.getByRole("dialog", { name: "Register patient" });
    await expect(sheet).toBeVisible();
    // Every server action fails to reach the server: the save ends in "Couldn't save".
    await page.route("**/*", (route) => (route.request().method() === "POST" && route.request().headers()["next-action"] ? route.abort("failed") : route.continue()));
    await sheet.getByRole("textbox", { name: "Mobile number" }).fill("9000000611");
    await sheet.getByRole("textbox", { name: "Full name" }).fill(`E2E Synthetic Unsaved ${testTag()}`);
    await sheet.getByRole("textbox", { name: "Age" }).fill("40");
    await sheet.getByRole("radio", { name: "Female" }).click();
    await sheet.getByRole("button", { name: "Register patient" }).click();
    await expect(sheet.getByText(/Couldn.t save/)).toBeVisible({ timeout: 30_000 });
    await page.unroute("**/*");

    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await link.click();
    const again = page.getByRole("dialog", { name: "Register patient" });
    await expect(again).toBeVisible();
    await expect(again.getByText(/Couldn.t save/)).toHaveCount(0);
    await expect(again.getByRole("textbox", { name: "Full name" })).toHaveValue("");
    await expect(again.getByRole("textbox", { name: "Mobile number" })).toHaveValue("");
  });

  test("A-7: moving a 30-minute appointment keeps it 30 minutes long", async ({ page }) => {
    const { tenantA } = run();
    const date = await freeBookingDate(tenantA.id, tenantA.users.doctor.id);
    const name = `E2E Synthetic Move30 ${testTag()}`;
    const patient = await seedPatient(tenantA.id, tenantA.users.owner.id, name);
    const { data, error } = await getAdminClient()
      .from("visits")
      .insert({
        tenant_id: tenantA.id,
        patient_id: patient.id,
        doctor_id: tenantA.users.doctor.id,
        origin_type: "scheduled",
        status: "booked",
        scheduled_at: istInstant(date, "10:00"),
        estimated_duration_minutes: 30,
        created_by: tenantA.users.owner.id,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`seed failed: ${error?.message}`);

    await openSchedule(page, date);
    await appointmentOf(page, name).getByRole("button", { name: `More actions for ${name}` }).click();
    await page.getByRole("menuitem", { name: "Move appointment" }).click();
    const sheet = moveSheet(page);
    await expect(sheet).toBeVisible();
    const doctor = sheet.getByRole("combobox", { name: "Doctor" });
    if (await doctor.isVisible()) await doctor.selectOption(tenantA.users.doctor.id);
    await slotsLoaded(sheet);
    await sheet.getByRole("radio", { name: "11:00 am", exact: true }).click();
    await sheet.getByRole("button", { name: "Move appointment" }).click();
    await expect(sheet).toHaveCount(0);
    await expect(appointmentOf(page, name)).toContainText("11:00 am");

    const moved = await visitById(data.id);
    expect(new Date(moved!.scheduled_at!).toISOString()).toBe(istInstant(date, "11:00"));
    const { data: row } = await getAdminClient().from("visits").select("estimated_duration_minutes").eq("id", data.id).single();
    expect(row?.estimated_duration_minutes).toBe(30);
  });

  test("A-8: the receptionist is not offered Block time", async ({ page }) => {
    await openSchedule(page);
    await expect(page.getByRole("button", { name: "Waitlist", exact: false }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Block time" })).toHaveCount(0);
  });
});

async function blockTimeButton(page: Page) {
  await openSchedule(page);
  return page.getByRole("button", { name: "Block time" });
}

test.describe("owner", () => {
  test.use({ storageState: storageStatePath("owner") });

  test("A-8: the owner blocks any doctor or the whole clinic: Block time is offered with the doctor choice", async ({ page }) => {
    const button = await blockTimeButton(page);
    await expect(button).toBeVisible();
    await button.click();
    const dialog = page.getByRole("dialog", { name: "Block time" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Entire clinic (all doctors)")).toBeAttached();
  });
});

test.describe("doctor", () => {
  test.use({ storageState: storageStatePath("doctor") });

  test("A-8: a doctor blocks their own time only: the button is offered and the dialog has no doctor or clinic-wide choice", async ({ page }) => {
    const button = await blockTimeButton(page);
    await expect(button).toBeVisible();
    await button.click();
    const dialog = page.getByRole("dialog", { name: "Block time" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Entire clinic (all doctors)")).toHaveCount(0);
  });
});
