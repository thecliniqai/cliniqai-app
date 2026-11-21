/**
 * TEST_STRATEGY journey 4 — book an appointment; a conflicting slot is refused; the patient appears on the Schedule
 * (V2-08 08-04b, R-15, R-19, P1-31, P1-42).
 *
 * As the receptionist: on the Schedule, "Book appointment" opens the booking sheet; an existing patient is found by name, a free slot
 * is chosen from the doctor's day and Book creates the visit (`booked`, at that instant, not overbooked); the patient is on the
 * Schedule. A second patient for the same slot is refused: the "Slot Already Booked" question opens, "Choose another time" leaves
 * nothing written (no visit, no overbooking). The sheet is axe-clean (0 serious or critical) at the project's width (phone, tablet
 * and desktop projects run the same journey); the interaction counts of the booking are written by the `ux` counter
 * (`test-results/m0/counts/journey-04-book-appointment.json`, desktop-chrome) for the evidence. Synthetic data only.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "../fixtures";
import { freeBookingDate, istInstant, run, seedPatient, testTag, visitsOf } from "../support/m0-data";
import { storageStatePath } from "../support/run-data";
import { appointmentOf, chooseExistingPatient, conflictDialog, openBookingSheet, setSlot, slotsLoaded } from "../support/schedule-page";
import { settleAnimations } from "../support/settle";

test.use({ storageState: storageStatePath("receptionist") });

const TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];

async function sheetIsAxeClean(page: import("@playwright/test").Page): Promise<void> {
  await settleAnimations(page);
  const axe = await new AxeBuilder({ page }).include("[data-booking-sheet-root]").withTags(TAGS).analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
}

test("@golden journey 4: book into a free slot, the patient is on the Schedule; the same slot for another patient is refused", async ({ page, ux }) => {
  ux.flow("journey-04-book-appointment", "Receptionist books an existing patient into a free slot from the Schedule");
  const { tenantA } = run();
  const doctorId = tenantA.users.doctor.id;
  const tag = testTag();
  const first = await seedPatient(tenantA.id, tenantA.users.owner.id, `E2E Synthetic Journey4 ${tag}`);
  const second = await seedPatient(tenantA.id, tenantA.users.owner.id, `E2E Synthetic Journey4b ${tag}`);
  const firstName = `E2E Synthetic Journey4 ${tag}`;
  const secondName = `E2E Synthetic Journey4b ${tag}`;
  const date = await freeBookingDate(tenantA.id, doctorId);

  // 1. Book: open the sheet, find the patient, choose the slot, Book.
  const sheet = await openBookingSheet(page, ux, date);
  await sheetIsAxeClean(page); // the find stage
  await chooseExistingPatient(sheet, ux, firstName);
  await setSlot(sheet, ux, "10:00", doctorId);
  await sheetIsAxeClean(page); // the plan stage, with the slots
  await ux.click(sheet.getByRole("button", { name: "Book", exact: true }), "Book");
  await expect(sheet).toHaveCount(0);
  await expect(appointmentOf(page, firstName)).toBeVisible();
  ux.done();

  const visits = await visitsOf(tenantA.id, first.id);
  expect(visits).toHaveLength(1);
  expect(visits[0]).toMatchObject({ status: "booked", origin_type: "scheduled", doctor_id: doctorId, is_overbooked: false });
  expect(new Date(visits[0].scheduled_at!).toISOString()).toBe(istInstant(date, "10:00"));

  // 2. The same slot for another patient is refused: the question opens, "Choose another time" writes nothing.
  const again = await openBookingSheet(page, ux, date);
  await chooseExistingPatient(again, ux, secondName);
  await setSlot(again, ux, "10:00", doctorId);
  await again.getByRole("button", { name: "Book", exact: true }).click();
  const refused = conflictDialog(page, "Slot Already Booked");
  await expect(refused).toBeVisible();
  await refused.getByRole("button", { name: "Choose another time" }).click();
  await expect(refused).toHaveCount(0);
  await expect(again).toBeVisible();
  expect(await visitsOf(tenantA.id, second.id), "a refused slot writes nothing").toHaveLength(0);

  // 3. Another free slot books without a question.
  await slotsLoaded(again);
  await again.getByRole("radio", { name: "10:15 am", exact: true }).click();
  await again.getByRole("button", { name: "Book", exact: true }).click();
  await expect(again).toHaveCount(0);
  await expect(appointmentOf(page, secondName)).toBeVisible();
  const booked = await visitsOf(tenantA.id, second.id);
  expect(booked).toHaveLength(1);
  expect(booked[0]).toMatchObject({ status: "booked", is_overbooked: false });
});
