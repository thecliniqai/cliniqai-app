/**
 * V2-09b 09B-02a: the consult workspace's frame (R-7, 06-UI-SPEC §7), through the real app on the PR projects (desktop-chrome, pixel-7, iphone-15).
 *
 *   - 360 px: the section strip, the Finish bar and the allergy strip are on screen and the shell has no BottomBar (focus mode);
 *   - the allergy strip is still on screen after scrolling to Plan, at 360 and at 1280 (DESIGN_SYSTEM §7.2: never scrolled away), and so is the
 *     section strip on a phone, which follows the scroll and marks the current section;
 *   - Alt+1 to Alt+5 move focus to the section headings, in a text field too;
 *   - no horizontal scroll at 360, 375, 744, 800, 820, 1180 and 1280 px;
 *   - every interactive control of the frame is at least 44 px (and an icon-only one 44 wide) below 1024 px;
 *   - the sections come in the specified order, and from 1180 px each has its label column.
 * 09B-02b adds the context panes (R-7, PWA-03b): the patient column from 1180 px, the Patient sheet below it (top bar at 768 to 1179, Finish bar below 768),
 * the summary pane from 1280 px (closed to 1439, open from 1440, the toggle's `aria-pressed`), the Summary drawer on a phone, and M, F and ? behind the
 * per-device switch. Synthetic data only.
 */
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { getAdminClient } from "../../helpers/supabase-admin";
import { seedClinicalNotes } from "../../helpers/clinical-notes";
import { run, seedPatient, seedVisit, testTag } from "../support/m0-data";
import { storageStatePath } from "../support/run-data";

test.use({ storageState: storageStatePath("doctor") });

const SECTIONS = [
  { id: "complaints", title: "Complaints" },
  { id: "examination", title: "Examination" },
  { id: "diagnosis", title: "Diagnosis" },
  { id: "prescription", title: "Prescription" },
  { id: "plan", title: "Plan" },
];

async function openConsult(page: Page, width: number, height = 800): Promise<string> {
  const { tenantA } = run();
  const patient = await seedPatient(tenantA.id, tenantA.users.owner.id, `E2E Synthetic Layout ${testTag()}`);
  const { error } = await getAdminClient().from("patients").update({ allergies: ["Penicillin"] }).eq("id", patient.id);
  if (error) throw new Error(error.message);
  const visitId = await seedVisit({
    tenantId: tenantA.id,
    patientId: patient.id,
    doctorId: tenantA.users.doctor.id,
    createdBy: tenantA.users.receptionist.id,
    status: "in_consultation",
  });
  await page.setViewportSize({ width, height });
  await page.goto(`/consultation/${visitId}`);
  await expect(page.locator("[data-consult-workspace]")).toBeVisible();
  return visitId;
}

/** The control is wholly inside the visible viewport. */
async function inViewport(page: Page, locator: Locator): Promise<boolean> {
  const box = await locator.boundingBox();
  const size = page.viewportSize();
  if (!box || !size) return false;
  return box.y >= -0.5 && box.y + box.height <= size.height + 0.5 && box.x >= -0.5 && box.x + box.width <= size.width + 0.5;
}

const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test("360 px: the section strip, Finish bar and allergy strip are on screen, with no BottomBar", async ({ page }) => {
  await openConsult(page, 360, 780);
  await expect(page.locator("[data-section-strip]")).toBeVisible();
  await expect(page.locator("[data-finish-bar]")).toBeVisible();
  await expect(page.locator("[data-allergy-strip]")).toContainText("Allergy: Penicillin");
  await expect(page.locator("[data-app-shell]")).toHaveAttribute("data-bottom-bar", "hidden");
  // The Finish bar holds the one primary action and sits on the bottom edge.
  const finish = page.locator("[data-finish-bar]").getByRole("button", { name: "Finish visit" });
  await expect(finish).toBeVisible();
  expect(await inViewport(page, finish)).toBe(true);
  // The top bar's own copy of the action is not drawn below 768 px: one Finish visit on screen.
  await expect(page.getByRole("button", { name: "Finish visit" })).toHaveCount(1);
});

