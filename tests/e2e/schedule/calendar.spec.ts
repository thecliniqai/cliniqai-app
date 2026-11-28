/**
 * The calendar views of the Schedule (V2-09f 09F; 09F-PLAN AC-1 to AC-7).
 *
 * - AC-1 (768 px and up): the week time grid shows an appointment at its day and time and the free slots around it; a free slot opens the booking sheet
 *   with its time chosen and books it (the visit in the database);
 * - AC-2: "Pick a new time on the grid", then a free slot ("Move here") opens the move sheet with that slot chosen; Move moves the visit (database: the
 *   new instant, `row_version` + 1);
 * - AC-3 / AC-4: the month counts each day's visits; week to month and month to week read no range (each is the other's read-ahead); a day opens its day;
 * - AC-5: a booking committed elsewhere raises the open month's count with no render request;
 * - AC-6: below 768 px the week view is the overview list; the month has no sideways scroll at the project's width;
 * - AC-7: keyboard (Enter on a free slot opens the booking; Esc leaves the move mode) and axe (0 serious or critical) on the grid, the move mode and the
 *   month.
 * Each test has its own clinic (the owner practises with the default hours). Synthetic data only.
 */
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { getAdminClient } from "../../helpers/supabase-admin";
import { seedTenantWithOwner, seededUserPassword, type SeededTenant } from "../../helpers/tenants";
import { istDate, istInstant, seedPatient, testTag } from "../support/m0-data";
import { uiSignIn } from "../support/password-journeys";
import { bookingSheet, chooseExistingPatient, moveSheet, scheduleHydrated, slotsLoaded } from "../support/schedule-page";
import { settleAnimations } from "../support/settle";
import { countRscRequests } from "../support/today-page";

test.use({ storageState: { cookies: [], origins: [] } });

const TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const SCHEDULE = "#main [data-schedule]";

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** A Monday-to-Friday clinic date `offset` days or more ahead whose next day is in the same week and the same month. */
function weekdayWithNext(offset: number): string {
  for (let i = offset; i < offset + 21; i++) {
    const date = istDate(i);
    const day = new Date(`${date}T12:00:00+05:30`).getUTCDay();
    if (day >= 1 && day <= 4 && addDays(date, 1).slice(0, 7) === date.slice(0, 7)) return date;
  }
  throw new Error("no weekday");
}

/** The Monday of the week that holds `date`, and the six weeks the month view of `date` reads. */
function mondayOf(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
const monthRange = (date: string) => {
  const from = mondayOf(`${date.slice(0, 7)}-01`);
  return `${from}..${addDays(from, 41)}`;
};
const weekRange = (date: string) => `${mondayOf(date)}..${addDays(mondayOf(date), 6)}`;

async function ownClinic(): Promise<SeededTenant> {
  return seedTenantWithOwner(`E2E Synthetic Calendar ${testTag()}`);
}

async function open(page: Page, clinic: SeededTenant, query: string): Promise<void> {
  await uiSignIn(page, { email: clinic.userEmail, password: seededUserPassword() });
  await page.goto(`/schedule?${query}`);
  await page.locator(SCHEDULE).waitFor();
  await scheduleHydrated(page);
}

/** A committed booking of the owner at clinic `time` on `date` (another device's write, as the database sees it). */
async function bookElsewhere(clinic: SeededTenant, date: string, time: string, label: string): Promise<{ visitId: string; name: string }> {
  const name = `E2E Synthetic ${label} ${testTag()}`;
  const patient = await seedPatient(clinic.tenantId, clinic.userId, name);
  const { data, error } = await getAdminClient()
    .from("visits")
    .insert({
      tenant_id: clinic.tenantId,
      patient_id: patient.id,
      doctor_id: clinic.userId,
      origin_type: "scheduled",
      status: "booked",
      scheduled_at: istInstant(date, time),
      estimated_duration_minutes: 15,
      created_by: clinic.userId,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`calendar seed: ${error?.message}`);
  return { visitId: data.id, name };
}

/** Every range read of the page, as `from..to` plus ` counts` for a read without slots. */
function rangeReads(page: Page): string[] {
  const reads: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/schedule/range") reads.push(`${url.searchParams.get("from")}..${url.searchParams.get("to")}${url.searchParams.get("slots") === "0" ? " counts" : ""}`);
  });
  return reads;
}

