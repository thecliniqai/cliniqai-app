/**
 * CI 43712054628 (V2-06): a screen that shows clinic times renders the same text on the server and in the browser,
 * whatever zone each runs in (ADR-016, P1-21: the clinic's zone, never the process's or the browser's).
 *
 * The calendar placed a visit with `Date#getHours()` and the patient record formatted dates without `timeZone`. With
 * the server in one zone and the browser in another (CI: a UTC server and the m0 specs' Asia/Kolkata browser;
 * production: a UTC server and Indian browsers) the two renders differed, React threw the server HTML away (error
 * #418) and rendered again, and a click in that window was lost: the m0 overbook and cancel specs failed on slow
 * runners. The booking drawer likewise turned the picked date and time into an instant in the browser's zone, while the
 * timeline and the server read them in the clinic's. V2-08 08-04b: the calendar is the Schedule and the drawer the booking
 * sheet; times come from the database in the clinic's zone through the slot adapter. The browser runs in America/New_York,
 * a zone neither the local server (IST) nor CI's (UTC) uses, and in UTC (the zone of a server-side render), so each case
 * fails without its fix. desktop-chrome only (checked once).
 */
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { freeBookingDate, istInstant, run, seedPatient, seedVisit, testTag, visitsOf } from "../support/m0-data";
import { storageStatePath } from "../support/run-data";
import { appointmentOf, chooseExistingPatient, openBookingSheet, openSchedule, setSlot } from "../support/schedule-page";

test.use({ storageState: storageStatePath("owner") });
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "zone-dependent rendering; checked once on desktop Chromium");
});

/** Uncaught page errors; React reports a hydration mismatch (#418) through `reportError`, which lands here. */
function pageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message.slice(0, 200)));
  return errors;
}

for (const zone of ["America/New_York", "UTC"]) {
  test.describe(`browser in ${zone}`, () => {
    test.use({ timezoneId: zone });

    test("the Schedule places a visit at its clinic time (11:00 IST) and hydrates without a mismatch", async ({ page }) => {
      const { tenantA } = run();
      const doctorId = tenantA.users.doctor.id;
      const name = `E2E Synthetic Zone ${testTag()}`;
      const patient = await seedPatient(tenantA.id, tenantA.users.owner.id, name);
      const date = await freeBookingDate(tenantA.id, doctorId);
      await seedVisit({
        tenantId: tenantA.id,
        patientId: patient.id,
        doctorId,
        createdBy: tenantA.users.owner.id,
        status: "booked",
        originType: "scheduled",
        scheduledAt: istInstant(date, "11:00"),
      });

      const errors = pageErrors(page);
      await openSchedule(page, date);
      await expect(appointmentOf(page, name)).toContainText("11:00 am – 11:15 am");
      await page.waitForLoadState("networkidle");
      expect(errors, "page errors on the Schedule (React #418 is a hydration mismatch)").toEqual([]);
    });

    test("a patient's record hydrates without a mismatch", async ({ page }) => {
      const errors = pageErrors(page);
      await page.goto(`/patients/${run().tenantA.patientId}`);
      await expect(page.getByRole("main").getByText(/^Registered: /)).toBeVisible();
      await page.waitForLoadState("networkidle");
      expect(errors, "page errors on the patient record (React #418 is a hydration mismatch)").toEqual([]);
    });

    test("booking 10:00 from a browser in another zone books 10:00 clinic time", async ({ page, ux }) => {
      const { tenantA } = run();
      const doctorId = tenantA.users.doctor.id;
      const name = `E2E Synthetic Zone Booked ${testTag()}`;
      const patient = await seedPatient(tenantA.id, tenantA.users.owner.id, name);
      const date = await freeBookingDate(tenantA.id, doctorId);

      const sheet = await openBookingSheet(page, ux, date);
      await chooseExistingPatient(sheet, ux, name);
      await setSlot(sheet, ux, "10:00", doctorId);
      // The sheet shows the clinic's times: 10:00 am is the slot, whatever zone the browser is in.
      await expect(sheet.getByRole("radio", { name: "10:00 am", exact: true })).toBeChecked();
      await ux.click(sheet.getByRole("button", { name: "Book", exact: true }), "Book");
      await expect(sheet).toHaveCount(0);
      await expect(appointmentOf(page, name)).toContainText("10:00 am – 10:15 am");

      const visits = await visitsOf(tenantA.id, patient.id);
      expect(visits).toHaveLength(1);
      expect(new Date(visits[0].scheduled_at!).toISOString(), "10:00 in the clinic's zone (IST)").toBe(istInstant(date, "10:00"));
    });
  });
}
