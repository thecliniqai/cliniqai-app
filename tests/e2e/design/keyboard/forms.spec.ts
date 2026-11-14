/**
 * Keyboard and focus behaviour of the form primitives (V2-06 06-02a, R-14: real browser on `/dev/ui`, no jsdom;
 * roadmap V2-06 "unit tests for primitives' keyboard and focus behaviour"). Per primitive: Tab order, Enter/Space,
 * roving focus with arrow keys (wrapping) in RadioGroup, SegmentedControl and ChipGroup, Space toggling Checkbox and
 * Switch with `aria-checked`, disabled controls skipped, Field wiring (`aria-describedby`, `aria-invalid`), and the
 * approved focus ring (outline ≥ 2 px in the `ring` token with a positive offset, on the white halo).
 *
 * PR lane, desktop-chrome only (keyboard specs under design/ run there; playwright.config.ts).
 */
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../../fixtures";
import { storageStatePath } from "../../support/run-data";
import { expectFocusRing, focusStyle, tokenColor } from "../support/focus";

test.use({ storageState: storageStatePath("owner") });
test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "keyboard specs run once, on desktop Chromium");
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/dev/ui");
  await expect(page.getByRole("heading", { level: 1, name: "Component gallery" })).toBeVisible();
});

/** Puts the sequential focus starting point on a group's heading (not focusable), so the next Tab enters the group. */
async function startAt(page: Page, groupTitle: string) {
  await page.getByRole("heading", { level: 3, name: groupTitle, exact: true }).click();
}

const group = (page: Page, name: string) => page.getByRole("group", { name, exact: true });

/**
 * Presses a roving-focus key the way a person does: held for 50 ms. Radix moves roving focus in a `setTimeout` and
 * RadioGroup selects on that focus only while an arrow key is still down, so a 0 ms synthetic press (keyup before the
 * move) neither selects nor lets a second press start from the new item. A real key press lasts tens of ms.
 */
async function rove(page: Page, key: "ArrowRight" | "ArrowLeft" | "Home" | "End") {
  await page.keyboard.press(key, { delay: 50 });
}

/** The text of every element an `aria-describedby` names. */
async function description(control: Locator): Promise<string> {
  return control.evaluate((el) =>
    (el.getAttribute("aria-describedby") ?? "")
      .split(/\s+/)
      .filter(Boolean)
      .map((id) => document.getElementById(id)?.textContent?.trim() ?? `<missing ${id}>`)
      .join(" | "),
  );
}

test("Button: Tab reaches it, Enter and Space activate it, disabled and loading buttons are skipped, the ring shows", async ({ page }) => {
  const live = page.getByTestId("button-live");
  const count = page.getByTestId("button-count");
  await startAt(page, "Button · states");
  await page.keyboard.press("Tab");
  await expectFocusRing(live, "live button");

  await page.keyboard.press("Enter");
  await expect(count).toHaveText("Add to queue pressed 1 time");
  await page.keyboard.press("Space");
  await expect(count).toHaveText("Add to queue pressed 2 times");

  // The forced-state specimens are out of the tab order; disabled and loading buttons are skipped.
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("button-after")).toBeFocused();
  await expect(page.getByTestId("button-disabled")).toBeDisabled();
  await expect(page.getByTestId("button-loading")).toHaveAttribute("aria-busy", "true");
  await expect(page.getByTestId("button-loading")).toHaveAccessibleName("Add to queue");
});

test("IconButton: named, ringed, and disabled or loading icon buttons are skipped", async ({ page }) => {
  await startAt(page, "IconButton");
  await page.keyboard.press("Tab");
  const live = page.getByTestId("icon-live");
  await expectFocusRing(live, "icon button");
  await expect(live).toHaveAccessibleName("More actions");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Copy last prescription" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Remove Paracetamol 650 mg" })).toBeFocused();
  // Next stop is the first input: the forced specimens, the disabled and the loading icon buttons are skipped.
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("input-live")).toBeFocused();
});

