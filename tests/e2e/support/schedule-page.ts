/**
 * Page helpers for the Schedule and the booking, reschedule, cancel and no-show UIs (V2-08 08-04b): appointments are found by
 * the synthetic patient's name (`[data-appointment]`, in the day grid and in the agenda alike), and a click before React has
 * hydrated the screen is ignored, so `openSchedule` waits for it.
 */
import type { Locator, Page } from "@playwright/test";
import { expect } from "../fixtures";
import type { UxCounter } from "./ux-counter";

/** Waits until React has hydrated the Schedule (its nodes carry a `__reactFiber$` key). */
export async function scheduleHydrated(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const el = document.querySelector("[data-schedule]");
    return Boolean(el && Object.keys(el).some((key) => key.startsWith("__reactFiber$")));
  });
}

/** Opens the Schedule on `date` (setup: reaching a day is not counted) and waits for it to be on screen and hydrated. */
export async function openSchedule(page: Page, date?: string, query = ""): Promise<void> {
  const params = new URLSearchParams(query);
  if (date) params.set("date", date);
  const q = params.toString();
  await page.goto(q ? `/schedule?${q}` : "/schedule");
  await page.locator("[data-schedule]").waitFor();
  await scheduleHydrated(page);
}

/** The appointment of the patient named `name` (a card in the day grid or the agenda). */
export function appointmentOf(page: Page, name: string): Locator {
  return page.locator("[data-appointment]").filter({ hasText: name });
}

export function bookingSheet(page: Page): Locator {
  return page.getByRole("dialog", { name: "Book appointment" });
}

export function moveSheet(page: Page): Locator {
  return page.getByRole("dialog", { name: "Move appointment" });
}

/** Opens the booking sheet from the Schedule's "Book appointment" link (counted) and waits for its slots. */
export async function openBookingSheet(page: Page, ux: UxCounter, date: string): Promise<Locator> {
  await openSchedule(page, date);
  await ux.click(page.getByRole("link", { name: "Book appointment" }), "Book appointment");
  const sheet = bookingSheet(page);
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText("Loading doctors…")).toHaveCount(0);
  return sheet;
}

/** Finds the patient by name in the open booking sheet and picks them (type, Enter). */
export async function chooseExistingPatient(sheet: Locator, ux: UxCounter, patientName: string): Promise<void> {
  const search = sheet.getByRole("combobox", { name: "Patient" });
  await ux.fill(search, patientName, "Patient search");
  await expect(sheet.getByRole("option", { name: new RegExp(patientName) })).toBeVisible();
  await ux.press(search, "Enter", "Enter (pick the patient)");
  await expect(sheet.locator("[data-booking-patient]")).toContainText(patientName);
}

/** Waits for the sheet's free-slot list to load. */
export async function slotsLoaded(sheet: Locator): Promise<void> {
  await expect(sheet.getByText("Loading free slots…")).toHaveCount(0);
  await expect(sheet.locator("[data-slot-section]")).toBeVisible();
}

const label12 = (time: string): string => {
  const [h, m] = time.split(":").map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
};

/**
 * Chooses the doctor and the time in an open booking or move sheet. A time in the free list is one click on its chip; any
 * other time goes through "Pick another time" (the command then refuses it when the doctor is off duty, blocked or booked).
 */
export async function setSlot(sheet: Locator, ux: UxCounter, time: string, doctorId: string): Promise<void> {
  const doctor = sheet.getByRole("combobox", { name: "Doctor" });
  if (await doctor.isVisible()) await ux.select(doctor, doctorId, "Doctor");
  await slotsLoaded(sheet);
  const chip = sheet.getByRole("radio", { name: label12(time), exact: true });
  if ((await chip.count()) > 0) {
    await ux.click(chip, `slot ${label12(time)}`);
    await expect(chip).toBeChecked();
    return;
  }
  await ux.click(sheet.getByRole("button", { name: "Pick another time" }), "Pick another time");
  await ux.fill(sheet.getByLabel("Other time"), time, "Other time");
}

export function conflictDialog(page: Page, title: string): Locator {
  return page.getByRole("alertdialog", { name: title });
}
