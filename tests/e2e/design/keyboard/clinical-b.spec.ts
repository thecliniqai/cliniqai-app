/**
 * Clinical entry patterns on `/dev/ui` (V2-06 06-03b, R-14: real browser, no jsdom; 06-UI-SPEC "06-03b Clinical
 * entry", DESIGN_SYSTEM §7.3, §7.6, §7.9). The plan's cases: the Rx entry sequence completes in the §7.6 keystroke
 * count (type → Enter → digit preset → `5d` → Enter: five keys after the name); PatientPicker typeahead and Enter;
 * VitalsForm Tab order and numeric keyboards. Plus: the page never jumps to an inline combobox (06-02c open item: cmdk
 * scrolled the page to an inline `Command` on mount), ↓ then Enter, the duration shorthand and its error, the tap
 * path, line edit / remove with Undo / allergy override with a reason, vitals flags and errors, quick registration.
 *
 * PR lane, desktop-chrome only (keyboard specs under design/ run there; playwright.config.ts).
 */
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../../fixtures";
import { storageStatePath } from "../../support/run-data";
import { settleAnimations } from "../../support/settle";
import { expectFocusRing } from "../support/focus";

test.use({ storageState: storageStatePath("owner") });

async function openGallery(page: Page, testInfo: { project: { name: string } }, width = 1280) {
  test.skip(testInfo.project.name !== "desktop-chrome", "keyboard specs run once, on desktop Chromium");
  await page.setViewportSize({ width, height: 800 });
  await page.goto("/dev/ui");
  await expect(page.getByRole("heading", { level: 1, name: "Component gallery" })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await settleLayout(page);
}

/**
 * 09E-14a (flake F1: "the page scrolled 1,574 px", reproduced 2 of 12 under CPU load): the gallery is one long page and its sections above the one a case works
 * in finish hydrating and measuring later on a loaded machine; the document then grows above the field while the case runs, the browser's scroll anchoring moves
 * `scrollY` with it, and a `scrollY` taken before that no longer matches the one after. Not a product move (the field stays where it was on the screen). So a case
 * starts only when the document's height has not changed for 600 ms (and two frames have passed), and its `startY` is read after that.
 */
async function settleLayout(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let last = -1;
        let stableSince = performance.now();
        const tick = () => {
          const height = document.documentElement.scrollHeight;
          if (height !== last) {
            last = height;
            stableSince = performance.now();
          }
          if (performance.now() - stableSince >= 600) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );
}

function group(page: Page, title: string): Locator {
  return page.getByRole("group", { name: title, exact: true });
}

function rx(page: Page) {
  const scope = group(page, "Prescription");
  return {
    scope,
    search: scope.getByRole("combobox", { name: "Medicine" }),
    list: scope.getByRole("listbox", { name: "Medicines" }),
    lines: scope.getByRole("list", { name: "Prescription lines" }).getByRole("listitem"),
    builder: scope.locator("[data-dose-builder]"),
  };
}

/** Counts key presses on the page from now on (keydown events that reach the document). */
async function countKeys(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __keys: string[] };
    w.__keys = [];
    document.addEventListener("keydown", (e) => w.__keys.push(e.key), { capture: true });
  });
  return () => page.evaluate(() => (window as unknown as { __keys: string[] }).__keys);
}

