/**
 * M0 characterisation flow 4 — cancel an appointment (V2-02 plan 02-03b; FRONTEND_MIGRATION_PLAN M0).
 *
 * Outcome asserted: the booked visit becomes `cancelled`, leaves the calendar, and its slot is free again — a second
 * booking for the same doctor at the same time succeeds WITHOUT the overbook confirmation and is not flagged.
 * The browser runs in Asia/Kolkata (the calendar renders in browser-local time).
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
import { appointmentCard, chooseExistingPatient, openBookingDrawer, setSlot } from "./support/calendar";

test.use({ storageState: storageStatePath("receptionist"), timezoneId: "Asia/Kolkata" });

test("cancel a booked visit → cancelled, slot free again for a booking without override", async ({ page, ux }) => {
  ux.flow("cancel-appointment", "Front desk cancels a booked appointment from the calendar");
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

  await page.goto(`/calendar?date=${date}`);
  const card = appointmentCard(page, bookedName);
  await expect(card).toBeVisible();

  // v1 asks with a native confirm() dialog.
  page.once("dialog", (dialog) => {
    expect(dialog.type()).toBe("confirm");
    void dialog.accept();
  });
  await ux.click(card.getByRole("button", { name: "Cancel Appointment" }), "Cancel Appointment (+ confirm OK)");
  await expect(page.getByText(bookedName, { exact: true })).toHaveCount(0);
  ux.done();

  expect((await visitById(visitId))?.status).toBe("cancelled");

  // The slot is free again: a new booking at the same time needs no overbook confirmation.
  const nextName = `E2E Synthetic Rebooked ${tag}`;
  const next = await seedPatient(tenantA.id, tenantA.users.owner.id, nextName);
  const drawer = await openBookingDrawer(page, ux, date);
  await setSlot(drawer, ux, "10:00", doctorId);
  await chooseExistingPatient(drawer, ux, nextName);
  await ux.click(drawer.getByRole("button", { name: "Confirm Booking" }), "Confirm Booking");
  await expect(drawer).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Slot Already Booked" })).toHaveCount(0);
  await expect(appointmentCard(page, nextName)).toBeVisible();

  const rebooked = await visitsOf(tenantA.id, next.id);
  expect(rebooked).toHaveLength(1);
  expect(rebooked[0]).toMatchObject({ status: "booked", is_overbooked: false, doctor_id: doctorId });
  expect(new Date(rebooked[0].scheduled_at!).getTime()).toBe(new Date(istInstant(date, "10:00")).getTime());
});
