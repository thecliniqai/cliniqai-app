/**
 * M0 characterisation flow 3 — book an appointment, including the overbook path (V2-02 plan 02-03b; FMP M0), on the
 * Schedule's booking sheet (V2-08 08-04b: the v1 calendar and its booking drawer are gone; the outcomes asserted are the same).
 *
 * 1. Booking a free, on-duty slot (default availability Mon–Sat 10:00–13:00, 17:00–21:00) creates one `visits` row
 *    `booked` at that instant for that doctor, not overbooked, shown on the Schedule for that day.
 * 2. Overbook path: booking a slot the doctor already has asks for confirmation ("Slot Already Booked"); confirming
 *    creates the booking flagged `is_overbooked`.
 * 3. Overbook path with a NEW patient: one patient row for that person, however many attempts the booking took. This was
 *    known v1 bug F-04 (the drawer called `createPatient` again on confirm, creating a duplicate); since V2-07 07-03 the
 *    patient is registered by the same command as the booking (`register_and_book`), so a refused slot registers nobody.
 *
 * The sheet's times are the clinic's (IST) whatever zone the browser runs in; this file runs in Asia/Kolkata,
 * `shell/clinic-zone-hydration.spec.ts` in other zones. `ux` records the interaction counts of flow 1 and 2.
 */
import { expect, test } from "../fixtures";
import {
  freeBookingDate,
  istInstant,
  patientsByName,
  run,
  seedPatient,
  seedVisit,
  syntheticPhoneDigits,
  testTag,
  visitsOf,
} from "../support/m0-data";
import { storageStatePath } from "../support/run-data";
import { appointmentOf, chooseExistingPatient, conflictDialog, openBookingSheet, setSlot } from "../support/schedule-page";

test.use({ storageState: storageStatePath("receptionist"), timezoneId: "Asia/Kolkata" });

test("book a free slot → booked visit at that time, visible on the Schedule", async ({ page, ux }) => {
  ux.flow("book-appointment", "Front desk books an existing patient into a free slot from the Schedule");
  const { tenantA } = run();
  const doctorId = tenantA.users.doctor.id;
  const patientName = `E2E Synthetic Booked ${testTag()}`;
  const patient = await seedPatient(tenantA.id, tenantA.users.owner.id, patientName);
  const date = await freeBookingDate(tenantA.id, doctorId);

  const sheet = await openBookingSheet(page, ux, date);
  await chooseExistingPatient(sheet, ux, patientName);
  await setSlot(sheet, ux, "10:00", doctorId);
  await ux.click(sheet.getByRole("button", { name: "Book", exact: true }), "Book");

  // No overbook question for a free slot; the sheet closes and the appointment is on the Schedule.
  await expect(sheet).toHaveCount(0);
  await expect(conflictDialog(page, "Slot Already Booked")).toHaveCount(0);
  await expect(appointmentOf(page, patientName)).toBeVisible();
  ux.done();

  const visits = await visitsOf(tenantA.id, patient.id);
  expect(visits).toHaveLength(1);
  expect(visits[0]).toMatchObject({ status: "booked", origin_type: "scheduled", doctor_id: doctorId, is_overbooked: false });
  expect(new Date(visits[0].scheduled_at!).getTime()).toBe(new Date(istInstant(date, "10:00")).getTime());
});

