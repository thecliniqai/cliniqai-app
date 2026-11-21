/**
 * The Schedule and the booking, move, cancel, no-show and confirm UIs (V2-08 08-04b, P1-31, R-15; the full journeys are in
 * `journeys/`, the booking and cancel outcomes in `m0/`). Each case seeds its own synthetic visits and asserts the outcome in the
 * database, not only on the screen.
 *
 * - move (reschedule): ⋯, Move appointment, a slot (the visit's own slot is listed again), Move: the visit is `booked` at the new
 *   instant, one visit, and its `ux` count is recorded; a slot taken by someone else asks "Slot Already Booked" and moves nothing
 *   until confirmed;
 * - cancel with a waitlist: the cancelled visit's slot goes to the waiting entry and the screen says so;
 * - no-show: only for an appointment whose time has passed; confirm: one action;
 * - the day, agenda and week views show the same visit; the week view counts booked and free;
 * - the Schedule has no horizontal scroll and passes axe (0 serious or critical) at the project's width;
 * - the patient's own reschedule page names times in the clinic's zone whatever zone the browser is in.
 */
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { getAdminClient } from "../../helpers/supabase-admin";
import { expect, test } from "../fixtures";
import { freeBookingDate, istInstant, run, seedPatient, seedVisit, testTag, visitById, visitsOf } from "../support/m0-data";
import { storageStatePath } from "../support/run-data";
import { appointmentOf, bookingSheet, conflictDialog, moveSheet, openSchedule, setSlot, slotsLoaded } from "../support/schedule-page";
import { settleAnimations } from "../support/settle";
import { seedBookedToday } from "../support/today-data";
import { openToday, rowOf, filterToday } from "../support/today-page";

test.use({ storageState: storageStatePath("receptionist") });

const TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];

/** A booked, scheduled visit of the run's doctor for a new synthetic patient at clinic `time` on `date`. */
async function seedBooked(date: string, time: string, label: string): Promise<{ visitId: string; patientId: string; name: string }> {
  const { tenantA } = run();
  const name = `E2E Synthetic ${label} ${testTag()}`;
  const patient = await seedPatient(tenantA.id, tenantA.users.owner.id, name);
  const visitId = await seedVisit({
    tenantId: tenantA.id,
    patientId: patient.id,
    doctorId: tenantA.users.doctor.id,
    createdBy: tenantA.users.owner.id,
    status: "booked",
    originType: "scheduled",
    scheduledAt: istInstant(date, time),
  });
  return { visitId, patientId: patient.id, name };
}

async function openMenuItem(page: Page, name: string, item: string, ux?: import("../support/ux-counter").UxCounter): Promise<void> {
  const trigger = appointmentOf(page, name).getByRole("button", { name: `More actions for ${name}` });
  if (ux) await ux.click(trigger, "More actions");
  else await trigger.click();
  const entry = page.getByRole("menuitem", { name: item });
  if (ux) await ux.click(entry, item);
  else await entry.click();
}

test("@golden move an appointment: its own slot is listed, the visit is booked at the new time", async ({ page, ux }) => {
  ux.flow("reschedule-appointment", "Front desk moves a booked appointment to another slot from the Schedule");
  const { tenantA } = run();
  const date = await freeBookingDate(tenantA.id, tenantA.users.doctor.id);
  const { visitId, name } = await seedBooked(date, "10:00", "Move");

  await openSchedule(page, date);
  await openMenuItem(page, name, "Move appointment", ux);
  const sheet = moveSheet(page);
  await expect(sheet).toBeVisible();
  await expect(sheet.locator("[data-reschedule-patient]")).toContainText(name);
  await expect(sheet.locator("[data-reschedule-patient]")).toContainText("10:00 am");
  const doctor = sheet.getByRole("combobox", { name: "Doctor" });
  if (await doctor.isVisible()) await doctor.selectOption(tenantA.users.doctor.id);
  await slotsLoaded(sheet);
  // The visit's own slot is free again in a move.
  await expect(sheet.getByRole("radio", { name: "10:00 am", exact: true })).toBeVisible();
  await ux.click(sheet.getByRole("radio", { name: "11:00 am", exact: true }), "slot 11:00 am");
  await ux.click(sheet.getByRole("button", { name: "Move appointment" }), "Move appointment");
  await expect(sheet).toHaveCount(0);
  await expect(appointmentOf(page, name)).toContainText("11:00 am");
  ux.done();

  const moved = await visitById(visitId);
  expect(moved).toMatchObject({ status: "booked", is_overbooked: false });
  expect(new Date(moved!.scheduled_at!).toISOString()).toBe(istInstant(date, "11:00"));
});

