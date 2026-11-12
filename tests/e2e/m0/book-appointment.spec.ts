/**
 * M0 characterisation flow 3 — book an appointment, including the overbook path (V2-02 plan 02-03b; FMP M0).
 *
 * 1. Booking a free, on-duty slot (default availability Mon–Sat 10:00–13:00, 17:00–21:00) creates one `visits` row
 *    `booked` at that instant for that doctor, not overbooked, shown on the calendar for that day.
 * 2. Overbook path: booking a slot the doctor already has asks for confirmation ("Slot Already Booked"); confirming
 *    creates the booking flagged `is_overbooked`.
 * 3. Overbook path with a NEW patient: the correct outcome (one patient row for that person) is asserted under
 *    `test.fail()` — known v1 bug F-04 (the drawer calls `createPatient` again on confirm, creating a duplicate).
 *
 * The browser runs in Asia/Kolkata so the drawer's local date/time match the clinic's day (the calendar renders in
 * browser-local time).
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
import { appointmentCard, chooseExistingPatient, openBookingDrawer, setSlot } from "./support/calendar";

test.use({ storageState: storageStatePath("receptionist"), timezoneId: "Asia/Kolkata" });

test("book a free slot → booked visit at that time, visible on the calendar", async ({ page, ux }) => {
  ux.flow("book-appointment", "Front desk books an existing patient into a free slot from the calendar");
  const { tenantA } = run();
  const doctorId = tenantA.users.doctor.id;
  const patientName = `E2E Synthetic Booked ${testTag()}`;
  const patient = await seedPatient(tenantA.id, tenantA.users.owner.id, patientName);
  const date = await freeBookingDate(tenantA.id, doctorId);

  const drawer = await openBookingDrawer(page, ux, date);
  await setSlot(drawer, ux, "10:00", doctorId);
  await chooseExistingPatient(drawer, ux, patientName);
  await ux.click(drawer.getByRole("button", { name: "Confirm Booking" }), "Confirm Booking");

  // No overbook question for a free slot; the drawer closes and the appointment is on the calendar.
  await expect(drawer).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Slot Already Booked" })).toHaveCount(0);
  await expect(appointmentCard(page, patientName)).toBeVisible();
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

  const drawer = await openBookingDrawer(page, ux, date);
  await setSlot(drawer, ux, "11:00", doctorId);
  await chooseExistingPatient(drawer, ux, patientName);
  await ux.click(drawer.getByRole("button", { name: "Confirm Booking" }), "Confirm Booking");

  const confirm = page.getByRole("dialog", { name: "Slot Already Booked" });
  await expect(confirm).toBeVisible();
  // Nothing is booked until the conflict is confirmed.
  expect(await visitsOf(tenantA.id, patient.id)).toHaveLength(0);

  await ux.click(confirm.getByRole("button", { name: "Confirm Overbooking" }), "Confirm Overbooking");
  await expect(confirm).toHaveCount(0);
  await expect(appointmentCard(page, patientName)).toBeVisible();

  const visits = await visitsOf(tenantA.id, patient.id);
  expect(visits).toHaveLength(1);
  expect(visits[0]).toMatchObject({ status: "booked", doctor_id: doctorId, is_overbooked: true });
  expect(new Date(visits[0].scheduled_at!).getTime()).toBe(new Date(istInstant(date, "11:00")).getTime());
});

// The receptionist cannot create patients in v1 (F-01), so the owner exercises the new-patient path.
test.describe("owner", () => {
  test.use({ storageState: storageStatePath("owner") });

  test("overbook path with a new patient creates exactly one patient (known v1 bug F-04)", async ({ page, ux }) => {
    test.fail(true, "F-04: the overbook confirm re-runs createPatient, duplicating the new patient (P1, owner V2-08)");
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

    const drawer = await openBookingDrawer(page, ux, date);
    await setSlot(drawer, ux, "12:00", doctorId);
    await ux.click(drawer.getByRole("button", { name: "New Patient" }), "New Patient tab");
    await ux.fill(drawer.getByLabel(/^Full Name/), newName, "Full Name");
    await ux.fill(drawer.getByLabel(/^Mobile Phone/), phoneDigits, "Mobile Phone");
    await ux.click(drawer.getByRole("button", { name: "Confirm Booking" }), "Confirm Booking");

    const confirm = page.getByRole("dialog", { name: "Slot Already Booked" });
    await expect(confirm).toBeVisible();
    await ux.click(confirm.getByRole("button", { name: "Confirm Overbooking" }), "Confirm Overbooking");
    await expect(confirm).toHaveCount(0);
    await expect(appointmentCard(page, newName)).toBeVisible();

    // Correct outcome: one patient row for this person, booked once, flagged overbooked.
    const patients = await patientsByName(tenantA.id, newName);
    expect(patients.map((p) => p.phone)).toEqual([`+91${phoneDigits}`]);
    const visits = await visitsOf(tenantA.id, patients[0].id);
    expect(visits).toHaveLength(1);
    expect(visits[0].is_overbooked).toBe(true);
  });
});
