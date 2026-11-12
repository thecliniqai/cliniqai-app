/**
 * Calendar helpers shared by the M0 booking and cancellation flows (V2-02 plan 02-03b). Locators are role/label based
 * on the v1 calendar (`components/calendar/*`); the flows assert outcomes in the database.
 */
import type { Locator, Page } from "@playwright/test";
import { expect } from "../../fixtures";
import type { UxCounter } from "../../support/ux-counter";

export function bookingDrawer(page: Page): Locator {
  return page.getByRole("dialog", { name: "Schedule Appointment" });
}

/** Opens the calendar on `date` (setup: reaching a day is not counted) and the booking drawer. */
export async function openBookingDrawer(page: Page, ux: UxCounter, date: string): Promise<Locator> {
  await page.goto(`/calendar?date=${date}`);
  await expect(page.getByRole("heading", { name: "Doctor Timeline & Calendar" })).toBeVisible();
  await ux.click(page.getByRole("button", { name: "+ Book Appointment" }), "+ Book Appointment");
  const drawer = bookingDrawer(page);
  await expect(drawer).toBeVisible();
  await expect(drawer.getByLabel(/^Appointment Date/)).toHaveValue(date);
  return drawer;
}

/** Sets the time and doctor in an open booking drawer. */
export async function setSlot(drawer: Locator, ux: UxCounter, time: string, doctorId: string): Promise<void> {
  await ux.fill(drawer.getByLabel(/^Start Time/), time, "Start Time");
  await ux.select(drawer.getByLabel(/^Doctor Assigned/), doctorId, "Doctor Assigned");
}

/** Picks an existing patient by name in the open booking drawer. */
export async function chooseExistingPatient(drawer: Locator, ux: UxCounter, patientName: string): Promise<void> {
  await ux.fill(drawer.getByLabel("Search by Name or Phone"), patientName, "Search by Name or Phone");
  await ux.click(drawer.getByRole("button", { name: new RegExp(patientName) }), "patient search result");
  await expect(drawer.getByText("Selected Patient")).toBeVisible();
}

/** The timeline card of a (non-cancelled) appointment, found by the patient's name. */
export function appointmentCard(page: Page, patientName: string): Locator {
  return page
    .getByText(patientName, { exact: true })
    .locator("xpath=ancestor::div[.//button[@aria-label='Cancel Appointment']][1]");
}