test("the gallery loads at the top: no inline Command (cmdk) scrolls the page to itself", async ({ page }, testInfo) => {
  await openGallery(page, testInfo);
  await settleAnimations(page);
  // Before the Command wrapper's fix the page loaded at scrollY 4758 (evidence/06-02c/scroll-probe.txt).
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  // The inline Command specimen (06-02b) mounted with its first option active and did not move the page.
  await expect(page.getByTestId("command-live").locator('[cmdk-item][aria-selected="true"]')).toHaveCount(1);
  // Arrow keys still keep the active option visible, by scrolling the list itself, never the page.
  const r = rx(page);
  await r.search.scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => window.scrollY);
  await r.search.click();
  await page.keyboard.type("a");
  const options = r.list.getByRole("option");
  await expect(options).toHaveCount(9);
  expect(await r.list.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  for (let i = 0; i < 8; i++) await page.keyboard.press("ArrowDown");
  await expect(options.last()).toHaveAttribute("aria-selected", "true");
  const inView = await options.last().evaluate((el) => {
    const l = el.closest("[cmdk-list]")!.getBoundingClientRect();
    const o = el.getBoundingClientRect();
    return o.top >= l.top - 1 && o.bottom <= l.bottom + 1;
  });
  expect(inView, "the active option is inside the list's view").toBe(true);
  expect(await r.list.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(before);
  await page.keyboard.press("Escape");
  await expect(r.search).toHaveValue("");
});

test("Rx entry: type, Enter, a digit preset, 5d, Enter adds the line in five keys and refocuses the search", async ({ page }, testInfo) => {
  await openGallery(page, testInfo);
  const r = rx(page);
  await r.search.scrollIntoViewIfNeeded();
  const startY = await page.evaluate(() => window.scrollY);
  await expect(r.search).toHaveAttribute("aria-expanded", "false");
  await r.search.click();
  await page.keyboard.type("para");
  await expect(r.list).toBeVisible();
  await expect(r.search).toHaveAttribute("aria-expanded", "true");
  // The top match is active and named by aria-activedescendant.
  const first = r.list.getByRole("option").first();
  await expect(first).toHaveAttribute("aria-selected", "true");
  await expect(first).toContainText("Paracetamol 650 mg");
  expect(await r.search.getAttribute("aria-activedescendant")).toBe(await first.getAttribute("id"));

  const keys = await countKeys(page);
  await page.keyboard.press("Enter");
  await expect(r.builder.getByRole("heading")).toContainText("Paracetamol 650 mg");
  await expect(r.search).toBeFocused();
  await expect(r.search).toHaveAttribute("aria-expanded", "false");
  await expect(r.list).toBeHidden();
  // The doctor's usual dose is prefilled; the live summary reads the line.
  await expect(r.builder.locator("[data-dose-summary]")).toHaveText("1-0-1 · After food · 3 days");
  await page.keyboard.press("2");
  await expect(r.builder.getByRole("radio", { name: /^1-0-0,/ })).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("5");
  await page.keyboard.press("d");
  await expect(r.builder.locator("[data-dose-summary]")).toHaveText("1-0-0 · After food · 5 days");
  await page.keyboard.press("Enter");

  expect(await keys(), "keystrokes after the name").toEqual(["Enter", "2", "5", "d", "Enter"]);
  const line = r.lines.last();
  await expect(line).toContainText("Paracetamol 650 mg");
  await expect(line.getByRole("button", { name: "1-0-0, morning 1, afternoon 0, night 0. Edit dose of Paracetamol 650 mg" })).toBeVisible();
  await expect(line.getByRole("button", { name: /^After food\./ })).toBeVisible();
  await expect(line.getByRole("button", { name: /^5 days\./ })).toBeVisible();
  await expect(r.builder).toHaveCount(0);
  await expect(r.search).toBeFocused();
  await expect(r.search).toHaveValue("");
  // The page never moved while the list opened and closed.
  expect(await page.evaluate(() => window.scrollY)).toBe(startY);
});

test("Rx entry: ↓ then Enter picks the second match; 2w and 1m durations; an impossible duration is an error; Escape closes", async ({
  page,
}, testInfo) => {
  await openGallery(page, testInfo);
  const r = rx(page);
  await r.search.scrollIntoViewIfNeeded();
  await r.search.click();
  await page.keyboard.type("cet");
  const options = r.list.getByRole("option");
  await expect(options.first()).toHaveAttribute("aria-selected", "true");
  const second = (await options.nth(1).locator("span.font-medium").innerText()).trim();
  await page.keyboard.press("ArrowDown");
  await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
  expect(await r.search.getAttribute("aria-activedescendant")).toBe(await options.nth(1).getAttribute("id"));
  await page.keyboard.press("Enter");
  await expect(r.builder.getByRole("heading")).toContainText(second);
  // The first digit is the frequency preset; the next digits start the duration.
  await page.keyboard.press("3");
  await expect(r.builder.getByRole("radio", { name: /^0-0-1,/ })).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("2");
  await page.keyboard.press("w");
  await expect(r.builder.locator("output")).toHaveText("14 days");
  await expect(r.builder.getByRole("radio", { name: "14 days" })).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("1");
  await expect(r.builder.locator("output")).toHaveText("1…");
  await page.keyboard.press("m");
  await expect(r.builder.locator("output")).toHaveText("30 days");
  await page.keyboard.press("0");
  await page.keyboard.press("d");
  await expect(r.builder.getByRole("alert")).toHaveText("Enter a duration from 1 to 365 days");
  // Backspace edits the typed digits; Escape closes the builder and empties the search, focus stays.
  await page.keyboard.press("Escape");
  await expect(r.builder).toHaveCount(0);
  await expect(r.search).toHaveValue("");
  await expect(r.search).toBeFocused();
});

test("Rx entry: no match offers 'Add “…”'; the tap path sets every field; Tab walks into the builder", async ({ page }, testInfo) => {
  await openGallery(page, testInfo);
  const r = rx(page);
  await r.search.scrollIntoViewIfNeeded();
  await r.search.click();
  await page.keyboard.type("Zinc oxide paste");
  await expect(r.list.getByRole("group", { name: "No medicine matches “Zinc oxide paste”" })).toBeVisible();
  const create = r.list.getByRole("option", { name: "Add “Zinc oxide paste”" });
  await expect(create).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect(r.builder.getByRole("heading")).toContainText("Zinc oxide paste");
  // Tap path: tiles and the stepper.
  await r.builder.getByRole("radio", { name: /^SOS,/ }).click();
  await r.builder.getByRole("radio", { name: "Before food" }).click();
  await r.builder.getByRole("radio", { name: "7 days" }).click();
  await r.builder.getByRole("button", { name: "One day more" }).click();
  await expect(r.builder.locator("[data-dose-summary]")).toHaveText("SOS · Before food · 8 days");
  await expect(r.builder.getByRole("radio", { name: "7 days" })).toHaveAttribute("aria-checked", "false");
  // Keyboard into the builder: Tab from the search reaches the frequency tiles with the visible ring.
  await r.search.focus();
  await page.keyboard.press("Tab");
  await expect(r.builder.getByRole("button", { name: "Close dose builder" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expectFocusRing(r.builder.getByRole("radio", { name: /^SOS,/ }), "checked frequency tile");
  await r.builder.getByRole("textbox", { name: "Instruction" }).fill("Apply twice a day");
  await r.builder.getByRole("button", { name: "Add to prescription" }).click();
  const line = r.lines.last();
  await expect(line).toContainText("Zinc oxide paste");
  await expect(line).toContainText("Apply twice a day");
  await expect(line.getByRole("button", { name: "SOS, when needed. Edit dose of Zinc oxide paste" })).toBeVisible();
});

test("Rx lines: edit a dose in the sheet, remove with an 8 s Undo, an allergy match needs a reason", async ({ page }, testInfo) => {
  await openGallery(page, testInfo);
  const r = rx(page);
  const telmisartan = r.lines.filter({ hasText: "Telmisartan 40 mg" });
  await telmisartan.scrollIntoViewIfNeeded();
  await expect(telmisartan.getByText("Repeated")).toBeVisible();
  const pill = telmisartan.getByRole("button", { name: "1-0-0, morning 1, afternoon 0, night 0. Edit dose of Telmisartan 40 mg" });
  await pill.focus();
  await expectFocusRing(pill, "frequency pill");
  await page.keyboard.press("Enter");
  const sheet = page.getByRole("dialog", { name: "Edit dose" });
  await expect(sheet).toBeVisible();
  await sheet.getByRole("radio", { name: /^1-0-1,/ }).click();
  await sheet.getByRole("button", { name: "Update line" }).click();
  await expect(sheet).toHaveCount(0);
  await expect(telmisartan.getByRole("button", { name: /^1-0-1, morning 1, afternoon 0, night 1\./ })).toBeVisible();
  await expect(telmisartan.getByText("Repeated")).toHaveCount(0);

  // Remove acts at once and offers Undo for 8 s.
  await telmisartan.getByRole("button", { name: "Remove Telmisartan 40 mg" }).click();
  await expect(r.lines.filter({ hasText: "Telmisartan 40 mg" })).toHaveCount(0);
  const toast = page.getByRole("status").filter({ hasText: "Telmisartan 40 mg removed" });
  await expect(toast).toBeVisible();
  await toast.getByRole("button", { name: "Undo" }).click();
  await expect(r.lines.filter({ hasText: "Telmisartan 40 mg" })).toHaveCount(1);

  // Allergy match: flagged until overridden with a reason.
  const amox = r.lines.filter({ hasText: "Amoxicillin 500 mg" });
  await expect(amox).toHaveAttribute("data-flagged", "true");
  await expect(amox).toContainText("Matches allergy: Penicillin");
  await amox.getByRole("button", { name: "Prescribe anyway…" }).click();
  const reason = amox.getByRole("textbox", { name: "Reason to prescribe anyway" });
  await expect(reason).toBeFocused();
  await page.keyboard.press("Enter");
  // V2-09c 09C-02 (Q-4): the reason has a 5-character minimum; the message names it.
  await expect(amox.getByText("Give a reason of at least 5 characters to prescribe despite the allergy")).toBeVisible();
  await expect(reason).toHaveAttribute("aria-invalid", "true");
  await reason.fill("Tolerated before, documented");
  await page.keyboard.press("Enter");
  await expect(amox).not.toHaveAttribute("data-flagged", "true");
});

test("PatientPicker: typeahead by digits and name with a loading row, Enter acts, no match offers registration", async ({ page }, testInfo) => {
  await openGallery(page, testInfo);
  const picker = group(page, "Patient picker");
  const search = picker.getByRole("combobox", { name: "Patient" });
  const result = picker.locator("[data-picker-result]");
  await search.scrollIntoViewIfNeeded();
  const startY = await page.evaluate(() => window.scrollY);
  await search.click();
  await page.keyboard.type("0317");
  await expect(picker.getByRole("progressbar", { name: "Searching patients…" })).toBeVisible();
  const options = picker.getByRole("listbox", { name: "Patients" }).getByRole("option");
  await expect(options).toHaveCount(1);
  await expect(picker.getByRole("progressbar")).toHaveCount(0);
  await expect(options.first()).toContainText("Synthetic Patient 03");
  await expect(options.first()).toContainText("+91 ••••• •0317");
  await expect(options.first()).toContainText("Last visit 28 Oct");
  await expect(options.first()).toContainText("Add to queue");
  await expect(picker).not.toContainText("9000000317");
  await expect(picker.getByRole("status").filter({ hasText: /^\d+ patients?$/ })).toHaveText("1 patient");
  await page.keyboard.press("Enter");
  await expect(result).toHaveText("Added Synthetic Patient 03 to the queue");

  // Name typeahead; ↓ moves; Enter acts on the active row.
  await search.fill("");
  await search.click();
  await page.keyboard.type("synth");
  await expect(options).toHaveCount(5);
  await page.keyboard.press("ArrowDown");
  await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect(result).toHaveText("Added Synthetic Patient 02 to the queue");
  // A 30-character name in a row is not truncated.
  await search.fill("long");
  await expect(options).toHaveCount(1);
  expect(await options.first().locator("[data-patient-name]").evaluate((el) => el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight + 1)).toBe(true);

  await search.fill("");
  await search.click();
  await page.keyboard.type("9876");
  await expect(picker.getByRole("group", { name: "No patient matches “9876”" })).toBeVisible();
  await expect(picker.getByRole("option", { name: "Register as new patient" })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect(result).toHaveText("Register as new patient: 9876");
  await page.keyboard.press("Escape");
  await expect(search).toHaveValue("");
  await expect(search).toHaveAttribute("aria-expanded", "false");
  expect(await page.evaluate(() => window.scrollY)).toBe(startY);
});

test("VitalsForm: Tab order, numeric keyboards, Enter to the next field, flags in words, errors block only implausible values", async ({
  page,
}, testInfo) => {
  await openGallery(page, testInfo);
  const form = page.locator("[data-vitals-form]");
  const systolic = form.getByRole("textbox", { name: "Systolic" });
  await systolic.scrollIntoViewIfNeeded();
  await systolic.focus();
  const order: string[] = [];
  for (let i = 0; i < 12; i++) {
    order.push(
      await page.evaluate(() => {
        const el = document.activeElement as HTMLInputElement;
        const name = el.getAttribute("aria-label") ?? el.labels?.[0]?.textContent ?? el.textContent ?? "";
        return `${el.getAttribute("role") ?? el.tagName.toLowerCase()}:${name.trim()}`;
      }),
    );
    await page.keyboard.press("Tab");
  }
  expect(order).toEqual([
    "input:Systolic",
    "input:Diastolic",
    "input:Pulse",
    "input:Temperature",
    "radio:°F",
    "input:SpO₂",
    "input:Resp. rate",
    "input:Weight",
    "input:Height",
    "input:Blood sugar",
    "radio:Random",
    "button:Save vitals",
  ]);

  // Numeric keypads: numeric for whole numbers, decimal for temperature, weight and height.
  const modes = await form.locator("input[data-vital]").evaluateAll((els) => els.map((el) => [el.getAttribute("aria-label") ?? el.id, el.getAttribute("inputmode"), el.getAttribute("enterkeyhint")]));
  expect(modes.map(([, m]) => m)).toEqual(["numeric", "numeric", "numeric", "decimal", "numeric", "numeric", "decimal", "decimal", "numeric"]);
  expect(modes.map(([, , e]) => e)).toEqual(["next", "next", "next", "next", "next", "next", "next", "next", "done"]);

  // Enter moves to the next field.
  await systolic.focus();
  await page.keyboard.type("150");
  await page.keyboard.press("Enter");
  await expect(form.getByRole("textbox", { name: "Diastolic" })).toBeFocused();
  await page.keyboard.type("95");
  await page.keyboard.press("Enter");
  await expect(form.getByRole("textbox", { name: "Pulse" })).toBeFocused();
  await expect(form.locator("[data-vital-message]").first()).toHaveText("Systolic High");
  await expect(form.locator("[data-vital-message=flag]")).toHaveText(["Systolic High", "Diastolic High"]);
  await page.keyboard.type("88");
  await page.keyboard.press("Enter");
  await page.keyboard.type("98.6");
  await page.keyboard.press("Enter");
  await expect(form.getByRole("textbox", { name: "SpO₂" })).toBeFocused();
  await page.keyboard.type("88");
  await page.keyboard.press("Enter");
  const spo2Msg = form.locator(`[id="${await form.getByRole("textbox", { name: "SpO₂" }).getAttribute("aria-describedby")}"]`);
  await expect(spo2Msg).toHaveText("Low · critical");
  await expect(spo2Msg.locator("[data-vital-message]")).toHaveAttribute("data-vital-message", "critical");
  await page.keyboard.type("18");
  await page.keyboard.press("Enter");
  await page.keyboard.type("78");
  await page.keyboard.press("Enter");
  await page.keyboard.type("170");
  await expect(form.locator("[data-bmi]")).toHaveText("BMI 27.0 · Overweight");

  // °C switch converts the reading.
  await form.getByRole("radio", { name: "°C" }).click();
  await expect(form.getByRole("textbox", { name: "Temperature" })).toHaveValue("37");
  await form.getByRole("radio", { name: "°F" }).click();
  await expect(form.getByRole("textbox", { name: "Temperature" })).toHaveValue("98.6");

  // An implausible value blocks the save: summary, error on the field, focus on it.
  await systolic.fill("1500");
  await form.getByRole("button", { name: "Save vitals" }).click();
  await expect(form.getByRole("alert").filter({ hasText: "Fix" })).toContainText("Fix 1 value before saving");
  await expect(systolic).toBeFocused();
  await expect(systolic).toHaveAttribute("aria-invalid", "true");
  await expect(form.locator("[data-vital-message=error]")).toHaveText("Systolic: Enter a value between 40 and 300");
  // Fixed: flags never block; the save posts the reading in °F.
  await systolic.fill("150");
  await form.getByRole("textbox", { name: "Blood sugar" }).focus();
  await page.keyboard.type("130");
  await page.keyboard.press("Enter");
  await expect(form.getByRole("status").filter({ hasText: "Vitals saved" })).toHaveText("Vitals saved");
  const saved = JSON.parse((await page.locator("[data-vitals-saved]").textContent()) ?? "{}");
  expect(saved).toEqual({
    systolic: 150,
    diastolic: 95,
    pulse: 88,
    temperatureF: 98.6,
    spo2: 88,
    respRate: 18,
    weight: 78,
    height: 170,
    sugar: 130,
    sugarType: "random",
  });
});

test("QuickRegisterForm: errors focus the first field, duplicate hint, valid submit", async ({ page }, testInfo) => {
  await openGallery(page, testInfo);
  const form = page.locator("[data-quick-register]");
  const submit = form.getByRole("button", { name: "Register patient" });
  await submit.scrollIntoViewIfNeeded();
  await submit.click();
  await expect(form.getByRole("alert").filter({ hasText: "Fix" })).toContainText("Fix 4 fields before registering");
  const phone = form.getByRole("textbox", { name: "Mobile number" });
  await expect(phone).toBeFocused();
  await expect(phone).toHaveAttribute("aria-invalid", "true");
  await expect(form).toContainText("Enter a 10-digit mobile number");
  await expect(form).toContainText("Enter the patient's full name");
  await expect(form).toContainText("Enter an age or a date of birth");
  await expect(form).toContainText("Choose the patient's sex");
  await page.keyboard.type("9000000001");
  // V2-08 08-02: the candidate shows age and sex, the masked mobile and the last visit, so a shared family number stays readable.
  await expect(form.getByRole("status").filter({ hasText: "Same mobile" })).toContainText(
    /Same mobile · Synthetic Patient 01 · 42 y · M · \+91 ••••• •0001 · last visit 3 Aug/,
  );
  await form.getByRole("button", { name: "Use this patient" }).click();
  await expect(page.locator("[data-register-result]")).toHaveText("Using Synthetic Patient 01");
  await phone.fill("9000000999");
  await expect(form.getByRole("status").filter({ hasText: "Same mobile" })).toHaveCount(0);
  // The AI-objection checkbox and its interim notice are part of the form (R-12).
  const objection = form.getByRole("checkbox", { name: "Patient objects to AI-assisted features" });
  await expect(objection).not.toBeChecked();
  await expect(objection).toHaveAccessibleDescription(/Interim wording/);
  await objection.check();
  await form.getByRole("textbox", { name: "Full name" }).fill("Synthetic Patient 09");
  await form.getByRole("textbox", { name: "Age" }).fill("42");
  await form.getByRole("radio", { name: "Female" }).click();
  await submit.click();
  await expect(form.getByRole("status").filter({ hasText: "Registered" })).toHaveText("Registered");
  const values = JSON.parse((await page.locator("[data-register-result]").textContent()) ?? "{}");
  expect(values).toMatchObject({ phone: "9000000999", name: "Synthetic Patient 09", dobApproximate: true, sex: "F", aiObjected: true });
  expect(values.dob).toMatch(/^\d{4}-01-01$/);
});