for (const width of [360, 1280]) {
  test(`${width} px: the allergy strip is still on screen after scrolling to Plan`, async ({ page }) => {
    await openConsult(page, width, width === 360 ? 780 : 800);
    const strip = page.locator("[data-allergy-strip]");
    expect(await inViewport(page, strip)).toBe(true);
    await page.locator("#plan").scrollIntoViewIfNeeded();
    await page.locator("#plan").evaluate((el) => el.scrollIntoView({ block: "start" }));
    await expect(page.locator("#plan-title")).toBeInViewport();
    expect(await inViewport(page, strip)).toBe(true);
    await expect(strip).toContainText("Allergy: Penicillin");
  });
}

test("360 px: the section strip follows the scroll and a tap moves focus to the section", async ({ page }) => {
  await openConsult(page, 360, 780);
  const strip = page.locator("[data-section-strip]");
  await expect(strip.getByRole("button", { name: /^Complaints/ })).toHaveAttribute("aria-current", "true");
  await strip.getByRole("button", { name: /^Plan/ }).click();
  await expect(page.locator("#plan-title")).toBeFocused();
  await expect(page.locator("#plan-title")).toBeInViewport();
  await expect(strip.getByRole("button", { name: /^Plan/ })).toHaveAttribute("aria-current", "true");
  expect(await inViewport(page, strip)).toBe(true);
});

for (const width of [360, 820, 1280]) {
  test(`${width} px: Alt+1 to Alt+5 move focus to the section headings, in a text field too`, async ({ page }) => {
    await openConsult(page, width);
    for (const [index, section] of SECTIONS.entries()) {
      await page.keyboard.press(`Alt+Digit${index + 1}`);
      await expect(page.locator(`#${section.id}-title`), `Alt+${index + 1}`).toBeFocused();
    }
    // From inside the note field.
    await page.getByLabel("History of Present Illness & Clinical Notes").focus();
    await page.keyboard.press("Alt+Digit4");
    await expect(page.locator("#prescription-title")).toBeFocused();
    // Alt+6 is not a section shortcut.
    await page.keyboard.press("Alt+Digit6");
    await expect(page.locator("#prescription-title")).toBeFocused();
  });
}

test("the five sections are in the specified order, each with its heading", async ({ page }) => {
  await openConsult(page, 1280);
  const ids = await page.locator("[data-consult-section]").evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-consult-section")));
  expect(ids).toEqual(SECTIONS.map((s) => s.id));
  for (const section of SECTIONS) {
    await expect(page.getByRole("heading", { level: 2, name: section.title, exact: true })).toBeVisible();
  }
});

test("1180 px and up: a label column of 120 px beside each section; 820 px: 96 px", async ({ page }) => {
  await openConsult(page, 1180, 800);
  const widthOfLabel = () => page.locator("#plan-title").evaluate((h) => (h.parentElement as HTMLElement).getBoundingClientRect().width);
  expect(Math.round(await widthOfLabel())).toBe(120);
  await page.setViewportSize({ width: 820, height: 1180 });
  expect(Math.round(await widthOfLabel())).toBe(96);
  await page.setViewportSize({ width: 360, height: 780 });
  // One column: the label sits above the body, as wide as the column.
  expect(await widthOfLabel()).toBeGreaterThan(300);
});

for (const width of [360, 375, 744, 800, 820, 1180, 1280]) {
  test(`no horizontal scroll at ${width} px`, async ({ page }) => {
    await openConsult(page, width, width < 768 ? 780 : 900);
    expect(await noHorizontalScroll(page)).toBe(true);
    // Also with the Plan section (the widest tiles) in view.
    await page.locator("#plan").evaluate((el) => el.scrollIntoView({ block: "start" }));
    expect(await noHorizontalScroll(page)).toBe(true);
  });
}

