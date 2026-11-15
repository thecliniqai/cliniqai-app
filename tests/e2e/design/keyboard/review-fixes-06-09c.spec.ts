/**
 * V2-06 06-09c: the Wave B review fixes of the clinical and identity components, in a real browser on `/dev/ui` (R-14:
 * no jsdom). Each case is the reviewer's reproduction and fails on the code before 06-09c:
 *
 * - M-VITALS (IND M-1): BP 150/95, P 110, 100.8 °F (high) and SpO₂ 84 % (critical-low): the critical reading is first
 *   and inline, with its own icon, the word "critical" and a tint ("high" has none). Before: it was only in the popover.
 * - M-RXKEYS (IND M-2): the inline help names each key's frequency and each tile shows its key, and pressing the key
 *   picks exactly that tile; "5" then Enter adds nothing (before: an SOS line); "5d" is 5 days with the usual
 *   frequency (before: SOS, then the "d" searched again and dropped the line); a tap on a duration tile or the
 *   stepper after typed digits saves what the screen shows (before: the typed "1" day); any other key after dose keys
 *   is refused, the line kept.
 * - M-PICKER (IND M-3): Enter while a newer search runs does nothing (before: the older query's first patient); a
 *   failed search ends the loading row with an error (before: an endless spinner).
 * - M-INFANTAGE (IND M-5): "0" years switches to months and asks for them (before: 1 Jan, shown "10 m"); "1" year is
 *   12 months, and the DOB reads back "12 m".
 * - IND L-6: moving from the Age/DOB toggle into the age box shows no error; a failing save says so.
 * - IND L-7: an age set from outside (editing a patient) fills the age box.
 * - IND L-5: a Button with no `type` inside a form is a submit button: offline it does nothing.
 * M-DATE is in `data-and-dates.spec.ts` (the DateField case). PR lane, desktop-chrome only.
 */
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../../fixtures";
import { storageStatePath } from "../../support/run-data";
import { freezeClock } from "../../support/clock";

test.use({ storageState: storageStatePath("owner") });

/** 11:30 IST on Thu 12 Nov 2026 (the G3 gallery's clock). */
const IST_1130_12_NOV = new Date("2026-11-12T06:00:00Z");