test("moving into a slot someone else holds asks first and moves nothing until confirmed", async ({ page }) => {
  const { tenantA } = run();
  const date = await freeBookingDate(tenantA.id, tenantA.users.doctor.id);
  const mover = await seedBooked(date, "10:00", "Mover");
  await seedBooked(date, "10:30", "Holder");

  await openSchedule(page, date);
  await openMenuItem(page, mover.name, "Move appointment");
  const sheet = moveSheet(page);
  await expect(sheet).toBeVisible();
  const doctor = sheet.getByRole("combobox", { name: "Doctor" });
  if (await doctor.isVisible()) await doctor.selectOption(tenantA.users.doctor.id);
  await slotsLoaded(sheet);
  await sheet.getByRole("button", { name: "Pick another time" }).click();
  await sheet.getByLabel("Other time").fill("10:30");
  await sheet.getByRole("button", { name: "Move appointment" }).click();

  const question = conflictDialog(page, "Slot Already Booked");
  await expect(question).toBeVisible();
  expect(new Date((await visitById(mover.visitId))!.scheduled_at!).toISOString(), "nothing moved before the confirmation").toBe(istInstant(date, "10:00"));
  await question.getByRole("button", { name: "Confirm overbooking" }).click();
  await expect(sheet).toHaveCount(0);
  const moved = await visitById(mover.visitId);
  expect(new Date(moved!.scheduled_at!).toISOString()).toBe(istInstant(date, "10:30"));
  expect(moved!.is_overbooked).toBe(true);
});

test("cancel with a waitlist: the slot goes to the waiting patient and the screen says so", async ({ page, ux }) => {
  ux.flow("cancel-with-waitlist", "Front desk cancels an appointment; the waitlisted patient takes the slot");
  const { tenantA } = run();
  const date = await freeBookingDate(tenantA.id, tenantA.users.doctor.id);
  const cancelled = await seedBooked(date, "10:00", "Cancel");
  const waiting = `E2E Synthetic Waiting ${testTag()}`;
  const waitingPatient = await seedPatient(tenantA.id, tenantA.users.owner.id, waiting);
  const { error } = await getAdminClient().from("waitlist_entries").insert({
    tenant_id: tenantA.id,
    patient_id: waitingPatient.id,
    doctor_id: tenantA.users.doctor.id,
    target_date: date,
    status: "waiting",
    priority: 0,
    created_by: tenantA.users.owner.id,
  });
  expect(error).toBeNull();

  await openSchedule(page, date);
  await openMenuItem(page, cancelled.name, "Cancel appointment", ux);
  const dialog = page.getByRole("alertdialog", { name: "Cancel this appointment?" });
  await expect(dialog).toBeVisible();
  await ux.click(dialog.getByRole("button", { name: "Cancel appointment" }), "Cancel appointment (confirm)");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(/A waitlisted patient was booked into the vacated slot/)).toBeVisible();
  await expect(appointmentOf(page, waiting)).toBeVisible();
  await expect(appointmentOf(page, cancelled.name)).toHaveCount(0);
  ux.done();

  expect((await visitById(cancelled.visitId))?.status).toBe("cancelled");
  const promoted = await visitsOf(tenantA.id, waitingPatient.id);
  expect(promoted).toHaveLength(1);
  expect(promoted[0]).toMatchObject({ status: "booked", doctor_id: tenantA.users.doctor.id });
  expect(new Date(promoted[0].scheduled_at!).toISOString()).toBe(istInstant(date, "10:00"));
});