for (const width of [360, 744, 820]) {
  test(`${width} px: every interactive control of the frame is at least 44 px`, async ({ page }) => {
    await openConsult(page, width, width < 768 ? 780 : 900);
    const controls = page.locator(
      "[data-consult-top-bar] :is(button, a[href]), [data-section-strip] button, [data-finish-bar] :is(button, a[href])",
    );
    const boxes = await controls.evaluateAll((nodes) =>
      nodes
        .filter((n) => {
          const r = n.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        })
        .map((n) => {
          const r = n.getBoundingClientRect();
          return { name: n.getAttribute("aria-label") ?? n.textContent?.trim() ?? n.tagName, w: r.width, h: r.height };
        }),
    );
    expect(boxes.length).toBeGreaterThan(2);
    for (const box of boxes) {
      expect(box.h, `${box.name} height at ${width}px`).toBeGreaterThanOrEqual(43.5);
      expect(box.w, `${box.name} width at ${width}px`).toBeGreaterThanOrEqual(43.5);
    }
  });
}

/* ---------------------------------------------------------------------------------------------------------------------------------------------
 * 09B-02b: the context panes.
 * ------------------------------------------------------------------------------------------------------------------------------------------- */

const widthOf = (locator: Locator) => locator.evaluate((el) => Math.round(el.getBoundingClientRect().width));

