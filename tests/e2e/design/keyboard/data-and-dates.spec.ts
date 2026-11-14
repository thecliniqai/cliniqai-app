/**
 * Keyboard, focus and clinic-date behaviour of the data-display and date/identity primitives (V2-06 06-02c, R-14:
 * real browser on `/dev/ui`, no jsdom; 06-UI-SPEC "06-02c Data display and dates", DESIGN_SYSTEM §5, §7.8).
 *
 * Dates: the browser runs in a zone far from the clinic's (and in the clinic's own zone, where a UTC `toISOString()`
 * cut goes wrong) with its clock fixed near an IST midnight; the calendar's "today", the picked day, the quick dates
 * and the shown text must all be the clinic's (`Asia/Kolkata`) date.
 *
 * PR lane, desktop-chrome only (keyboard specs under design/ run there; playwright.config.ts).
 */
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../../fixtures";
import { storageStatePath } from "../../support/run-data";
import { expectFocusRing } from "../support/focus";

test.use({ storageState: storageStatePath("owner") });

/** 23:30 IST on Thu 12 Nov 2026 (18:00 UTC). */
const IST_2330_12_NOV = new Date("2026-11-12T18:00:00Z");
/** 00:30 IST on Fri 13 Nov 2026 (19:00 UTC on 12 Nov). */
const IST_0030_13_NOV = new Date("2026-11-12T19:00:00Z");

/**
 * Freezes the page's clock at `at` without breaking `Date` subclasses. `TZDate` (@date-fns/tz, used by lib/datetime and
 * react-day-picker for the clinic zone) extends `Date` and proxies the methods it finds on `Date.prototype`. Playwright's
 * `page.clock` swaps in a `Date` whose constructor returns a plain native Date (the subclass prototype is lost), and a
 * `class extends Date` stand-in has a prototype with no own methods to proxy: both made
 * `new TZDate(18:00Z, "Asia/Kolkata").getDate()` read 13 (the browser's UTC+14 day) instead of 12
 * (evidence/06-02c/clock-probe.txt). This stand-in builds every date with `Reflect.construct(NativeDate, args,
 * new.target)` and shares the native prototype, so only `Date.now()` and `new Date()` change.
 */
async function freezeClock(page: Page, at: Date) {
  await page.addInitScript((ms: number) => {
    const Native = Date;
    function FrozenDate(this: unknown, ...args: unknown[]) {
      if (!new.target) return Native();
      return Reflect.construct(Native, args.length === 0 ? [ms] : args, new.target);
    }
    FrozenDate.prototype = Native.prototype;
    FrozenDate.now = () => ms;
    FrozenDate.parse = Native.parse;
    FrozenDate.UTC = Native.UTC;
    globalThis.Date = FrozenDate as unknown as DateConstructor;
  }, at.getTime());
}

async function openGallery(page: Page, testInfo: { project: { name: string } }, clock?: Date) {
  test.skip(testInfo.project.name !== "desktop-chrome", "keyboard specs run once, on desktop Chromium");
  if (clock) await freezeClock(page, clock);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/dev/ui");
  await expect(page.getByRole("heading", { level: 1, name: "Component gallery" })).toBeVisible();
}

/** The DateField of a gallery Field, by its label. */
function dateField(page: Page, label: string) {
  const input = page.getByRole("textbox", { name: label, exact: true });
  const group = page.locator("[data-date-field]").filter({ has: input });
  return { input, chooser: group.getByRole("button", { name: "Choose date" }), group };
}

/** The open calendar popover and its grid. */
function calendarPopover(page: Page) {
  const popover = page.getByRole("dialog", { name: "Choose date" });
  return { popover, grid: popover.getByRole("grid"), caption: popover.locator(".rdp-caption_label, [role=status]").first() };
}

/** The focused day button's `YYYY-MM-DD` (react-day-picker's `data-day` on its cell). */
async function focusedDay(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return el?.closest("[data-day]")?.getAttribute("data-day") ?? null;
  });
}

async function press(page: Page, key: string) {
  await page.keyboard.press(key);
}

async function expectGridMonth(grid: Locator, name: string) {
  await expect(grid).toHaveAccessibleName(name);
}