test("overbook path: a taken slot asks for confirmation; confirming books it flagged overbooked", async ({ page, ux }) => {
  const { tenantA } = run();
  const doctorId = tenantA.users.doctor.id;
  const tag = testTag();
  const date = await freeBookingDate(tenantA.id, doctorId);

  // The slot is already taken by another patient.
  const other = await seedPatient(tenantA.id, tenantA.users.owner.id, `E2E Synthetic Slot Holder ${tag}`);
  await seedVisit({
    tenantId: tenantA.id,
    patientId: other.id,
    doctorId,
    createdBy: tenantA.users.owner.id,
    status: "booked",
    originType: "scheduled",
    scheduledAt: istInstant(date, "11:00"),
  });
  const patientName = `E2E Synthetic Overbooked ${tag}`;
  const patient = await seedPatient(tenantA.id, tenantA.users.owner.id, patientName);

  const sheet = await openBookingSheet(page, ux, date);
  await chooseExistingPatient(sheet, ux, patientName);
  await setSlot(sheet, ux, "11:00", doctorId);
  await ux.click(sheet.getByRole("button", { name: "Book", exact: true }), "Book");

  const confirm = conflictDialog(page, "Slot Already Booked");
  await expect(confirm).toBeVisible();
  // Nothing is booked until the conflict is confirmed.
  expect(await visitsOf(tenantA.id, patient.id)).toHaveLength(0);

  await ux.click(confirm.getByRole("button", { name: "Confirm overbooking" }), "Confirm overbooking");
  await expect(confirm).toHaveCount(0);
  await expect(appointmentOf(page, patientName)).toBeVisible();

  const visits = await visitsOf(tenantA.id, patient.id);
  expect(visits).toHaveLength(1);
  expect(visits[0]).toMatchObject({ status: "booked", doctor_id: doctorId, is_overbooked: true });
  expect(new Date(visits[0].scheduled_at!).getTime()).toBe(new Date(istInstant(date, "11:00")).getTime());
});

// The receptionist cannot create patients in v1 (F-01), so the owner exercises the new-patient path.
test.describe("owner", () => {
  test.use({ storageState: storageStatePath("owner") });

  test("overbook path with a new patient creates exactly one patient (F-04 fixed by register_and_book, V2-07)", async ({ page, ux }) => {
    const { tenantA } = run();
    const doctorId = tenantA.users.doctor.id;
    const tag = testTag();
    const date = await freeBookingDate(tenantA.id, doctorId);

    const other = await seedPatient(tenantA.id, tenantA.users.owner.id, `E2E Synthetic Slot Holder ${tag}`);
    await seedVisit({
      tenantId: tenantA.id,
      patientId: other.id,
      doctorId,
      createdBy: tenantA.users.owner.id,
      status: "booked",
      originType: "scheduled",
      scheduledAt: istInstant(date, "12:00"),
    });
    const newName = `E2E Synthetic New Overbook ${tag}`;
    const phoneDigits = syntheticPhoneDigits();

    const sheet = await openBookingSheet(page, ux, date);
    // New patient inside the booking: type the name, "Register as new patient", the slot, the mobile number, age and sex.
    await ux.fill(sheet.getByRole("combobox", { name: "Patient" }), newName, "Patient search");
    await ux.click(sheet.getByRole("option", { name: /Register as new patient/ }), "Register as new patient");
    await setSlot(sheet, ux, "12:00", doctorId);
    await ux.fill(sheet.getByRole("textbox", { name: "Mobile number" }), phoneDigits, "Mobile number");
    await ux.fill(sheet.getByRole("textbox", { name: "Age" }), "41", "Age");
    await ux.click(sheet.getByRole("radio", { name: "Male", exact: true }), "Sex");
    await ux.click(sheet.getByRole("button", { name: "Register and book" }), "Register and book");

    const confirm = conflictDialog(page, "Slot Already Booked");
    await expect(confirm).toBeVisible();
    await ux.click(confirm.getByRole("button", { name: "Confirm overbooking" }), "Confirm overbooking");
    await expect(confirm).toHaveCount(0);
    await expect(appointmentOf(page, newName)).toBeVisible();

    // One patient row for this person, booked once, flagged overbooked.
    const patients = await patientsByName(tenantA.id, newName);
    expect(patients.map((p) => p.phone), "exactly one patient row for the new patient").toEqual([`+91${phoneDigits}`]);
    const visits = await visitsOf(tenantA.id, patients[0].id);
    expect(visits, "the patient is booked once").toHaveLength(1);
    expect(visits[0].is_overbooked, "the booking is flagged overbooked").toBe(true);
  });
});