test("a no-show is marked only once the appointment time has passed", async ({ page }) => {
  const { tenantA } = run();

  // A future appointment has no Mark as no-show item.
  const futureDate = await freeBookingDate(tenantA.id, tenantA.users.doctor.id);
  const future = await seedBooked(futureDate, "10:00", "Future");
  await openSchedule(page, futureDate);
  await appointmentOf(page, future.name).getByRole("button", { name: `More actions for ${future.name}` }).click();
  await expect(page.getByRole("menuitem", { name: "Move appointment" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Mark as no-show" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // An appointment three hours ago.
  const at = new Date(Math.floor((Date.now() - 3 * 3_600_000) / 900_000) * 900_000);
  const name = `E2E Synthetic NoShow ${testTag()}`;
  const patient = await seedPatient(tenantA.id, tenantA.users.owner.id, name);
  const visitId = await seedVisit({
    tenantId: tenantA.id,
    patientId: patient.id,
    doctorId: tenantA.users.doctor.id,
    createdBy: tenantA.users.owner.id,
    status: "booked",
    originType: "scheduled",
    scheduledAt: at.toISOString(),
  });
  // The visit's clinic date (a few hours after midnight IST it is still yesterday's date).
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(at);

  await openSchedule(page, day);
  await openMenuItem(page, name, "Mark as no-show");
  const dialog = page.getByRole("alertdialog", { name: "Mark as no-show?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Mark as no-show" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(appointmentOf(page, name).locator('[data-status-chip="no_show"]')).toBeVisible();
  expect((await visitById(visitId))?.status).toBe("no_show");
});

test("confirm is one action", async ({ page, ux }) => {
  ux.flow("confirm-appointment", "Front desk confirms a booked appointment from the Schedule");
  const { tenantA } = run();
  const date = await freeBookingDate(tenantA.id, tenantA.users.doctor.id);
  const { visitId, name } = await seedBooked(date, "10:30", "Confirm");
  await openSchedule(page, date);
  await ux.click(appointmentOf(page, name).getByRole("button", { name: `Confirm ${name}` }), "Confirm");
  await expect(appointmentOf(page, name).locator('[data-status-chip="confirmed"]')).toBeVisible();
  ux.done();
  expect((await visitById(visitId))?.status).toBe("confirmed");
});

test("the Today row's menu opens the move sheet on Today", async ({ page }) => {
  const { name } = await seedBookedToday();
  await openToday(page);
  await filterToday(page, name);
  const row = rowOf(page, name);
  await row.getByRole("button", { name: `More actions for ${name}` }).click();
  await page.getByRole("menuitem", { name: "Move appointment" }).click();
  const sheet = moveSheet(page);
  await expect(sheet).toBeVisible();
  await expect(sheet.locator("[data-reschedule-patient]")).toContainText(name);
  await expect(page).toHaveURL(/reschedule=/);
});

test("day, agenda and week show the booked visit; the week counts it", async ({ page }) => {
  const { tenantA } = run();
  const date = await freeBookingDate(tenantA.id, tenantA.users.doctor.id);
  const { name } = await seedBooked(date, "10:15", "Views");
  const doctorId = tenantA.users.doctor.id;

  await openSchedule(page, date, `view=agenda&doctor=${doctorId}`);
  await expect(appointmentOf(page, name)).toBeVisible();
  await expect(page.locator("[data-agenda]")).toBeVisible();

  await openSchedule(page, date, `view=day&doctor=${doctorId}`);
  await expect(page.locator("[data-day-grid]")).toBeVisible();
  await expect(appointmentOf(page, name)).toBeVisible();
  // Free slots are links that open the booking sheet with the doctor, day and time filled in.
  await page.locator("[data-free-slot]").first().click();
  await expect(page.getByRole("dialog", { name: "Book appointment" })).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();

  await openSchedule(page, date, `view=week&doctor=${doctorId}`);
  const day = page.locator(`[data-week-day="${date}"]`);
  await expect(day).toContainText("1 booked");
  await expect(day).toContainText("free");
  await day.getByRole("link", { name: /^Open/ }).click();
  await expect(page.locator("[data-schedule]")).toHaveAttribute("data-schedule-view", "day");
});

test("@golden the Schedule has no horizontal scroll and passes axe at this width, with a sheet open too", async ({ page }) => {
  const { tenantA } = run();
  const date = await freeBookingDate(tenantA.id, tenantA.users.doctor.id);
  const { name } = await seedBooked(date, "10:00", "Axe");
  await openSchedule(page, date);
  await expect(appointmentOf(page, name)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), "page scrolls sideways").toBe(false);
  await settleAnimations(page);
  const base = await new AxeBuilder({ page }).include("[data-schedule]").withTags(TAGS).analyze();
  expect(base.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);

  // Every view of the Schedule is axe-clean at this width, not only the one the width picks.
  for (const view of ["day", "agenda", "week"]) {
    await openSchedule(page, date, `view=${view}&doctor=${tenantA.users.doctor.id}`);
    await expect(page.locator("[data-schedule]")).toHaveAttribute("data-schedule-view", view);
    await settleAnimations(page);
    const result = await new AxeBuilder({ page }).include("[data-schedule]").withTags(TAGS).analyze();
    expect(result.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${view}: ${v.id}`)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), `${view} scrolls sideways`).toBe(false);
  }

  await openSchedule(page, date);
  await openMenuItem(page, name, "Move appointment");
  const sheet = moveSheet(page);
  await slotsLoaded(sheet);
  await settleAnimations(page);
  const moving = await new AxeBuilder({ page }).include("[data-reschedule-sheet-root]").withTags(TAGS).analyze();
  expect(moving.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
  await sheet.getByRole("button", { name: "Close" }).click();

  await openMenuItem(page, name, "Cancel appointment");
  const dialog = page.getByRole("alertdialog", { name: "Cancel this appointment?" });
  await expect(dialog).toBeVisible();
  await settleAnimations(page);
  const cancelling = await new AxeBuilder({ page }).include("[data-cancel-dialog]").withTags(TAGS).analyze();
  expect(cancelling.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
});

test.describe("the patient's own reschedule page, in the clinic's zone", () => {
  test.use({ storageState: { cookies: [], origins: [] }, timezoneId: "America/New_York" });

  test("names the appointment in clinic time (10:00 am IST), not the browser's zone", async ({ page }) => {
    const { tenantA } = run();
    const date = await freeBookingDate(tenantA.id, tenantA.users.doctor.id);
    const { visitId } = await seedBooked(date, "10:00", "Link");
    const { data: token, error } = await getAdminClient().rpc("create_reschedule_token", { p_visit_id: visitId });
    expect(error).toBeNull();
    await page.goto(`/reschedule/${token}`);
    await expect(page.getByText(/10:00 am/i).first()).toBeVisible();
    // Whole times only: the page opens on tomorrow's slots, and "1:30 am" without a boundary matched the 11:30 am slot whenever tomorrow is a working day
    // (CI 44924479177 follow-up: the spec had only run on a Saturday, when tomorrow is the clinic's closed Sunday).
    await expect(page.getByText(/\b(?:12:30 am|11:30 pm|1:30 am)\b/i)).toHaveCount(0);
  });
});

test.describe("booking from a link keeps its context", () => {
  test("?book=1&doctor&date&time opens the sheet on that day with that slot chosen", async ({ page, ux }) => {
    const { tenantA } = run();
    const doctorId = tenantA.users.doctor.id;
    const date = await freeBookingDate(tenantA.id, doctorId);
    await openSchedule(page, undefined, `book=1&doctor=${doctorId}&date=${date}&time=10:15`);
    const sheet = page.getByRole("dialog", { name: "Book appointment" });
    await expect(sheet).toBeVisible();
    // No patient yet: the find stage; picking one then shows the slot from the link already chosen.
    const name = `E2E Synthetic Context ${testTag()}`;
    await seedPatient(tenantA.id, tenantA.users.owner.id, name);
    await ux.fill(sheet.getByRole("combobox", { name: "Patient" }), name, "Patient search");
    await expect(sheet.getByRole("option", { name: new RegExp(name) })).toBeVisible();
    await ux.press(sheet.getByRole("combobox", { name: "Patient" }), "Enter", "Enter");
    await slotsLoaded(sheet);
    await expect(sheet.getByRole("radio", { name: "10:15 am", exact: true })).toBeChecked();
    await setSlot(sheet, ux, "10:15", doctorId);
    await sheet.getByRole("button", { name: "Book", exact: true }).click();
    await expect(sheet).toHaveCount(0);
    await expect(appointmentOf(page, name)).toContainText("10:15 am");
  });
});

test("the patient record's Book Slot opens the booking sheet on that patient", async ({ page }) => {
  const { tenantA } = run();
  const name = `E2E Synthetic Profile ${testTag()}`;
  const patient = await seedPatient(tenantA.id, tenantA.users.owner.id, name);
  await page.goto(`/patients/${patient.id}`);
  await page.getByRole("link", { name: /Book Slot|Schedule Visit/ }).first().click();
  const sheet = page.getByRole("dialog", { name: "Book appointment" });
  await expect(sheet).toBeVisible();
  await expect(sheet.locator("[data-booking-patient]")).toContainText(name);
  await slotsLoaded(sheet);
  // Closing the sheet leaves the Schedule on its own address, not the booking parameters.
  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(page).not.toHaveURL(/book=1|patient=/);
});

test("the B shortcut opens the booking sheet (shortcuts switched on for this device)", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("clinicos.pref.shortcuts", "on"));
  await openSchedule(page);
  await page.keyboard.press("b");
  await expect(page.getByRole("dialog", { name: "Book appointment" })).toBeVisible();
  await expect(page).toHaveURL(/book=1/);
});

test("Smart Assist: the suggested times follow the patient's usual time of day and the first one is chosen", async ({ page }) => {
  const { tenantA } = run();
  const doctorId = tenantA.users.doctor.id;
  const date = await freeBookingDate(tenantA.id, doctorId);
  const name = `E2E Synthetic Assist ${testTag()}`;
  const patient = await seedPatient(tenantA.id, tenantA.users.owner.id, name);
  // Three attended visits in the evening (18:00 clinic time) on earlier days: the patient's usual time of day.
  // (Overbooked on purpose: the seed never collides with another spec's slot under the no-double-booking constraint.)
  for (const daysAgo of [3, 4, 5]) {
    const day = new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
    const { error } = await getAdminClient()
      .from("visits")
      .insert({
        tenant_id: tenantA.id,
        patient_id: patient.id,
        doctor_id: doctorId,
        origin_type: "scheduled",
        status: "completed",
        scheduled_at: istInstant(day, "18:00"),
        is_overbooked: true,
        estimated_duration_minutes: 15,
        created_by: tenantA.users.owner.id,
      });
    expect(error).toBeNull();
  }
  await openSchedule(page, date, `doctor=${doctorId}&book=1&patient=${patient.id}`);
  const sheet = bookingSheet(page);
  await expect(sheet).toBeVisible();
  await expect(sheet.locator("[data-booking-patient]")).toContainText(name);
  await slotsLoaded(sheet);
  const assist = sheet.locator("[data-smart-assist-slots]");
  await expect(assist).toBeVisible();
  await expect(assist).toContainText("Smart Assist");
  await expect(assist).toContainText("Suggested times");
  const chips = assist.getByRole("radio");
  await expect(chips).toHaveCount(3);
  // Evening first: every suggestion is 5 pm or later, and the first is the chosen time.
  for (const chip of await chips.all()) await expect(chip).toHaveAccessibleName(/^Suggested [5-9]:\d\d pm$/);
  await expect(chips.first()).toBeChecked();
  // The ordinary slot list holds the same time, chosen too.
  const first = (await chips.first().getAttribute("aria-label"))!.replace("Suggested ", "");
  await expect(sheet.getByRole("radio", { name: first, exact: true })).toBeChecked();
});

test("keyboard only: B, the name, Enter, Enter books the earliest free slot", async ({ page, ux }) => {
  ux.flow("book-keyboard", "Front desk books an existing patient with the keyboard only (B, name, Enter, Enter)");
  const { tenantA } = run();
  const doctorId = tenantA.users.doctor.id;
  const date = await freeBookingDate(tenantA.id, doctorId);
  const name = `E2E Synthetic Keys ${testTag()}`;
  const patient = await seedPatient(tenantA.id, tenantA.users.owner.id, name);
  await page.addInitScript(() => localStorage.setItem("clinicos.pref.shortcuts", "on"));
  // The doctor the sheet opens on is the link's; the day is the Schedule's.
  await openSchedule(page, date, `doctor=${doctorId}`);
  await ux.press(page.locator("body"), "b", "B (open the booking sheet)");
  const sheet = page.getByRole("dialog", { name: "Book appointment" });
  await expect(sheet).toBeVisible();
  const search = sheet.getByRole("combobox", { name: "Patient" });
  await ux.fill(search, name, "Patient name");
  await expect(sheet.getByRole("option", { name: new RegExp(name) })).toBeVisible();
  await ux.press(search, "Enter", "Enter (pick the patient)");
  // The earliest free slot is chosen and "Book" has the focus.
  await expect(sheet.getByRole("radio", { name: "10:00 am", exact: true })).toBeChecked();
  const book = sheet.getByRole("button", { name: "Book", exact: true });
  await expect(book).toBeFocused();
  await ux.press(book, "Enter", "Enter (Book)");
  await expect(sheet).toHaveCount(0);
  await expect(appointmentOf(page, name)).toContainText("10:00 am");
  ux.done();

  const visits = await visitsOf(tenantA.id, patient.id);
  expect(visits).toHaveLength(1);
  expect(new Date(visits[0].scheduled_at!).toISOString()).toBe(istInstant(date, "10:00"));
});