test.describe("DateField and Calendar in a browser far from the clinic (UTC+14)", () => {
  test.use({ timezoneId: "Pacific/Kiritimati" });

  test("at 23:30 IST the calendar's today is the clinic's 12 Nov; arrows, Home/End and PageUp/PageDown move; Enter picks it; focus returns to the field", async ({ page }, testInfo) => {
    await openGallery(page, testInfo, IST_2330_12_NOV);
    const review = dateField(page, "Next review");
    // The keyboard path: Tab from the field to "Choose date", Enter.
    await review.input.focus();
    await press(page, "Tab");
    await expect(review.chooser).toBeFocused();
    await press(page, "Enter");
    const { popover, grid } = calendarPopover(page);
    await expect(popover).toBeVisible();
    await expectGridMonth(grid, "November 2026");

    // Opens on the clinic's today (the browser's own date is already 13 Nov).
    await expect.poll(() => focusedDay(page)).toBe("2026-11-12");
    const todayButton = popover.locator('[data-day="2026-11-12"] button');
    await expect(todayButton).toHaveAccessibleName("Today, Thursday, 12 November 2026");
    await expectFocusRing(todayButton, "the focused day");

    // Grid navigation (weeks start on Sunday, CD-24).
    await press(page, "ArrowRight");
    await expect.poll(() => focusedDay(page)).toBe("2026-11-13");
    await press(page, "ArrowDown");
    await expect.poll(() => focusedDay(page)).toBe("2026-11-20");
    await press(page, "ArrowLeft");
    await expect.poll(() => focusedDay(page)).toBe("2026-11-19");
    await press(page, "ArrowUp");
    await expect.poll(() => focusedDay(page)).toBe("2026-11-12");
    await press(page, "Home");
    await expect.poll(() => focusedDay(page)).toBe("2026-11-08");
    await press(page, "End");
    await expect.poll(() => focusedDay(page)).toBe("2026-11-14");
    await press(page, "PageDown");
    await expect.poll(() => focusedDay(page)).toBe("2026-12-14");
    await expectGridMonth(grid, "December 2026");
    await press(page, "PageUp");
    await press(page, "PageUp");
    await expect.poll(() => focusedDay(page)).toBe("2026-10-14");
    await expectGridMonth(grid, "October 2026");
    await press(page, "PageDown");
    await expect.poll(() => focusedDay(page)).toBe("2026-11-14");

    // Enter picks; the popover closes and focus is back in the text field.
    await press(page, "Enter");
    await expect(popover).toHaveCount(0);
    await expect(review.input).toBeFocused();
    await expect(review.input).toHaveValue("14/11/2026");
    await expect(page.getByTestId("date-review-value")).toHaveText("2026-11-14");
    await expect(review.input).toHaveAccessibleDescription(/Sat, 14 Nov 2026/);

    // Reopens on the picked day, marked selected; Escape closes without changing it and returns focus to the field.
    await press(page, "Tab");
    await press(page, "Enter");
    await expect.poll(() => focusedDay(page)).toBe("2026-11-14");
    await expect(popover.locator('[data-day="2026-11-14"] button')).toHaveAccessibleName("Saturday, 14 November 2026, selected");
    await press(page, "ArrowRight");
    await press(page, "Escape");
    await expect(popover).toHaveCount(0);
    await expect(review.input).toBeFocused();
    await expect(page.getByTestId("date-review-value")).toHaveText("2026-11-14");
  });

  test("the Today / Tomorrow chips and the max bound use the clinic's date, not the browser's", async ({ page }, testInfo) => {
    await openGallery(page, testInfo, IST_2330_12_NOV);
    const visit = dateField(page, "Visit date");
    await visit.group.getByRole("radio", { name: "Tomorrow" }).click();
    await expect(page.getByTestId("date-visit-value")).toHaveText("2026-11-13");
    await expect(visit.input).toHaveValue("13/11/2026");
    await visit.group.getByRole("radio", { name: "Today" }).click();
    await expect(page.getByTestId("date-visit-value")).toHaveText("2026-11-12");
    await expect(visit.group.getByRole("radio", { name: "Today" })).toHaveAttribute("aria-checked", "true");

    // Date of birth: max = the clinic's today (12 Nov). 13 Nov is the browser's today but is in the clinic's future.
    const dob = dateField(page, "Date of birth");
    await dob.input.fill("13/11/2026");
    await dob.input.blur();
    await expect(dob.input).toHaveAttribute("aria-invalid", "true");
    await expect(dob.input).toHaveAccessibleDescription(/Enter a date on or before 12 Nov 2026/);
    await expect(page.getByTestId("date-dob-value")).toHaveText("none");
    await dob.input.fill("12/11/2026");
    await expect(page.getByTestId("date-dob-value")).toHaveText("2026-11-12");
    await expect(dob.input).not.toHaveAttribute("aria-invalid", "true");

    // In the calendar the days after the max are disabled and the keyboard cannot land on them.
    await dob.chooser.click();
    const { popover } = calendarPopover(page);
    await expect.poll(() => focusedDay(page)).toBe("2026-11-12");
    await expect(popover.locator('[data-day="2026-11-13"] button')).toBeDisabled();
    await press(page, "ArrowRight");
    await expect.poll(() => focusedDay(page)).toBe("2026-11-12");
    await press(page, "Escape");
    await expect(dob.input).toBeFocused();
  });
});

