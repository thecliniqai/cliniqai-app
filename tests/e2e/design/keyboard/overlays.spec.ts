/**
 * Keyboard and focus behaviour of the overlay primitives (V2-06 06-02b, R-14: real browser on `/dev/ui`, no jsdom;
 * 06-UI-SPEC "06-02b Overlays", G3-17). Per component:
 * - Dialog, AlertDialog, Sheet, Drawer and the v1 Modal adapter: focus moves in, Tab and Shift+Tab cycle inside (trap),
 *   Escape and the on-screen Close control close, focus returns to the opener, the page behind leaves the
 *   accessibility tree while open; AlertDialog starts on the safe action and ignores outside clicks; a dirty form asks
 *   "Discard changes?" before closing.
 * - Popover and Tooltip open from keyboard focus and close on Escape; DropdownMenu and Tabs rove with the arrow keys
 *   (wrapping, disabled skipped, typeahead / Home / End); Command filters and Enter runs the active option; toasts
 *   announce through their live roles (status / alert) and errors persist.
 *
 * PR lane, desktop-chrome only (keyboard specs under design/ run there; playwright.config.ts).
 */
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../../fixtures";
import { storageStatePath } from "../../support/run-data";
import { settleAnimations } from "../../support/settle";
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

/** Presses a roving-focus key held for 50 ms, as a person does (Radix moves roving focus in a timeout; 06-02a). */
async function rove(page: Page, key: string) {
  await page.keyboard.press(key, { delay: 50 });
}

/**
 * The focused element's name, the way the specs name controls: `aria-label`, else the text of its `<label for>` (an
 * "Optional" tag dropped), else its text.
 */
async function focusedName(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return "<body>";
    const aria = el.getAttribute("aria-label");
    if (aria) return aria.trim();
    const label = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null;
    if (label) return (label.textContent ?? "").replace(/Optional$/, "").trim();
    return (el.textContent ?? el.tagName).trim();
  });
}

/**
 * Presses Tab (or Shift+Tab) `count` times and records where focus lands; every stop must be inside `container`.
 * Returns the names in order.
 */
async function tabWalk(page: Page, container: Locator, count: number, key = "Tab"): Promise<string[]> {
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    await page.keyboard.press(key);
    const inside = await container.evaluate((el) => el.contains(document.activeElement));
    expect(inside, `${key} #${i + 1} left the overlay (focus on "${await focusedName(page)}")`).toBe(true);
    names.push(await focusedName(page));
  }
  return names;
}

/**
 * Clicks outside an open overlay (on its scrim). First lets one macrotask run in the page: Radix's DismissableLayer
 * starts listening for outside `pointerdown` in a `setTimeout(0)` after the layer mounts or re-renders its listeners,
 * and Chrome runs queued input before timers, so a synthetic click sent the instant an overlay opened could arrive
 * before the listener (7 of 40 clicks missed, 0 of 40 after one turn: evidence/06-02b/flake-scrim-click.txt). A
 * person cannot click within that window; the yield is a sync point, not a sleep.
 */