test("Input and Field: the label names the control, hint and error describe it, invalid is announced, disabled is skipped", async ({ page }) => {
  const live = page.getByTestId("input-live");
  await startAt(page, "Input and Field");
  await page.keyboard.press("Tab");
  await expectFocusRing(live, "input");
  await expect(page.getByLabel("Mobile number", { exact: true })).toHaveAttribute("data-testid", "input-live");
  expect(await description(live)).toBe("Used for WhatsApp receipts");
  await expect(live).not.toHaveAttribute("aria-invalid", /.*/);

  // Tab order: search, fee (adorned), weight (adorned), age (error), read-only id; the disabled input is skipped.
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Search", { exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  const fee = page.getByLabel(/^Consultation fee/);
  await expect(fee).toBeFocused();
  // An adorned input draws the ring around the whole box (input + "₹" block), not on the input inside it.
  const box = fee.locator("xpath=..");
  const boxStyle = await focusStyle(box);
  expect(boxStyle.outlineColor).toBe(tokenColor("--color-ring"));
  expect(boxStyle.outlineWidth).toBeGreaterThanOrEqual(2);
  expect(boxStyle.outlineOffset).toBeGreaterThan(0);
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Weight", { exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  const age = page.getByTestId("input-error");
  await expect(age).toBeFocused();
  await expect(age).toHaveAttribute("aria-invalid", "true");
  expect(await description(age)).toBe("Age must be 0–120");
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Patient ID", { exact: true })).toBeFocused();
  await expect(page.getByLabel("Patient ID", { exact: true })).toHaveAttribute("readonly", "");
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("input-after")).toBeFocused();
  await expect(page.getByTestId("input-disabled")).toBeDisabled();

  // Fixing the value clears the error and the invalid state.
  await age.fill("42");
  await expect(age).not.toHaveAttribute("aria-invalid", /.*/);
  expect(await description(age)).toBe("");
});

test("Textarea and NativeSelect: named by their labels, ringed, error described", async ({ page }) => {
  await startAt(page, "Textarea");
  await page.keyboard.press("Tab");
  const note = page.getByLabel("History note", { exact: true });
  await expectFocusRing(note, "textarea");
  await page.keyboard.press("Tab");
  const advice = page.getByLabel(/^Advice/);
  await expect(advice).toBeFocused();
  await page.keyboard.type("Rest");
  await expect(page.getByText("4/200", { exact: true })).toBeVisible();
  await page.keyboard.press("Tab");
  const reason = page.getByLabel("Reason", { exact: true });
  await expect(reason).toBeFocused();
  expect(await description(reason)).toBe("Enter a reason to prescribe anyway");

  // The disabled textarea is skipped; the select is next.
  await page.keyboard.press("Tab");
  const select = page.getByTestId("select-live");
  await expectFocusRing(select, "select");
  await expect(page.getByRole("combobox", { name: "Doctor", exact: true })).toHaveValue("rao");
  await expect(page.getByRole("combobox", { name: "Visit type", exact: true })).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("combobox", { name: "Room", exact: true })).toBeDisabled();
});

test("Checkbox: Space toggles aria-checked, indeterminate reads mixed, disabled is skipped", async ({ page }) => {
  await startAt(page, "Checkbox");
  await page.keyboard.press("Tab");
  const live = page.getByRole("checkbox", { name: "Send on WhatsApp" });
  await expectFocusRing(live, "checkbox");
  await expect(live).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Space");
  await expect(live).toHaveAttribute("aria-checked", "false");
  await page.keyboard.press("Space");
  await expect(live).toHaveAttribute("aria-checked", "true");

  await page.keyboard.press("Tab");
  const second = page.getByRole("checkbox", { name: "Print a copy" });
  await expect(second).toBeFocused();
  await page.keyboard.press("Space");
  await expect(second).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("checkbox", { name: "All reminders" })).toHaveAttribute("aria-checked", "mixed");
  // Disabled and the forced focus specimen are skipped: next stop is the radio group's checked option.
  await page.keyboard.press("Tab");
  await expect(page.getByRole("radio", { name: "Cash" })).toBeFocused();
  await expect(page.getByRole("checkbox", { name: "Email (not set up)" })).toBeDisabled();

  // Clicking the label text toggles too (the row is the target).
  await page.getByText("Print a copy", { exact: true }).click();
  await expect(second).toHaveAttribute("aria-checked", "false");
});

test("RadioGroup: Tab enters on the checked option, arrows move and select, skip disabled and wrap", async ({ page }) => {
  await startAt(page, "RadioGroup");
  await page.keyboard.press("Tab");
  const cash = page.getByRole("radio", { name: "Cash" });
  const upi = page.getByRole("radio", { name: "UPI" });
  const insurance = page.getByRole("radio", { name: "Insurance" });
  await expect(page.getByRole("radiogroup", { name: "Payment mode" })).toBeVisible();
  await expectFocusRing(cash, "radio");
  await expect(cash).toHaveAttribute("aria-checked", "true");

  await rove(page, "ArrowRight");
  await expect(upi).toBeFocused();
  await expect(upi).toHaveAttribute("aria-checked", "true");
  await expect(cash).toHaveAttribute("aria-checked", "false");
  await rove(page, "ArrowRight"); // Card is disabled: skipped
  await expect(insurance).toBeFocused();
  await expect(insurance).toHaveAttribute("aria-checked", "true");
  await rove(page, "ArrowRight"); // wraps
  await expect(cash).toBeFocused();
  await expect(cash).toHaveAttribute("aria-checked", "true");
  await rove(page, "ArrowLeft"); // wraps back
  await expect(insurance).toBeFocused();

  // One tab stop for the group: the next Tab leaves it.
  await page.keyboard.press("Tab");
  await expect(page.getByRole("switch", { name: "Collect at desk" })).toBeFocused();
});