test.describe("DateField in the clinic's own zone (Asia/Kolkata)", () => {
  test.use({ timezoneId: "Asia/Kolkata" });

  test("a day picked at 23:30 IST stays that day (no UTC cut), and at 00:30 IST today is already the next day", async ({ page }, testInfo) => {
    await openGallery(page, testInfo, IST_2330_12_NOV);
    const review = dateField(page, "Next review");
    await review.chooser.click();
    await expect.poll(() => focusedDay(page)).toBe("2026-11-12");
    await press(page, "ArrowDown");
    await press(page, "Enter");
    await expect(page.getByTestId("date-review-value")).toHaveText("2026-11-19");
    await expect(review.input).toHaveValue("19/11/2026");
    await expect(review.input).toHaveAccessibleDescription(/Thu, 19 Nov 2026/);
  });

  test("at 00:30 IST the calendar opens on 13 Nov (UTC is still on 12 Nov)", async ({ page }, testInfo) => {
    await openGallery(page, testInfo, IST_0030_13_NOV);
    const review = dateField(page, "Next review");
    await review.chooser.click();
    await expect.poll(() => focusedDay(page)).toBe("2026-11-13");
    await press(page, "Enter");
    await expect(page.getByTestId("date-review-value")).toHaveText("2026-11-13");
  });
});

test.describe("DateField typing", () => {
  test("dd/mm/yyyy: slashes come by themselves, d/m/yyyy is read, a non-date shows how to fix it, clearing clears", async ({ page }, testInfo) => {
    await openGallery(page, testInfo);
    const review = dateField(page, "Next review");
    await review.input.click();
    await page.keyboard.type("12112026");
    await expect(review.input).toHaveValue("12/11/2026");
    await expect(page.getByTestId("date-review-value")).toHaveText("2026-11-12");
    await expect(review.input).toHaveAccessibleDescription(/Thu, 12 Nov 2026/);

    await review.input.fill("");
    await page.keyboard.type("1/2/2026");
    await expect(review.input).toHaveValue("1/2/2026");
    await expect(page.getByTestId("date-review-value")).toHaveText("2026-02-01");

    // Never mm/dd: 31/02 is not a date (31 Feb). Typing over the old text keeps the old value until it is fixed.
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("31022026");
    await expect(review.input).toHaveValue("31/02/2026");
    await page.keyboard.press("Tab");
    await expect(review.input).toHaveAttribute("aria-invalid", "true");
    await expect(review.input).toHaveAccessibleDescription(/Enter the date as dd\/mm\/yyyy/);
    await expect(page.getByTestId("date-review-value")).toHaveText("2026-02-01");

    await review.input.fill("");
    await expect(page.getByTestId("date-review-value")).toHaveText("none");
    await expect(review.input).not.toHaveAttribute("aria-invalid", "true");
  });
});

/* ------------------------------------------------------------------ Data display (2c) */