async function expectAxeClean(page: Page, scope: string, what: string): Promise<void> {
  await settleAnimations(page);
  const results = await new AxeBuilder({ page }).include(scope).withTags(TAGS).analyze();
  const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`), `axe on ${what}`).toEqual([]);
}

const wide = (page: Page) => (page.viewportSize()?.width ?? 0) >= 768;
const column = (page: Page, date: string) => page.locator(`[data-week-grid-column="${date}"]`);
const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test("@golden AC-1: the week grid shows an appointment at its day and time, and a free slot books with its time chosen", async ({ page, ux }) => {
  test.skip(!wide(page), "the time grid is the 768 px and up week view (AC-6 covers the narrow one)");
  const clinic = await ownClinic();
  const date = weekdayWithNext(3);
  const booked = await bookElsewhere(clinic, date, "10:00", "GridBooked");
  const newcomer = `E2E Synthetic GridNew ${testTag()}`;
  await seedPatient(clinic.tenantId, clinic.userId, newcomer);
  await open(page, clinic, `date=${date}&view=week`);

  const block = column(page, date).locator(`[data-appointment="${booked.visitId}"] [data-appointment-block]`);
  await expect(block).toHaveAccessibleName(new RegExp(`^${booked.name}, 10:00 am to 10:15 am, Booked`));
  await expect(column(page, date).locator('[data-free-slot="10:00"]')).toHaveCount(0);
  await expect(column(page, date).locator('[data-free-slot="10:15"]')).toBeVisible();
  // The block sits on the 10:00 row: the 10:15 slot starts exactly one row (one slot's height) below it.
  const [slotBox, blockBox] = [await column(page, date).locator('[data-free-slot="10:15"]').boundingBox(), await block.boundingBox()];
  expect(Math.abs(slotBox!.y - blockBox!.y - slotBox!.height), "the block is one row above the 10:15 slot").toBeLessThan(3);

  const rsc = countRscRequests(page);
  await column(page, date).locator('[data-free-slot="10:30"]').click();
  const sheet = bookingSheet(page);
  await expect(sheet).toBeVisible();
  await chooseExistingPatient(sheet, ux, newcomer);
  await slotsLoaded(sheet);
  await expect(sheet.getByRole("radio", { name: "10:30 am", exact: true })).toBeChecked();
  expect(rsc(), "opening the sheet from the grid renders no page").toBe(0);
  await sheet.getByRole("button", { name: "Book", exact: true }).click();
  await expect(sheet).toHaveCount(0);

  const { data } = await getAdminClient().from("visits").select("id, status, scheduled_at").eq("tenant_id", clinic.tenantId).neq("id", booked.visitId);
  expect(data).toHaveLength(1);
  expect(new Date(data![0]!.scheduled_at!).toISOString()).toBe(istInstant(date, "10:30"));
  await expect(column(page, date).locator(`[data-appointment="${data![0]!.id}"]`)).toBeVisible();
  await expect(column(page, date).locator('[data-free-slot="10:30"]')).toHaveCount(0);
});

test("@golden AC-2 and AC-7: pick a new time on the grid, Move here, Move: the visit moves with its version; Esc leaves the move mode; axe clean", async ({ page }) => {
  test.skip(!wide(page), "the time grid is the 768 px and up week view");
  const clinic = await ownClinic();
  const date = weekdayWithNext(3);
  const next = addDays(date, 1);
  const booked = await bookElsewhere(clinic, date, "10:00", "GridMove");
  const before = await getAdminClient().from("visits").select("row_version").eq("id", booked.visitId).single();
  await open(page, clinic, `date=${date}&view=week`);
  await expectAxeClean(page, "[data-week-grid]", "the week grid");

  // Keyboard: Enter on the block opens its card; the card offers the grid move.
  const block = column(page, date).locator(`[data-appointment="${booked.visitId}"] [data-appointment-block]`);
  await block.focus();
  await page.keyboard.press("Enter");
  const pick = page.getByRole("button", { name: "Pick a new time on the grid" });
  await expect(pick).toBeVisible();
  await pick.click();
  const banner = page.locator("[data-move-mode]");
  await expect(banner).toContainText(`Moving ${booked.name}`);
  const target = column(page, next).locator('[data-free-slot="11:00"]');
  await expect(target).toHaveAccessibleName(new RegExp(`^Move ${booked.name} to .*11:00 am$`));
  await expectAxeClean(page, "[data-week-grid]", "the move mode");
  await page.keyboard.press("Escape");
  await expect(banner).toHaveCount(0);
  await expect(target).toHaveAccessibleName(/^Book /);

  // Again, and this time choose the slot: the move sheet opens with it chosen and Move sends the command.
  await block.click();
  await pick.click();
  await target.click();
  const sheet = moveSheet(page);
  await expect(sheet).toBeVisible();
  await slotsLoaded(sheet);
  await expect(sheet.getByRole("radio", { name: "11:00 am", exact: true })).toBeChecked();
  await sheet.getByRole("button", { name: "Move appointment" }).click();
  await expect(sheet).toHaveCount(0);

  const after = await getAdminClient().from("visits").select("scheduled_at, status, row_version").eq("id", booked.visitId).single();
  expect(new Date(after.data!.scheduled_at!).toISOString()).toBe(istInstant(next, "11:00"));
  expect(after.data!.status).toBe("booked");
  expect(after.data!.row_version).toBe(before.data!.row_version + 1);
  await expect(column(page, next).locator(`[data-appointment="${booked.visitId}"]`)).toBeVisible();
  await expect(column(page, date).locator(`[data-appointment="${booked.visitId}"]`)).toHaveCount(0);
});

test("@golden AC-3 to AC-5: the month counts each day; week and month switch with no read; a day opens its day; a booking elsewhere raises the count", async ({ page }) => {
  const clinic = await ownClinic();
  const date = weekdayWithNext(3);
  const next = addDays(date, 1);
  await bookElsewhere(clinic, date, "10:00", "MonthA");
  await bookElsewhere(clinic, date, "11:00", "MonthB");
  const later = await bookElsewhere(clinic, next, "10:00", "MonthC");
  const cancelled = await bookElsewhere(clinic, next, "12:00", "MonthCancelled");
  await getAdminClient().from("visits").update({ status: "cancelled" }).eq("id", cancelled.visitId);

  const reads = rangeReads(page);
  await uiSignIn(page, { email: clinic.userEmail, password: seededUserPassword() });
  const monthRead = page.waitForResponse((r) => r.url().includes("/api/schedule/range") && r.url().includes("slots=0"));
  await page.goto(`/schedule?date=${date}&view=week`);
  await page.locator(SCHEDULE).waitFor();
  await scheduleHydrated(page);
  await monthRead; // the week read ahead its month
  expect(reads, "the month of the date was read ahead, without slots").toContain(`${monthRange(date)} counts`);

  // Week to month: held, no read.
  const switchStart = reads.length;
  await page.getByRole("radio", { name: "Month" }).click();
  await expect(page.locator(SCHEDULE)).toHaveAttribute("data-schedule-view", "month");
  await expect(page.locator(`[data-month-day="${date}"]`)).toHaveAttribute("data-booked", "2");
  await expect(page.locator(`[data-month-day="${next}"]`)).toHaveAttribute("data-booked", "1");
  await expect(page.locator(`[data-month-day="${date}"]`)).toHaveAccessibleName(/: 2 booked$/);
  expect(reads.slice(switchStart).filter((r) => r === `${monthRange(date)} counts`), "AC-4: week to month reads nothing").toEqual([]);
  expect(await noSidewaysScroll(page), "AC-6: the month has no sideways scroll").toBe(true);
  await expectAxeClean(page, "[data-month-view]", "the month");

  // Month to week: held (the week was the page's own read), no read.
  const backStart = reads.length;
  await page.getByRole("radio", { name: "Week" }).click();
  await expect(page.locator(SCHEDULE)).toHaveAttribute("data-schedule-view", "week");
  await expect(page.locator("[data-week-view]")).toBeVisible();
  expect(reads.slice(backStart).filter((r) => r === weekRange(date)), "AC-4: month to week reads nothing").toEqual([]);
  if (!wide(page)) {
    // AC-6: the narrow week view is the overview list.
    await expect(page.locator("[data-week-view] [data-week-overview]")).toBeVisible();
    await expect(page.locator(`[data-week-day="${date}"]`)).toContainText("2 booked");
    expect(await noSidewaysScroll(page), "the narrow week has no sideways scroll").toBe(true);
  } else {
    await expect(page.locator("[data-week-view] [data-week-grid]")).toBeVisible();
  }

  // AC-5: live. Back on the month, a booking made elsewhere raises the count with no render request.
  await page.getByRole("radio", { name: "Month" }).click();
  await expect(page.locator("[data-live-status]")).toHaveText("Live", { timeout: 20_000 });
  const rsc = countRscRequests(page);
  await bookElsewhere(clinic, next, "11:30", "MonthLive");
  await expect(page.locator(`[data-month-day="${next}"]`)).toHaveAttribute("data-booked", "2", { timeout: 5_000 });
  expect(rsc(), "the re-read is the range query, not a page render").toBe(0);

  // A day opens that day (the day view from 768 px, the agenda below), with its appointments.
  await page.locator(`[data-month-day="${next}"]`).click();
  await expect(page.locator(SCHEDULE)).toHaveAttribute("data-schedule-view", wide(page) ? "day" : "agenda");
  await expect(page.locator("[data-appointment]").filter({ hasText: later.name })).toBeVisible();
});

test("AC-4: a month that is not held is one read of its six weeks, without slots", async ({ page }) => {
  const clinic = await ownClinic();
  const date = weekdayWithNext(3);
  const far = addDays(date, 100);
  const reads = rangeReads(page);
  await open(page, clinic, `date=${date}&view=month`);
  await expect(page.locator(`[data-month-day="${date}"]`)).toBeVisible();
  expect(reads.filter((r) => r === `${monthRange(date)} counts`), "the page's own month came with the page").toEqual([]);
  await page.getByLabel("Go to date").fill(far);
  await expect(page.locator(`[data-month-day="${far}"]`)).toBeVisible({ timeout: 15_000 });
  expect(reads.filter((r) => r === `${monthRange(far)} counts`), "one read of the far month").toHaveLength(1);
  expect(reads.filter((r) => r.startsWith(monthRange(far)) && !r.endsWith("counts")), "the month never reads slots").toEqual([]);
});