test("Switch: Space and Enter toggle aria-checked; disabled is skipped", async ({ page }) => {
  await startAt(page, "Switch");
  await page.keyboard.press("Tab");
  const live = page.getByRole("switch", { name: "Collect at desk" });
  await expectFocusRing(live, "switch");
  await expect(live).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Space");
  await expect(live).toHaveAttribute("aria-checked", "false");
  await page.keyboard.press("Enter");
  await expect(live).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("switch", { name: "Send reminders" })).toBeFocused();
  await page.keyboard.press("Tab"); // the disabled switch is skipped
  await expect(page.getByRole("radio", { name: /^Waiting/ })).toBeFocused();
  await expect(page.getByRole("switch", { name: "Online booking (not set up)" })).toBeDisabled();
});

test("SegmentedControl: a radiogroup; arrows move and select, wrapping; one tab stop", async ({ page }) => {
  await startAt(page, "SegmentedControl");
  await page.keyboard.press("Tab");
  const lane = page.getByRole("radiogroup", { name: "Lane" });
  const waiting = lane.getByRole("radio", { name: /^Waiting/ });
  await expectFocusRing(waiting, "segment");
  await expect(waiting).toHaveAttribute("aria-checked", "true");
  await rove(page, "ArrowRight");
  await expect(lane.getByRole("radio", { name: /^Doctor/ })).toHaveAttribute("aria-checked", "true");
  await rove(page, "ArrowRight");
  await rove(page, "ArrowRight"); // wraps from Bill to Booked
  const booked = lane.getByRole("radio", { name: /^Booked/ });
  await expect(booked).toBeFocused();
  await expect(booked).toHaveAttribute("aria-checked", "true");
  await expect(waiting).toHaveAttribute("aria-checked", "false");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("radiogroup", { name: "Temperature unit" }).getByRole("radio", { name: "°F" })).toBeFocused();
});

test("ChipGroup: one tab stop per group; arrows move with wrap, skipping disabled; Space toggles pressed or checked", async ({ page }) => {
  await startAt(page, "ChipGroup");
  await page.keyboard.press("Tab");
  const filters = group(page, "Doctor filter");
  const rao = filters.getByRole("button", { name: /^Dr A Rao/ });
  const all = filters.getByRole("button", { name: /^All/ });
  await expect(filters.locator(":focus")).toHaveCount(1);
  await rove(page, "Home");
  await expectFocusRing(rao, "chip");
  await expect(rao).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Space");
  await expect(rao).toHaveAttribute("aria-pressed", "true");
  await rove(page, "ArrowRight"); // "Dr S Iyer" is disabled: skipped
  await expect(all).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(all).toHaveAttribute("aria-pressed", "false");
  await rove(page, "ArrowRight"); // wraps
  await expect(rao).toBeFocused();

  // Tab moves group to group: complaints (tiles), diagnosis (single tiles), findings, duration (option pills).
  await page.keyboard.press("Tab");
  const complaints = group(page, "Complaints");
  await expect(complaints.locator(":focus")).toHaveCount(1);
  await rove(page, "Home");
  const fever = complaints.getByRole("button", { name: "Fever" });
  await expectFocusRing(fever, "tile");
  await page.keyboard.press("Space");
  await expect(fever).toHaveAttribute("aria-pressed", "true");

  await page.keyboard.press("Tab");
  const diagnosis = page.getByRole("radiogroup", { name: "Diagnosis" });
  await expect(diagnosis.locator(":focus")).toHaveCount(1);
  await page.keyboard.press("Tab");
  await expect(group(page, "Chest findings").locator(":focus")).toHaveCount(1);
  await page.keyboard.press("Tab");
  const duration = page.getByRole("radiogroup", { name: "Duration" });
  await expect(duration.locator(":focus")).toHaveCount(1);
  await rove(page, "Home");
  const oneDay = duration.getByRole("radio", { name: "1 day" });
  await expectFocusRing(oneDay, "option pill");
  await rove(page, "ArrowRight");
  await rove(page, "ArrowRight");
  const fiveDays = duration.getByRole("radio", { name: "5 days" });
  await expect(fiveDays).toBeFocused();
  await page.keyboard.press("Space");
  await expect(fiveDays).toHaveAttribute("aria-checked", "true");
  await expect(duration.getByRole("radio", { name: "3 days" })).toHaveAttribute("aria-checked", "false");
  // A single choice is not cleared by pressing it again.
  await page.keyboard.press("Space");
  await expect(fiveDays).toHaveAttribute("aria-checked", "true");
  await rove(page, "ArrowRight");
  await rove(page, "ArrowRight"); // wraps from "1 week" to "1 day"
  await expect(oneDay).toBeFocused();
});