test.describe("DataTable, DataList and Pagination", () => {
  test("sortable headers are buttons; Enter and Space toggle aria-sort and the order; numbers align right", async ({ page }, testInfo) => {
    await openGallery(page, testInfo);
    const table = page.getByRole("table", { name: "Patients" });
    await expect(table).toBeVisible();
    const patientTh = table.getByRole("columnheader", { name: "Patient" });
    const lastVisitTh = table.getByRole("columnheader", { name: "Last visit" });
    const firstRowLink = table.getByRole("row").nth(1).getByRole("link");

    await expect(lastVisitTh).toHaveAttribute("aria-sort", "descending");
    await expect(patientTh).toHaveAttribute("aria-sort", "none");
    await expect(table.getByRole("columnheader", { name: "Age" })).not.toHaveAttribute("aria-sort");

    const sortPatient = patientTh.getByRole("button", { name: "Patient" });
    await sortPatient.focus();
    await expectFocusRing(sortPatient, "the Patient sort button");
    await page.keyboard.press("Enter");
    await expect(patientTh).toHaveAttribute("aria-sort", "ascending");
    await expect(lastVisitTh).toHaveAttribute("aria-sort", "none");
    await expect(firstRowLink).toHaveText("Synthetic Patient 01");
    await page.keyboard.press("Space");
    await expect(patientTh).toHaveAttribute("aria-sort", "descending");
    await expect(firstRowLink).toHaveText("Synthetic Patient 05");
    await expect(sortPatient).toBeFocused();

    const visitsTh = table.getByRole("columnheader", { name: "Visits" });
    await visitsTh.getByRole("button").click();
    await expect(visitsTh).toHaveAttribute("aria-sort", "ascending");
    await expect(table.getByRole("row").nth(1).getByRole("cell").nth(5)).toHaveText("1");
    expect(await table.getByRole("row").nth(1).getByRole("cell").nth(5).evaluate((el) => getComputedStyle(el).textAlign)).toBe("right");

    // Row actions are always visible (not hover-only): every row's "Check in" and ⋯ are on screen without hovering.
    await page.mouse.move(0, 0);
    await expect(table.getByRole("button", { name: /^Check in / })).toHaveCount(5);
    for (const button of await table.getByRole("button", { name: /^More actions for / }).all()) await expect(button).toBeVisible();
  });

  test("states: loading (5 skeleton rows, announced), empty, error with Retry, stale with Retry", async ({ page }, testInfo) => {
    await openGallery(page, testInfo);
    const table = page.getByRole("table", { name: "Patients" });
    const state = page.getByRole("radiogroup", { name: "Table state" });

    await state.getByRole("radio", { name: "Loading" }).click();
    await expect(table).toHaveAttribute("aria-busy", "true");
    await expect(page.getByRole("status").filter({ hasText: "Loading patients" }).first()).toBeAttached();
    await expect(table.locator("tbody tr")).toHaveCount(5);
    await expect(table.locator("tbody [data-skeleton]").first()).toBeVisible();

    await state.getByRole("radio", { name: "Empty" }).click();
    await expect(table.getByRole("heading", { name: "Nothing matches these filters" })).toBeVisible();

    await state.getByRole("radio", { name: "Error" }).click();
    const error = table.getByRole("alert");
    await expect(error).toContainText("Couldn't load patients");
    await error.getByRole("button", { name: "Retry" }).click();
    await expect(page.getByTestId("table-outcome")).toContainText("1 retries");
    await expect(table.getByRole("row")).toHaveCount(6);

    await state.getByRole("radio", { name: "Stale" }).click();
    const stale = page.locator("[data-data-table]").getByRole("status").filter({ hasText: "Showing data from 10:42 am" });
    await expect(stale).toBeVisible();
    await stale.getByRole("button", { name: "Retry" }).click();
    await expect(page.getByTestId("table-outcome")).toContainText("2 retries");
    await expect(stale).toHaveCount(0);
  });

  test("below lg the same model is a two-line list; Load more adds rows and focus moves to the first new one", async ({ page }, testInfo) => {
    await openGallery(page, testInfo);
    await page.setViewportSize({ width: 820, height: 1180 });
    await expect(page.getByRole("table", { name: "Patients" })).toBeHidden();
    const list = page.getByRole("list", { name: "Patients" });
    await expect(list).toBeVisible();
    await expect(list.getByRole("listitem")).toHaveCount(5);
    const first = list.getByRole("listitem").first();
    await expect(first.getByRole("link")).toHaveText("Synthetic Patient 01");
    await expect(first).toContainText("Waiting");
    await expect(first).toContainText("Age: 42 y · M");
    await expect(first).toContainText("Last visit: 12 Nov 2026");

    const more = page.locator("[data-data-list]").getByRole("button", { name: "Load more" });
    await more.focus();
    await page.keyboard.press("Enter");
    await expect(list.getByRole("listitem")).toHaveCount(7);
    await expect(more).toHaveCount(0);
    await expect(list.getByRole("listitem").nth(5).getByRole("link")).toBeFocused();
  });

  test("Pagination: Next and Previous by keyboard, Indian grouping, the disabled end hands focus to the other button", async ({ page }, testInfo) => {
    await openGallery(page, testInfo);
    const nav = page.getByRole("navigation", { name: "Patients pages" });
    const previous = nav.getByRole("button", { name: "Previous" });
    const next = nav.getByRole("button", { name: "Next" });
    await expect(nav).toContainText("Showing 1–25 of 1,240");
    await expect(previous).toBeDisabled();

    await next.focus();
    await expectFocusRing(next, "Next");
    await page.keyboard.press("Enter");
    await expect(nav).toContainText("Showing 26–50 of 1,240");
    await expect(page.getByTestId("pagination-outcome")).toHaveText("Page 2");
    await expect(previous).toBeEnabled();
    await page.keyboard.press("Shift+Tab");
    await expect(previous).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(nav).toContainText("Showing 1–25 of 1,240");
    await expect(previous).toBeDisabled();
    await expect(next).toBeFocused();

    const short = page.getByRole("navigation", { name: "Short list pages" });
    await expect(short).toContainText("Showing 26–48 of 48");
    await expect(short.getByRole("button", { name: "Next" })).toBeDisabled();
  });
});