async function clickOutside(page: Page, x: number, y: number) {
  await page.evaluate(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  await page.mouse.click(x, y);
}

/** The page behind a modal overlay is out of the accessibility tree (aria-hidden by the overlay). */
async function expectBackgroundHidden(page: Page) {
  await expect(page.getByRole("heading", { level: 1, name: "Component gallery" })).toHaveCount(0);
}

async function expectBackgroundBack(page: Page) {
  await expect(page.getByRole("heading", { level: 1, name: "Component gallery" })).toHaveCount(1);
}

test("Dialog: Enter opens it on its first field, Tab and Shift+Tab stay inside, Escape and Close return focus to the opener", async ({ page }) => {
  const opener = page.getByTestId("dialog-open");
  await startAt(page, "Dialog");
  await page.keyboard.press("Tab");
  await expect(opener).toBeFocused();

  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Edit visit reason" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAccessibleDescription(/Synthetic Patient 01 · Token 14/);
  const field = dialog.getByLabel("Reason for visit");
  await expect(field).toBeFocused();
  await expectBackgroundHidden(page);

  // Forward: field → Cancel → Save → Close → back to the field. Backward from the field: Close, Save.
  expect(await tabWalk(page, dialog, 4)).toEqual(["Cancel", "Save", "Close", "Reason for visit"]);
  await expect(field).toBeFocused();
  expect(await tabWalk(page, dialog, 2, "Shift+Tab")).toEqual(["Close", "Save"]);
  await page.keyboard.press("Tab");
  const close = dialog.getByRole("button", { name: "Close", exact: true });
  await expect(close).toBeFocused();
  await expectFocusRing(close, "dialog Close button");

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  await expectBackgroundBack(page);

  // The on-screen Close button.
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await close.click();
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();

  // A clean dialog closes on a scrim click.
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await clickOutside(page, 8, 8);
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test("Dialog with unsaved input: Escape, the scrim and Close ask 'Discard changes?' (safe action first); Keep editing keeps the input", async ({ page }) => {
  const opener = page.getByTestId("dialog-open");
  await opener.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Edit visit reason" });
  const field = dialog.getByLabel("Reason for visit");
  await expect(field).toBeFocused();
  await page.keyboard.type("Cough for 2 days");

  const discard = page.getByRole("alertdialog", { name: "Discard changes?" });
  await page.keyboard.press("Escape");
  await expect(discard).toBeVisible();
  await expect(discard).toHaveAccessibleDescription("Your changes in this form will be lost.");
  await expect(discard.getByRole("button", { name: "Keep editing" })).toBeFocused();
  // Two layers at most: the form dialog stays open under the question.
  await expect(page.locator('[data-overlay="dialog"]')).toBeVisible();

  // Keep editing: back in the form, input intact, focus back where it was.
  await page.keyboard.press("Enter");
  await expect(discard).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(field).toHaveValue("Cough for 2 days");
  await expect(field).toBeFocused();

  // The scrim asks too.
  await clickOutside(page, 8, 8);
  await expect(discard).toBeVisible();
  await discard.getByRole("button", { name: "Keep editing" }).click();
  await expect(dialog).toBeVisible();

  // Close → Discard: both layers go and focus lands on the opener.
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(discard).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(discard.getByRole("button", { name: "Discard" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(discard).toHaveCount(0);
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();

  // Saving closes without asking and reports the value.
  await page.keyboard.press("Enter");
  await expect(field).toBeFocused();
  await expect(field).toHaveValue("");
  await page.keyboard.type("Back pain");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("dialog-outcome")).toHaveText("Saved reason: Back pain");
});

test("AlertDialog: starts on the safe action, traps focus, ignores outside clicks, Escape cancels and returns focus", async ({ page }) => {
  const opener = page.getByTestId("alert-open");
  await opener.focus();
  await page.keyboard.press("Enter");
  const alert = page.getByRole("alertdialog", { name: "Cancel this visit?" });
  await expect(alert).toBeVisible();
  await expect(alert).toHaveAccessibleDescription(/The slot becomes free again/);
  const keep = alert.getByRole("button", { name: "Keep" });
  await expect(keep).toBeFocused();
  await expectFocusRing(keep, "safe action");
  await expectBackgroundHidden(page);

  expect(await tabWalk(page, alert, 2)).toEqual(["Cancel visit", "Keep"]);
  expect(await tabWalk(page, alert, 1, "Shift+Tab")).toEqual(["Cancel visit"]);

  await clickOutside(page, 8, 8);
  await expect(alert, "an outside click does not dismiss a confirmation").toBeVisible();

  await page.keyboard.press("Escape");
  await expect(alert).toHaveCount(0);
  await expect(opener).toBeFocused();
  await expect(page.getByTestId("alert-outcome")).toHaveText("Visit status: Booked");

  // Confirm: the destructive action runs and an 8 s Undo toast announces it.
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await expect(alert.getByRole("button", { name: "Cancel visit" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(alert).toHaveCount(0);
  await expect(page.getByTestId("alert-outcome")).toHaveText("Visit status: Cancelled");
  const toast = page.getByRole("status").filter({ hasText: "Visit cancelled" });
  await expect(toast).toBeVisible();
  await toast.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByTestId("alert-outcome")).toHaveText("Visit status: Booked");
});

test("Sheet (≥ 768 px: right side): opens on its first field, traps focus, asks before discarding, Close and Escape return focus", async ({ page }) => {
  const opener = page.getByTestId("sheet-open");
  await opener.focus();
  await page.keyboard.press("Enter");
  const sheet = page.getByRole("dialog", { name: "Book appointment" });
  await expect(sheet).toBeVisible();
  await expect(sheet).toHaveAccessibleDescription("Synthetic Patient 01 · Dr Rao");
  await settleAnimations(page);
  const box = (await sheet.boundingBox())!;
  expect(Math.round(box.x + box.width), "flush with the right edge").toBe(1280);
  expect(Math.round(box.y), "from the top").toBe(0);
  expect(Math.round(box.height), "full height").toBe(800);
  expect(Math.round(box.width), "`sheet` token width").toBe(448);
  await expect(sheet.locator("[data-drawer-handle]")).toBeHidden();

  // Initial focus on the first field of the body, not the head's Close button.
  await expect(sheet.getByLabel("Patient")).toBeFocused();
  await expectBackgroundHidden(page);
  expect(await tabWalk(page, sheet, 6)).toEqual(["Time", "Note", "Cancel", "Book appointment", "Close", "Patient"]);
  expect(await tabWalk(page, sheet, 1, "Shift+Tab")).toEqual(["Close"]);

  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(opener).toBeFocused();

  // Dirty: the scrim asks first; Discard closes and focus returns to the opener.
  await page.keyboard.press("Enter");
  await sheet.getByLabel("Note").fill("Follow-up after 5 days");
  await clickOutside(page, 40, 400);
  const discard = page.getByRole("alertdialog", { name: "Discard changes?" });
  await expect(discard).toBeVisible();
  await expect(discard.getByRole("button", { name: "Keep editing" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(sheet.getByLabel("Note")).toHaveValue("Follow-up after 5 days");
  await sheet.getByRole("button", { name: "Close", exact: true }).click();
  await discard.getByRole("button", { name: "Discard" }).click();
  await expect(sheet).toHaveCount(0);
  await expect(opener).toBeFocused();

  // The foot's primary action completes the flow.
  await page.keyboard.press("Enter");
  await sheet.getByRole("button", { name: "Book appointment" }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByTestId("sheet-outcome")).toHaveText("Booked 10:30 am");
});

test("Drawer: a bottom sheet with the handle; trapped focus; Close and Escape return focus to the opener", async ({ page }) => {
  const opener = page.getByTestId("drawer-open");
  await opener.focus();
  await page.keyboard.press("Enter");
  const drawer = page.getByRole("dialog", { name: "Record vitals" });
  await expect(drawer).toBeVisible();
  await settleAnimations(page);
  const box = (await drawer.boundingBox())!;
  expect(Math.round(box.y + box.height), "flush with the bottom edge").toBe(800);
  expect(Math.round(box.width), "full width").toBe(1280);
  await expect(drawer.locator("[data-drawer-handle]")).toBeVisible();
  await expect(drawer.locator("[data-drawer-handle]")).toHaveAttribute("aria-hidden", "true");

  await expect(drawer.getByLabel("Pulse")).toBeFocused();
  expect(await tabWalk(page, drawer, 5)).toEqual(["Temperature", "Cancel", "Save vitals", "Close", "Pulse"]);

  await drawer.getByRole("button", { name: "Close", exact: true }).click();
  await expect(drawer).toHaveCount(0);
  await expect(opener).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(drawer).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test("Popover: Enter opens it and moves focus inside; Escape closes and returns focus; aria-expanded follows", async ({ page }) => {
  const trigger = page.getByTestId("popover-open");
  await trigger.focus();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("Enter");
  const popover = page.getByRole("dialog", { name: "Queue filters" });
  await expect(popover).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(popover.getByRole("checkbox", { name: "Waiting" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(popover).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");

  await page.keyboard.press("Space");
  await expect(popover).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(popover.getByRole("checkbox", { name: "With doctor" })).toBeFocused();
  await page.keyboard.press("Space");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(popover).toHaveCount(0);
  await expect(page.getByTestId("popover-outcome")).toHaveText("Filters: Waiting, With doctor");
});

test("Tooltip: keyboard focus shows it and describes the control; Escape hides it; hover shows it after the delay", async ({ page }) => {
  // Bring the row into view first: Radix closes a tooltip when its trigger's scroll container scrolls, and a Tab that
  // scrolls the page would close it at once (a keyboard user reaching a control already on screen sees it).
  const filters = page.getByTestId("popover-open");
  await filters.focus();
  await filters.scrollIntoViewIfNeeded();
  await page.keyboard.press("Tab");
  const trigger = page.getByTestId("tooltip-trigger");
  await expect(trigger).toBeFocused();
  const tip = page.getByRole("tooltip");
  await expect(tip).toContainText("Search patients");
  await expect(trigger).toHaveAccessibleName("Search patients");
  // The shortcut hint is decorative (aria-hidden): the description is the label alone.
  await expect(trigger).toHaveAccessibleDescription("Search patients");
  // The visible bubble: Midnight fill, white text, with the shortcut hint.
  const bubble = page.locator('[data-overlay="tooltip"]');
  await expect(bubble).toContainText("Ctrl K");
  const look = await bubble.evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, fg: getComputedStyle(el).color }));
  expect(look).toEqual({ bg: tokenColor("--color-fg"), fg: tokenColor("--color-surface") });

  await page.keyboard.press("Escape");
  await expect(tip).toHaveCount(0);
  await expect(trigger).toBeFocused();

  const print = page.getByRole("button", { name: "Print prescription" });
  await print.hover();
  await expect(page.getByRole("tooltip")).toHaveText("Print prescription");
});

test("DropdownMenu: Enter opens on the first item; arrows wrap and skip disabled items; typeahead; Escape and selection return focus", async ({ page }) => {
  const trigger = page.getByTestId("menu-open");
  await startAt(page, "DropdownMenu");
  await page.keyboard.press("Tab");
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute("aria-haspopup", "menu");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");

  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  const item = (name: string) => menu.getByRole("menuitem", { name });
  await expect(item("Open patient")).toBeFocused();
  const ring = await focusStyle(item("Open patient"));
  expect(ring.outlineColor, "menu rows use the inset ring (CD-12)").toBe(tokenColor("--color-ring"));
  expect(ring.outlineOffset).toBeLessThan(0);

  await rove(page, "ArrowDown");
  await expect(item("Reschedule")).toBeFocused();
  await rove(page, "ArrowDown");
  await expect(item("View prescription"), "the disabled Print receipt is skipped").toBeFocused();
  await expect(item("Print receipt")).toHaveAttribute("aria-disabled", "true");
  await rove(page, "ArrowDown");
  await expect(item("Cancel visit")).toBeFocused();
  await rove(page, "ArrowDown");
  await expect(item("Open patient"), "ArrowDown wraps").toBeFocused();
  await rove(page, "ArrowUp");
  await expect(item("Cancel visit"), "ArrowUp wraps").toBeFocused();
  await rove(page, "r");
  await expect(item("Reschedule"), "typeahead").toBeFocused();

  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");

  await page.keyboard.press("ArrowDown");
  await expect(item("Open patient")).toBeFocused();
  await rove(page, "v");
  await page.keyboard.press("Enter");
  await expect(menu).toHaveCount(0);
  await expect(page.getByTestId("menu-outcome")).toHaveText("Selected: View prescription");
  await expect(trigger).toBeFocused();
});

test("Tabs: arrows move and select (wrapping, disabled skipped), Home and End jump, Tab moves to the panel; route tabs mark the current page", async ({ page }) => {
  const list = page.getByRole("tablist", { name: "Patient record" });
  const tab = (name: string) => list.getByRole("tab", { name });
  await startAt(page, "Tabs");
  await page.keyboard.press("Tab");
  await expect(tab("Overview")).toBeFocused();
  await expect(tab("Overview")).toHaveAttribute("aria-selected", "true");
  const ring = await focusStyle(tab("Overview"));
  expect(ring.outlineColor).toBe(tokenColor("--color-ring"));
  expect(ring.outlineOffset, "inset ring inside the scrolling list").toBeLessThan(0);

  await rove(page, "ArrowRight");
  await expect(tab("Visits")).toBeFocused();
  await expect(tab("Visits")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel", { name: "Visits" })).toHaveText("3 visits this year.");
  await rove(page, "ArrowRight");
  await rove(page, "ArrowRight");
  await expect(tab("Documents"), "the disabled Bills tab is skipped").toBeFocused();
  await rove(page, "ArrowRight");
  await expect(tab("Overview"), "ArrowRight wraps").toBeFocused();
  await rove(page, "End");
  await expect(tab("Documents")).toBeFocused();
  await rove(page, "Home");
  await expect(tab("Overview")).toBeFocused();
  await expect(tab("Overview")).toHaveAttribute("aria-selected", "true");

  await page.keyboard.press("Tab");
  await expect(page.getByRole("tabpanel", { name: "Overview" })).toBeFocused();

  const nav = page.getByRole("navigation", { name: "Settings sections" });
  await expect(nav.getByRole("link", { name: "Clinic" })).toHaveAttribute("aria-current", "page");
  await expect(nav.getByRole("link", { name: "Staff" })).not.toHaveAttribute("aria-current", /.+/);
});

test("Command: a combobox over a listbox; typing filters, arrows move the active option, Enter runs it, no match shows the empty row", async ({ page }) => {
  const box = page.getByTestId("command-live");
  const input = box.getByRole("combobox");
  await input.click();
  await expect(input).toHaveAttribute("aria-expanded", "true");
  const listbox = box.getByRole("listbox");
  await expect(listbox.getByRole("option")).toHaveCount(7);

  await page.keyboard.type("book");
  await expect(listbox.getByRole("option")).toHaveText(["Book appointmentEnter"]);
  const active = listbox.getByRole("option", { selected: true });
  await expect(active).toHaveText("Book appointmentEnter");
  await expect(input).toHaveAttribute("aria-activedescendant", (await active.getAttribute("id"))!);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("command-outcome")).toHaveText("Ran: Book appointment");

  await input.fill("");
  const first = listbox.getByRole("option", { selected: true });
  await expect(first).toHaveText("Add walk-inEnter");
  await expect(input, "the active option follows the query").toHaveAttribute("aria-activedescendant", (await first.getAttribute("id"))!);
  await page.keyboard.press("ArrowDown");
  await expect(listbox.getByRole("option", { selected: true })).toHaveText("Book appointmentEnter");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await expect(listbox.getByRole("option", { selected: true }), "ArrowUp wraps to the last option").toHaveText("Settings");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("command-outcome")).toHaveText("Ran: Settings");

  await input.fill("zzqx");
  await expect(listbox.getByRole("option")).toHaveCount(0);
  await expect(box).toContainText("No results for “zzqx”");
  await expect(box).toContainText("Try a mobile number, token or name");
});

test("Command dialog: opens with the field focused, Escape closes and returns focus to the opener", async ({ page }) => {
  const opener = page.getByTestId("command-dialog-open");
  await opener.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Search" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("combobox")).toBeFocused();
  await page.keyboard.type("billing");
  await expect(dialog.getByRole("option")).toHaveText(["Billing"]);
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("command-outcome")).toHaveText("Ran: Billing");
  await expect(opener).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test("Toasts: confirmations are polite status messages that leave after 4 s; errors are alerts that stay; Undo and Retry act", async ({ page }) => {
  const region = page.locator("section[aria-live=polite]").filter({ has: page.locator("[data-sonner-toaster]") });

  await page.getByTestId("toast-info").click();
  const info = page.getByRole("status").filter({ hasText: "Link copied" });
  await expect(info).toBeVisible();
  await expect(region.getByRole("status").filter({ hasText: "Link copied" })).toHaveCount(1);

  await page.getByTestId("toast-error").click();
  const error = page.getByRole("alert").filter({ hasText: "Couldn't save" });
  await expect(error).toBeVisible();
  await expect(error.getByRole("button", { name: "Retry" })).toBeVisible();
  await expect(error.getByRole("button", { name: "Dismiss" })).toBeVisible();

  // The info toast leaves on its own (4 s); the error is still there afterwards.
  await expect(info).toHaveCount(0, { timeout: 8_000 });
  await expect(error).toBeVisible();

  await error.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByTestId("toast-outcome")).toHaveText("Rx lines: 2 · Retries: 1");
  await expect(error).toHaveCount(0);

  // Undo: the removal is reverted from the toast's action.
  await page.getByTestId("toast-undo").click();
  await expect(page.getByTestId("toast-outcome")).toHaveText("Rx lines: 1 · Retries: 1");
  const undo = page.getByRole("status").filter({ hasText: "Paracetamol 650 mg removed" });
  await undo.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByTestId("toast-outcome")).toHaveText("Rx lines: 2 · Retries: 1");

  // A dismissed error goes away.
  await page.getByTestId("toast-error").click();
  await page.getByRole("alert").filter({ hasText: "Couldn't save" }).getByRole("button", { name: "Dismiss" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Couldn't save" })).toHaveCount(0);
});

test("Modal (v1 adapter): named by its title, focus trapped, Escape and Close return focus to the opener", async ({ page }) => {
  const opener = page.getByTestId("modal-open");
  await opener.focus();
  await page.keyboard.press("Enter");
  const modal = page.getByRole("dialog", { name: "Slot already booked" });
  await expect(modal).toBeVisible();
  await expect(modal).toHaveAccessibleDescription("Synthetic Patient 02 is booked at 10:30 am.");
  await expect(modal.getByRole("button", { name: "Pick another slot" })).toBeFocused();
  await expectBackgroundHidden(page);
  expect(await tabWalk(page, modal, 3)).toEqual(["Book anyway", "Close dialog", "Pick another slot"]);

  await page.keyboard.press("Escape");
  await expect(modal).toHaveCount(0);
  await expect(opener).toBeFocused();

  await page.keyboard.press("Enter");
  await modal.getByRole("button", { name: "Close dialog" }).click();
  await expect(modal).toHaveCount(0);
  await expect(opener).toBeFocused();

  await page.keyboard.press("Enter");
  await modal.getByRole("button", { name: "Book anyway" }).click();
  await expect(modal).toHaveCount(0);
  await expect(page.getByTestId("modal-outcome")).toHaveText("Answer: Overbooked");
});