test("1180 px: the patient column (264 px) beside the note, with identity, vitals grid, allergies, problems, last visit and history; no Patient button, no Summary", async ({ page }) => {
  await openConsult(page, 1180, 800);
  const column = page.locator("[data-patient-column]");
  await expect(column).toBeVisible();
  expect(await widthOf(column)).toBe(264);
  for (const heading of ["Vitals", "Allergies", "Problems", "Last visit", "History"]) {
    await expect(column.getByRole("heading", { name: new RegExp(`^${heading}`, "i") })).toBeVisible();
  }
  await expect(column).toContainText("Penicillin");
  await expect(column.locator("dl > div")).toHaveCount(6);
  await expect(page.getByRole("button", { name: "Patient", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Summary", exact: true })).toHaveCount(0);
  await expect(page.locator("[data-summary-pane]")).toHaveCount(0);
});

test("the patient column scrolls on its own and is not drawn below 1180 px", async ({ page }) => {
  await openConsult(page, 1180, 800);
  expect(await page.locator("[data-patient-column]").evaluate((el) => getComputedStyle(el).overflowY)).toBe("auto");
  await page.setViewportSize({ width: 1179, height: 800 });
  await expect(page.locator("[data-patient-column]")).toBeHidden();
  await expect(page.getByRole("button", { name: "Patient", exact: true })).toBeVisible();
});

test("820 px: the Patient button opens the patient sheet; Escape closes it and focus returns to the button", async ({ page }) => {
  await openConsult(page, 820, 1000);
  await expect(page.locator("[data-patient-column]")).toBeHidden();
  const button = page.getByRole("button", { name: "Patient", exact: true });
  await button.click();
  const sheet = page.getByRole("dialog", { name: "Patient" });
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText("Penicillin");
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(button).toBeFocused();
});

test("360 px: the Finish bar's Patient button opens the patient context as a drawer; the strip's Summary opens the summary drawer", async ({ page }) => {
  await openConsult(page, 360, 780);
  const patient = page.locator("[data-finish-bar]").getByRole("button", { name: "Patient", exact: true });
  await expect(patient).toBeVisible();
  await patient.click();
  const sheet = page.getByRole("dialog", { name: "Patient" });
  await expect(sheet).toBeVisible();
  // A bottom drawer: it sits on the bottom edge and is as wide as the screen.
  // (After its 240 ms slide-in: poll the settled box.)
  await expect
    .poll(async () => {
      const box = await sheet.boundingBox();
      return box ? { width: Math.round(box.width), bottom: Math.round(box.y + box.height) } : null;
    })
    .toEqual({ width: 360, bottom: 780 });
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await page.locator("[data-section-strip]").getByRole("button", { name: "Summary" }).click();
  // The drawer shows the draft as the patient will see it: with nothing added, the preselected 5-day follow-up is all there is.
  const drawer = page.getByRole("dialog", { name: "Summary" });
  await expect(drawer).toContainText("As the patient will see it");
  await expect(drawer.getByRole("region", { name: "Follow-up" })).toBeVisible();
});

test("1280 px: the Summary toggle opens a 272 px pane that shows the draft as it is typed; closed by default, aria-pressed follows", async ({ page }) => {
  await openConsult(page, 1280, 800);
  const toggle = page.getByRole("button", { name: "Summary", exact: true });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("[data-summary-pane]")).toHaveCount(0);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  const pane = page.locator("[data-summary-pane]");
  await expect(pane).toBeVisible();
  expect(await widthOf(pane)).toBe(272);
  await expect(pane).toContainText("Summary · as the patient will see it");
  // What the doctor taps appears at once, from the in-memory draft.
  await page.getByRole("button", { name: /\+ Steam inhalation twice daily/ }).click();
  await expect(pane.getByRole("region", { name: "Advice" })).toContainText("Steam inhalation twice daily");
  // The follow-up date (5 days preselected) is shown in the clinic zone with its weekday.
  await expect(pane.getByRole("region", { name: "Follow-up" })).toContainText(/^Follow-up\s*(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{1,2} \w{3} \d{4}$/);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(pane).toHaveCount(0);
});

test("1440 px: the summary pane is open by default; the note column keeps its room", async ({ page }) => {
  await openConsult(page, 1440, 900);
  await expect(page.getByRole("button", { name: "Summary", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-summary-pane]")).toBeVisible();
  await expect(page.locator("[data-patient-column]")).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(true);
  expect(await widthOf(page.locator("[data-note-scroll]"))).toBeGreaterThanOrEqual(640);
});

test("vitals in the patient column follow the draft, and an out-of-range value carries its word when the clinic has the vitals flags", async ({ page }) => {
  const { tenantA } = run();
  const patient = await seedPatient(tenantA.id, tenantA.users.owner.id, `E2E Synthetic Flags ${testTag()}`);
  const visitId = await seedVisit({
    tenantId: tenantA.id,
    patientId: patient.id,
    doctorId: tenantA.users.doctor.id,
    createdBy: tenantA.users.receptionist.id,
    status: "in_consultation",
  });
  await seedClinicalNotes(visitId, { vitals: { systolic: 164, diastolic: 96, pulse: 72, temperature: 98.4, spo2: 97, weight: 70 } });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/consultation/${visitId}`);
  const column = page.locator("[data-patient-column]");
  await expect(column.locator("dl")).toContainText("164/96");
  await expect(column.locator("dl")).toContainText("72");
  // The flag word is drawn only with `assist.vitals` (Smart Assist, resolved on the server); the trial tenant of the e2e run holds it.
  await expect(column.locator("dl > div").filter({ hasText: "BP" })).toContainText("· high");
  await expect(column.locator("dl > div").filter({ hasText: "Pulse" })).not.toContainText("· high");
});

test.describe("single-key shortcuts behind the per-device switch (R-7)", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("clinicos.pref.shortcuts", "on"));
  });

  test("M focuses the medicine search, ? lists the shortcuts, F opens Finish; none of them act inside a field", async ({ page }) => {
    await openConsult(page, 1280, 800);
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("m");
    await expect(page.locator("#medicine-search-input")).toBeFocused();
    // Typing "f" and "?" in the focused search is text, not a shortcut.
    await page.keyboard.type("f?");
    await expect(page.locator("#medicine-search-input")).toHaveValue("f?");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.locator("#medicine-search-input").fill("");
    await page.locator("[data-note-scroll]").evaluate((el) => (el as HTMLElement).blur());
    await page.locator("#complaints-title").focus();
    await page.keyboard.press("Shift+Slash");
    const list = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await expect(list).toBeVisible();
    await expect(list).toContainText("Jump to a section");
    await expect(list).toContainText("Finish visit");
    await page.keyboard.press("Escape");
    await expect(list).toBeHidden();
    await page.locator("#complaints-title").focus();
    await page.keyboard.press("f");
    await expect(page.getByRole("dialog", { name: "Complete & Sign Consultation" })).toBeVisible();
  });

  test("with the switch off, M and F are left alone and ? still opens the list", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("clinicos.pref.shortcuts", "off"));
    await openConsult(page, 1280, 800);
    await page.locator("#complaints-title").focus();
    await page.keyboard.press("m");
    await page.keyboard.press("f");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.keyboard.press("Shift+Slash");
    await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
  });
});
