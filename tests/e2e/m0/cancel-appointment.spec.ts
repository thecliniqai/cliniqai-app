/**
 * M0 characterisation flow 4 — cancel an appointment (V2-02 plan 02-03b; FRONTEND_MIGRATION_PLAN M0).
 *
 * Outcome asserted: the booked visit becomes `cancelled`, leaves the Schedule, and its slot is free again — a second
 * booking for the same doctor at the same time succeeds WITHOUT the overbook confirmation and is not flagged.
 * Since V2-08 08-04b the cancel is the Schedule's ⋯ menu and its dialog (reason, "Tell the patient"), one command
 * (`cancel_visit`); the outcome assertions are unchanged.
 */
import { expect, test } from "../fixtures";
import {
  freeBookingDate,
  istInstant,
  run,
  seedPatient,
  seedVisit,
  testTag,
  visitById,
  visitsOf,
} from "../support/m0-data";
import { storageStatePath } from "../support/run-data";
import { appointmentOf, chooseExistingPatient, conflictDialog, openBookingSheet, openSchedule, setSlot } from "../support/schedule-page";

test.use({ storageState: storageStatePath("receptionist"), timezoneId: "Asia/Kolkata" });

test("cancel a booked visit → cancelled, slot free again for a booking without override", async ({ page, ux }) => {
  ux.flow("cancel-appointment", "Front desk cancels a booked appointment from the Schedule");
  const { tenantA } = run();
  const doctorId = tenantA.users.doctor.id;
  const tag = testTag();
  const date = await freeBookingDate(tenantA.id, doctorId);
  const bookedName = `E2E Synthetic Cancelled ${tag}`;
  const booked = await seedPatient(tenantA.id, tenantA.users.owner.id, bookedName);
  const visitId = await seedVisit({
    tenantId: tenantA.id,
    patientId: booked.id,
    doctorId,
    createdBy: tenantA.users.owner.id,
    status: "booked",
    originType: "scheduled",
    scheduledAt: istInstant(date, "10:00"),
  });

  await openSchedule(page, date);
  const card = appointmentOf(page, bookedName);
  await expect(card).toBeVisible();

  await ux.click(card.getByRole("button", { name: `More actions for ${bookedName}` }), "More actions");
  await ux.click(page.getByRole("menuitem", { name: "Cancel appointment" }), "Cancel appointment");
  const dialog = page.getByRole("alertdialog", { name: "Cancel this appointment?" });
  await expect(dialog).toBeVisible();
  await ux.click(dialog.getByRole("button", { name: "Cancel appointment" }), "Cancel appointment (confirm)");
  await expect(dialog).toHaveCount(0);
  await expect(appointmentOf(page, bookedName)).toHaveCount(0);
  ux.done();

  expect((await visitById(visitId))?.status).toBe("cancelled");

  // The slot is free again: a new booking at the same time needs no overbook confirmation.
  const nextName = `E2E Synthetic Rebooked ${tag}`;
  const next = await seedPatient(tenantA.id, tenantA.users.owner.id, nextName);
  const sheet = await openBookingSheet(page, ux, date);
  await chooseExistingPatient(sheet, ux, nextName);
  await setSlot(sheet, ux, "10:00", doctorId);
  await ux.click(sheet.getByRole("button", { name: "Book", exact: true }), "Book");
  await expect(sheet).toHaveCount(0);
  await expect(conflictDialog(page, "Slot Already Booked")).toHaveCount(0);
  await expect(appointmentOf(page, nextName)).toBeVisible();

  const rebooked = await visitsOf(tenantA.id, next.id);
  expect(rebooked).toHaveLength(1);
  expect(rebooked[0]).toMatchObject({ status: "booked", is_overbooked: false, doctor_id: doctorId });
  expect(new Date(rebooked[0].scheduled_at!).getTime()).toBe(new Date(istInstant(date, "10:00")).getTime());
});