test.describe("SearchField and FilterChip", () => {
  test("search waits 200 ms after typing, Escape and Clear search empty it and keep focus", async ({ page }, testInfo) => {
    await openGallery(page, testInfo);
    const search = page.getByRole("searchbox", { name: "Search patients" });
    const outcome = page.getByTestId("search-outcome");
    await expect(search).toHaveAttribute("enterkeyhint", "search");
    await search.focus();
    await page.keyboard.type("patient 03");
    // One search for the burst of typing, after it stops.
    await expect(outcome).toHaveText("Searched “patient 03” · 1 search");
    await expect(page.getByRole("table", { name: "Patients" }).getByRole("row")).toHaveCount(2);

    await page.keyboard.press("Escape");
    await expect(search).toHaveValue("");
    await expect(search).toBeFocused();
    await expect(outcome).toHaveText("Searched “” · 2 searches");

    await page.keyboard.type("x");
    const clear = page.getByRole("button", { name: "Clear search" });
    await expect(clear).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(clear).toBeFocused();
    await expectFocusRing(clear, "Clear search");
    await page.keyboard.press("Enter");
    await expect(search).toHaveValue("");
    await expect(search).toBeFocused();
    await expect(clear).toHaveCount(0);
  });

  test("removing a filter by keyboard moves focus to the next one; + Filter opens its popover; Clear all lands on + Filter", async ({ page }, testInfo) => {
    await openGallery(page, testInfo);
    const bar = page.getByRole("group", { name: "Patient filters" });
    const removeDoctor = bar.getByRole("button", { name: "Remove filter Doctor: Dr Rao" });
    const removeStatus = bar.getByRole("button", { name: "Remove filter Status: Waiting" });
    const addFilter = bar.getByRole("button", { name: "Filter", exact: true });
    await removeDoctor.focus();
    await expectFocusRing(removeDoctor, "the remove-filter button");
    await page.keyboard.press("Enter");
    await expect(removeDoctor).toHaveCount(0);
    await expect(removeStatus).toBeFocused();
    await expect(page.getByTestId("filters-outcome")).toHaveText("status, origin");

    // "+ Filter": Enter opens the popover on its first option; picking one closes it and focus returns.
    await addFilter.focus();
    await page.keyboard.press("Enter");
    const popover = page.getByRole("dialog", { name: "Add a filter" });
    await expect(popover).toBeVisible();
    await expect(addFilter).toHaveAttribute("aria-expanded", "true");
    await expect(popover.getByRole("button", { name: "Doctor: Dr Rao" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(popover).toHaveCount(0);
    await expect(addFilter).toBeFocused();
    await expect(page.getByTestId("filters-outcome")).toHaveText("status, origin, doctor");

    // The last chip's removal hands focus back to the previous chip; "Clear all" to "+ Filter".
    await bar.getByRole("button", { name: "Remove filter Doctor: Dr Rao" }).focus();
    await page.keyboard.press("Enter");
    await expect(bar.getByRole("button", { name: "Remove filter Visit: Walk-in" })).toBeFocused();
    await bar.getByRole("button", { name: "Clear all" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("filters-outcome")).toHaveText("no filters");
    await expect(addFilter).toBeFocused();
    await expect(bar.getByRole("button", { name: "Clear all" })).toHaveCount(0);
  });
});

test.describe("Skeleton", () => {
  test("pulses only when motion is allowed", async ({ page }, testInfo) => {
    await openGallery(page, testInfo);
    const block = page.locator("[data-gallery-group=skeleton] [data-skeleton]").first();
    await expect(block).toBeVisible();
    expect(await block.evaluate((el) => getComputedStyle(el).animationName)).toBe("pulse");
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(await block.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
    // The region is announced once, named; the blocks themselves are hidden from assistive technology.
    await expect(page.getByRole("status", { name: "Loading queue" })).toBeAttached();
    await expect(block).toHaveAttribute("aria-hidden", "true");
  });
});

/* ------------------------------------------------------------------ Days, slots and identity (2d) */

/** Presses a roving-focus key held for 50 ms, as a person does (Radix moves roving focus in a timeout; 06-02a). */
async function rove(page: Page, key: string) {
  await page.keyboard.press(key, { delay: 50 });
}

test.describe("DayStrip, SlotPicker, PhoneInput and AgeOrDobInput in a browser far from the clinic (UTC+14)", () => {
  test.use({ timezoneId: "Pacific/Kiritimati" });

  test("DayStrip: Today is the clinic's day; arrows rove and wrap, Home/End jump, Space picks", async ({ page }, testInfo) => {
    await openGallery(page, testInfo, IST_2330_12_NOV);
    const strip = page.getByRole("radiogroup", { name: "Appointment day" });
    const today = strip.getByRole("radio", { name: "Today, 12 Nov 2026" });
    await expect(today).toHaveAttribute("aria-checked", "true");
    await expect(strip.getByRole("radio", { name: "Sat 14 Nov 2026" })).toHaveText("Sat 14");

    await today.focus();
    await expectFocusRing(today, "the selected day chip");
    await rove(page, "ArrowRight");
    const tomorrow = strip.getByRole("radio", { name: "Tomorrow, 13 Nov 2026" });
    await expect(tomorrow).toBeFocused();
    await page.keyboard.press("Space");
    await expect(tomorrow).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("day-strip-value")).toHaveText("2026-11-13");

    await rove(page, "End");
    const last = strip.getByRole("radio", { name: "Wed 25 Nov 2026" });
    await expect(last).toBeFocused();
    await expect(last).toBeInViewport();
    await rove(page, "ArrowRight");
    await expect(today).toBeFocused();
    await rove(page, "ArrowLeft");
    await expect(last).toBeFocused();
    await rove(page, "Home");
    await expect(today).toBeFocused();
  });

  test("SlotPicker: a radiogroup per part of the day, full slots hidden until shown, an overbooking warns", async ({ page }, testInfo) => {
    await openGallery(page, testInfo);
    const picker = page.locator("[data-gallery-group=slot-picker] [data-slot-picker]").first();
    const morning = picker.getByRole("radiogroup", { name: "Morning" });
    await expect(morning.getByRole("radio")).toHaveText(["9:30 am", "10:30 am", "11:30 am"]);
    await expect(picker.getByRole("radiogroup", { name: "Afternoon" }).getByRole("radio")).toHaveText(["12:15 pm", "3:45 pm"]);
    await expect(picker.getByRole("radiogroup", { name: "Evening" }).getByRole("radio")).toHaveText(["5:30 pm", "6:00 pm"]);

    await morning.getByRole("radio", { name: "9:30 am" }).focus();
    await rove(page, "ArrowRight");
    await expect(morning.getByRole("radio", { name: "10:30 am" })).toBeFocused();
    await page.keyboard.press("Space");
    await expect(page.getByTestId("slot-value")).toHaveText("10:30");
    await page.keyboard.press("Tab");
    await expect(picker.getByRole("radiogroup", { name: "Afternoon" }).getByRole("radio", { name: "12:15 pm" })).toBeFocused();
    await page.keyboard.press("Space");
    await expect(page.getByTestId("slot-value")).toHaveText("12:15");
    await expect(morning.getByRole("radio", { name: "10:30 am" })).toHaveAttribute("aria-checked", "false");

    await picker.getByRole("checkbox", { name: "Show full slots" }).click();
    const full = morning.getByRole("radio", { name: "10:00 am, full" });
    await expect(full).toBeVisible();
    await expect(full).toContainText("Full");
    await full.click();
    await expect(page.getByTestId("slot-value")).toHaveText("10:00");
    await expect(picker.getByText("This slot is full")).toBeVisible();
    await expect(picker).toContainText("10:00 am already has 3 of 3 booked. Booking it overbooks the slot.");

    await expect(page.locator("[data-gallery-group=slot-picker] [data-slot-picker]").nth(1)).toContainText("No free slots on this day");
  });

  test("PhoneInput: +91 adornment, digits only up to 10, a pasted +91 number is reduced to its 10 digits", async ({ page }, testInfo) => {
    await openGallery(page, testInfo);
    const phone = page.getByRole("textbox", { name: "Patient mobile", exact: true });
    await expect(phone).toHaveAttribute("type", "tel");
    await expect(phone).toHaveAttribute("inputmode", "numeric");
    await expect(phone).toHaveAttribute("autocomplete", "tel-national");
    await expect(phone).toHaveAccessibleDescription("10 digits");
    await expect(page.locator("[data-control-box]").filter({ has: phone })).toContainText("+91");
    await phone.click();
    await page.keyboard.type("98765-432109");
    await expect(phone).toHaveValue("9876543210");
    await expect(page.getByTestId("phone-value")).toHaveText("+919876543210");

    await phone.fill("");
    await phone.evaluate((el) => {
      const data = new DataTransfer();
      data.setData("text", "+91 91234 56789");
      el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    });
    await expect(phone).toHaveValue("9123456789");
    await expect(page.getByTestId("phone-value")).toHaveText("+919123456789");
  });

  test("AgeOrDobInput: age gives an approximate DOB, months below 2 years, DOB gives the age on the clinic's date", async ({ page }, testInfo) => {
    await openGallery(page, testInfo, IST_2330_12_NOV);
    const group = page.getByRole("group", { name: "Age or date of birth" });
    const age = group.getByRole("textbox", { name: "Age" });
    await age.fill("42");
    await expect(age).toHaveAccessibleDescription("Born about 1984");
    await expect(page.getByTestId("age-value")).toHaveText("1984-01-01 (approximate)");

    await group.getByRole("combobox", { name: "Age unit" }).selectOption("m");
    await expect(age).toHaveAttribute("aria-invalid", "true");
    await expect(age).toHaveAccessibleDescription("Enter an age from 0 to 23 months");
    await age.fill("8");
    await expect(age).toHaveAccessibleDescription("Born about Mar 2026");
    await expect(page.getByTestId("age-value")).toHaveText("2026-03-12 (approximate)");

    // Switch by keyboard to Date of birth; 13 Nov is the browser's today but not yet the clinic's.
    const mode = group.getByRole("radiogroup", { name: "Enter age or date of birth" });
    await mode.getByRole("radio", { name: "Age" }).focus();
    await rove(page, "ArrowRight");
    await expect(mode.getByRole("radio", { name: "Date of birth" })).toHaveAttribute("aria-checked", "true");
    const dob = group.getByRole("textbox", { name: "Date of birth" });
    await dob.fill("13/11/1984");
    await expect(page.getByTestId("age-value")).toHaveText("1984-11-13");
    await expect(dob).toHaveAccessibleDescription(/41 y/);
    await dob.fill("12/11/1984");
    await expect(dob).toHaveAccessibleDescription(/42 y/);
  });
});