async function openGallery(page: Page, testInfo: { project: { name: string } }, clock?: Date) {
  test.skip(testInfo.project.name !== "desktop-chrome", "keyboard specs run once, on desktop Chromium");
  if (clock) await freezeClock(page, clock);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/dev/ui");
  await expect(page.getByRole("heading", { level: 1, name: "Component gallery" })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

function group(page: Page, title: string): Locator {
  return page.getByRole("group", { name: title, exact: true });
}

function rx(page: Page) {
  const scope = group(page, "Prescription");
  return {
    scope,
    search: scope.getByRole("combobox", { name: "Medicine" }),
    lines: scope.getByRole("list", { name: "Prescription lines" }).getByRole("listitem"),
    builder: scope.locator("[data-dose-builder]"),
    summary: scope.locator("[data-dose-summary]"),
    alert: scope.locator("[data-dose-builder]").getByRole("alert"),
  };
}

/** Opens the dose builder on Paracetamol 650 mg (usual dose 1-0-1 · After food · 3 days). */
async function openParacetamol(page: Page) {
  const r = rx(page);
  await r.search.scrollIntoViewIfNeeded();
  await r.search.click();
  await page.keyboard.type("para");
  await page.keyboard.press("Enter");
  await expect(r.builder.getByRole("heading")).toContainText("Paracetamol 650 mg");
  await expect(r.summary).toHaveText("1-0-1 · After food · 3 days");
  return r;
}

test("M-VITALS: a critical reading behind three high ones is shown first, inline, with an icon, 'critical' and a tint", async ({ page }, testInfo) => {
  await openGallery(page, testInfo);
  const line = page.locator('[data-specimen="Critical behind three high"] [data-vitals="summary"]');
  await line.scrollIntoViewIfNeeded();
  await expect(line.locator("[data-vital-flag]")).toHaveText(["SpO₂ 84% low · critical", "BP 150/95 high", "P 110 high"]);
  const critical = line.locator("[data-vital-critical]");
  await expect(critical.locator("svg")).toHaveCount(1);
  const look = (l: Locator) => l.evaluate((el) => getComputedStyle(el).backgroundColor);
  const high = line.locator('[data-vital-flag="high"]').first();
  expect(await look(critical)).not.toBe(await look(high));
  expect(await look(high)).toBe("rgba(0, 0, 0, 0)");
  // The popover still lists all four.
  await line.click();
  await expect(page.getByRole("dialog").getByRole("listitem")).toHaveCount(4);
});

test("M-RXKEYS: the help names each key's frequency, each tile shows its key, and the key picks exactly that tile", async ({ page }, testInfo) => {
  await openGallery(page, testInfo);
  const r = await openParacetamol(page);
  const help = await r.search.evaluate((el) => document.getElementById(el.getAttribute("aria-describedby") ?? "")?.textContent ?? "");
  const pairs = [...help.matchAll(/(\d) for ([^,.]+)/g)].map((m) => [m[1], m[2].trim()] as const);
  expect(pairs).toEqual([
    ["1", "1-0-1"],
    ["2", "1-0-0"],
    ["3", "0-0-1"],
    ["4", "1-1-1"],
    ["5", "SOS"],
  ]);
  for (const [key, frequency] of pairs) {
    const tile = r.builder.getByRole("radio", { name: new RegExp(`^${frequency},`) });
    await expect(tile.locator(`[data-frequency-key="${key}"]`)).toBeVisible();
    await page.keyboard.press(key);
    await expect(tile).toHaveAttribute("aria-checked", "true");
    await expect(r.summary).toHaveText(`${frequency} · After food · 3 days`);
    // Backspace undoes the lone frequency key.
    await page.keyboard.press("Backspace");
    await expect(r.summary).toHaveText("1-0-1 · After food · 3 days");
  }
});

test("M-RXKEYS: '5' then Enter adds nothing; '5d' is 5 days with the usual frequency; '25' then Enter asks for the unit", async ({ page }, testInfo) => {
  await openGallery(page, testInfo);
  const r = await openParacetamol(page);
  const before = await r.lines.count();
  await page.keyboard.press("5");
  await page.keyboard.press("Enter");
  await expect(r.alert).toHaveText("5 picked SOS. Type the duration, such as 5d, or choose “Add to prescription”.");
  await expect(r.lines).toHaveCount(before);
  await expect(r.builder).toBeVisible();
  await page.keyboard.press("Escape");

  // "5d": the digit was a duration; the frequency stays the usual one.
  await openParacetamol(page);
  await page.keyboard.press("5");
  await page.keyboard.press("d");
  await expect(r.summary).toHaveText("1-0-1 · After food · 5 days");
  await expect(r.search).toHaveValue("Paracetamol 650 mg");
  await page.keyboard.press("Enter");
  await expect(r.lines).toHaveCount(before + 1);
  const line = r.lines.last();
  await expect(line.getByRole("button", { name: /^1-0-1, morning 1, afternoon 0, night 1\./ })).toBeVisible();
  await expect(line.getByRole("button", { name: /^5 days\./ })).toBeVisible();

  // A number without a unit is not a duration yet.
  await openParacetamol(page);
  await page.keyboard.press("2");
  await page.keyboard.press("5");
  await page.keyboard.press("Enter");
  await expect(r.alert).toHaveText("Add the unit to 5: d, w or m (for example 5d)");
  await expect(r.lines).toHaveCount(before + 1);
  await page.keyboard.press("d");
  await page.keyboard.press("Enter");
  await expect(r.lines).toHaveCount(before + 2);
  await expect(r.lines.last().getByRole("button", { name: /^5 days\./ })).toBeVisible();
});

test("M-RXKEYS: a tap on a duration tile or the stepper beats unfinished typed digits; other keys are refused, the line kept", async ({ page }, testInfo) => {
  await openGallery(page, testInfo);
  const r = await openParacetamol(page);
  const before = await r.lines.count();
  await page.keyboard.press("2");
  await page.keyboard.press("1");
  await expect(r.builder.locator("output")).toHaveText("1…");
  await r.builder.getByRole("radio", { name: "7 days" }).click();
  await expect(r.builder.locator("output")).toHaveText("7 days");
  await expect(r.summary).toHaveText("1-0-0 · After food · 7 days");
  await r.builder.getByRole("button", { name: "Add to prescription" }).click();
  await expect(r.lines).toHaveCount(before + 1);
  await expect(r.lines.last().getByRole("button", { name: /^7 days\./ })).toBeVisible();

  await openParacetamol(page);
  await page.keyboard.press("3");
  await page.keyboard.press("1");
  await r.builder.getByRole("button", { name: "One day more" }).click();
  await expect(r.summary).toHaveText("0-0-1 · After food · 4 days");
  await r.builder.getByRole("button", { name: "Add to prescription" }).click();
  await expect(r.lines.last().getByRole("button", { name: /^4 days\./ })).toBeVisible();

  await openParacetamol(page);
  await page.keyboard.press("2");
  await page.keyboard.press("x");
  await expect(r.alert).toHaveText("Type a duration such as 5d, 2w or 1m, or press Escape to search again");
  await expect(r.search).toHaveValue("Paracetamol 650 mg");
  await expect(r.builder).toBeVisible();
  await expect(r.summary).toHaveText("1-0-0 · After food · 3 days");
});

test("M-PICKER: Enter while a newer search runs does nothing; the answer to what is typed is what Enter acts on", async ({ page }, testInfo) => {
  await openGallery(page, testInfo);
  const picker = group(page, "Patient picker");
  const search = picker.getByRole("combobox", { name: "Patient" });
  const result = picker.locator("[data-picker-result]");
  const options = picker.getByRole("listbox", { name: "Patients" }).getByRole("option");
  await search.scrollIntoViewIfNeeded();
  await search.click();
  await page.keyboard.type("900000000");
  await expect(options).toHaveCount(5);
  // "…0002" is typed and Enter pressed at once: the five rows of "900000000" are not what the field holds any more.
  await page.keyboard.type("2");
  await page.keyboard.press("Enter");
  await expect(options).toHaveCount(1);
  await expect(options.first()).toContainText("Synthetic Patient 02");
  await expect(result).toHaveText("No patient picked");
  await page.keyboard.press("Enter");
  await expect(result).toHaveText("Added Synthetic Patient 02 to the queue");
});

test("M-PICKER: a failed search ends the loading row and says so; Enter does nothing", async ({ page }, testInfo) => {
  await openGallery(page, testInfo);
  const picker = group(page, "Patient picker");
  const search = picker.getByRole("combobox", { name: "Patient" });
  await search.scrollIntoViewIfNeeded();
  await search.click();
  await page.keyboard.type("zz-fail");
  await expect(picker.getByRole("alert")).toHaveText("Couldn't search patients. Try again.");
  await expect(picker.getByRole("progressbar")).toHaveCount(0);
  await page.keyboard.press("Enter");
  await expect(picker.locator("[data-picker-result]")).toHaveText("No patient picked");
  // A new search clears the error.
  await search.fill("synth");
  await expect(picker.getByRole("listbox", { name: "Patients" }).getByRole("option")).toHaveCount(5);
  await expect(picker.getByRole("alert")).toHaveCount(0);
});

test("M-INFANTAGE: 0 years switches to months and asks for them; 1 year is 12 months and reads back as 12 m", async ({ page }, testInfo) => {
  await openGallery(page, testInfo, IST_1130_12_NOV);
  const ageGroup = page.locator("#dates").getByRole("group", { name: "Age or date of birth", exact: true });
  const age = ageGroup.getByRole("textbox", { name: "Age" });
  const unit = ageGroup.getByRole("combobox", { name: "Age unit" });
  const value = page.getByTestId("age-value");
  await age.scrollIntoViewIfNeeded();
  await age.fill("0");
  await expect(unit).toHaveValue("m");
  await expect(age).toHaveValue("");
  await expect(age).toHaveAccessibleDescription("Below 1 year, enter the age in months");
  await expect(value).toHaveText("none");
  await age.fill("8");
  await expect(age).toHaveAccessibleDescription("Born about Mar 2026");
  await expect(value).toHaveText("2026-03-12 (approximate)");

  await unit.selectOption("y");
  await age.fill("1");
  await expect(value).toHaveText("2025-11-12 (approximate)");
  await expect(age).toHaveAccessibleDescription("Born about Nov 2025");
  // The DOB that was derived reads back as the age that was typed.
  const mode = ageGroup.getByRole("radiogroup", { name: "Enter age or date of birth" });
  await mode.getByRole("radio", { name: "Date of birth" }).click();
  const dob = ageGroup.getByRole("textbox", { name: "Date of birth" });
  await dob.fill("12/11/2025");
  await expect(dob).toHaveAccessibleDescription(/12 m/);
});

test("IND L-7: an age set from outside fills the age box (editing a patient), and so does a new outside value", async ({ page }, testInfo) => {
  await openGallery(page, testInfo, IST_1130_12_NOV);
  const editing = page.locator("#dates").getByRole("group", { name: "Patient age (editing)" });
  const age = editing.getByRole("textbox", { name: "Age" });
  await age.scrollIntoViewIfNeeded();
  await expect(age).toHaveValue("42");
  await expect(editing.getByRole("combobox", { name: "Age unit" })).toHaveValue("y");
  await expect(age).toHaveAccessibleDescription("Born about 1984");
  await page.getByRole("button", { name: "Load another patient" }).click();
  await expect(page.getByTestId("age-edit-value")).toHaveText("2026-03-12");
  await expect(age).toHaveValue("8");
  await expect(editing.getByRole("combobox", { name: "Age unit" })).toHaveValue("m");
});

test("IND L-6: no age error while moving inside the age group; a failing save is reported and keeps the input", async ({ page }, testInfo) => {
  await openGallery(page, testInfo);
  const form = page.locator("[data-quick-register]");
  const ageError = form.getByText("Enter an age or a date of birth");
  const toggle = form.getByRole("radiogroup", { name: "Enter age or date of birth" }).getByRole("radio", { name: "Age" });
  await toggle.scrollIntoViewIfNeeded();
  await toggle.focus();
  await page.keyboard.press("Tab");
  await expect(form.getByRole("textbox", { name: "Age" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(form.getByRole("combobox", { name: "Age unit" })).toBeFocused();
  await expect(ageError).toHaveCount(0);
  await form.getByRole("textbox", { name: "Full name" }).click();
  await expect(ageError).toHaveCount(1);

  await form.getByRole("textbox", { name: "Mobile number" }).fill("9000000999");
  await form.getByRole("textbox", { name: "Full name" }).fill("Synthetic Fail 01");
  await form.getByRole("textbox", { name: "Age" }).fill("42");
  await form.getByRole("radio", { name: "Female" }).click();
  await form.getByRole("button", { name: "Register patient" }).click();
  await expect(form.getByRole("alert").filter({ hasText: "Couldn't register" })).toHaveText("Couldn't register the patient. Try again.");
  await expect(form.getByRole("button", { name: "Register patient" })).not.toHaveAttribute("aria-busy", "true");
  await expect(form.getByRole("textbox", { name: "Full name" })).toHaveValue("Synthetic Fail 01");
  await expect(form.getByRole("status").filter({ hasText: "Registered" })).toHaveCount(0);
});

test("IND L-5: a Button with no type inside a form is a submit button: offline it neither clicks nor submits on Enter", async ({ page, context }, testInfo) => {
  await openGallery(page, testInfo);
  const form = page.getByTestId("offline-form-implicit");
  const button = page.getByTestId("offline-submit-implicit");
  const saved = page.getByTestId("offline-saved-implicit");
  await button.scrollIntoViewIfNeeded();
  await context.setOffline(true);
  try {
    await expect(button).toHaveAttribute("aria-disabled", "true");
    await button.click();
    await form.getByRole("textbox", { name: "Note" }).press("Enter");
    await page.waitForTimeout(200);
    await expect(saved).toHaveText("Not saved yet");
  } finally {
    await context.setOffline(false);
  }
  await expect(button).not.toHaveAttribute("aria-disabled", "true");
  await button.click();
  await expect(saved).toHaveText("Saved 1 time");
});
