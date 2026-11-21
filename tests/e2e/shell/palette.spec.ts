/**
 * Command palette (V2-06 06-04b; IA §3.7, 06-UI-SPEC §6, CD-18…CD-20, R-35, T-06-17).
 *
 * - ⌘K / Ctrl+K opens it; typing a seeded patient's 10-digit mobile number shows that patient (masked phone) first,
 *   and Enter opens their record within 3 key presses after typing (UX counter).
 * - The search route's answer (`GET /api/patients/search`, V2-08 08-02) carries exactly the projection keys per patient: id,
 *   name, age/sex, last four digits, last visit (read from the response on its way to the page; the full number never
 *   reaches the browser).
 * - Groups: Patients · Today queue · Actions · Navigate, no Assist/AI group; an empty query shows Actions and Navigate
 *   only; a receptionist gets no settings action or destination; a queue token match opens the queue.
 * - Escape closes it and focus returns to the opener; nothing is stored on the device; full screen below 768 px;
 *   axe 0 serious/critical with the palette open.
 */
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { readRunData, storageStatePath } from "../support/run-data";
import { seedPatient, seedQueueToken, seedVisit, testTag } from "../support/m0-data";
import { axeShell } from "./support/shell";
import { settleAnimations } from "../support/settle";

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "sets its own viewport; checked once (the palette is width-independent)");
});

const dialog = (page: Page) => page.getByRole("dialog", { name: "Search" });
const input = (page: Page) => dialog(page).getByRole("combobox");
const groupHeadings = (page: Page) =>
  dialog(page)
    .locator("[cmdk-group-heading]")
    .evaluateAll((els) => els.filter((e) => (e as HTMLElement).offsetParent !== null).map((e) => (e.textContent ?? "").trim()));

async function openWithShortcut(page: Page): Promise<void> {
  await page.keyboard.press("ControlOrMeta+k");
  await expect(dialog(page)).toBeVisible();
  await expect(input(page)).toBeFocused();
}

test.describe("owner", () => {
  test.use({ storageState: storageStatePath("owner") });

  test("Ctrl+K → the seeded patient's mobile number → Enter opens the record in ≤ 3 key presses; four fields only", async ({ page, ux }) => {
    ux.flow("palette-open-patient-by-phone", "Command palette: open a patient by mobile number");
    const { tenantA } = readRunData();
    const name = `E2E Synthetic Palette ${testTag()}`;
    const patient = await seedPatient(tenantA.id, tenantA.users.owner.id, name);
    const digits = patient.phone.slice(-10);

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/today");
    await expect(page.getByRole("main")).toBeVisible();
    // The search route's answers, taken on the way through (route.fetch).
    const bodies: string[] = [];
    await page.route("**/api/patients/search**", async (route) => {
      const response = await route.fetch();
      const body = await response.text();
      bodies.push(body);
      await route.fulfill({ response, body });
    });

    await ux.press(page.locator("body"), "ControlOrMeta+k", "Open the palette");
    await expect(input(page)).toBeFocused();
    await ux.fill(input(page), digits, "Search");
    const row = dialog(page).getByRole("option", { name: new RegExp(name) });
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute("aria-selected", "true");
    await expect(row).toContainText(`•${digits.slice(-4)}`);
    await expect(row).not.toContainText(digits);
    await expect(dialog(page).getByRole("status").filter({ hasText: /result/ })).toHaveText(/^\d+ results?$/);

    const before = ux.counts()?.presses ?? 0;
    await ux.press(input(page), "Enter", "Open the patient");
    await page.waitForURL((url) => url.pathname === `/patients/${patient.id}`);
    ux.done();
    expect((ux.counts()?.presses ?? 0) - before, "key presses after typing").toBeLessThanOrEqual(3);
    await expect(dialog(page)).toHaveCount(0);

    // The patient search's own answer: exactly id, name, ageSex, phoneLast4, lastVisit per patient; no full number anywhere.
    const withPatients = bodies.map((b) => JSON.parse(b) as { patients: Record<string, unknown>[] });
    expect(withPatients.length).toBeGreaterThan(0);
    const mine = withPatients.flatMap((r) => r.patients).filter((p) => p.id === patient.id);
    expect(mine.length).toBeGreaterThan(0);
    for (const p of withPatients.flatMap((r) => r.patients)) expect(Object.keys(p)).toEqual(["id", "name", "ageSex", "phoneLast4", "lastVisit"]);
    expect(mine[0]).toEqual({ id: patient.id, name, ageSex: { age: "40 y", sex: "O" }, phoneLast4: digits.slice(-4), lastVisit: null });
    for (const body of bodies) expect(body).not.toContain(digits);
  });

  test("groups: Actions and Navigate on an empty query, no Assist/AI group; Escape returns focus; nothing stored", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/patients");
    const field = page.getByRole("button", { name: "Search patients, queue and actions" });
    await field.click();
    await expect(input(page)).toBeFocused();
    expect(await groupHeadings(page)).toEqual(["Actions", "Navigate"]);
    await expect(dialog(page).getByRole("option", { name: "Invite staff" })).toBeVisible();
    await expect(dialog(page).getByText(/\bAI\b|Assist|Copilot/)).toHaveCount(0);
    expect(await axeShell(page, testInfo, "palette-open-1280", { include: "[data-overlay=command]" })).toEqual([]);

    await input(page).fill("zzqx-no-such-thing");
    await expect(dialog(page).getByText("No results for “zzqx-no-such-thing”")).toBeVisible();
    await expect(dialog(page).getByText("Try a mobile number, token or name")).toBeVisible();

    const storage = () => page.evaluate(() => [...Object.keys(localStorage), ...Object.keys(sessionStorage)].sort());
    const keysBefore = await storage();
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);
    await expect(field).toBeFocused();
    expect(await storage()).toEqual(keysBefore);
    for (const key of await storage()) expect(key).toMatch(/^clinicos\.pref\./);

    await openWithShortcut(page);
    await expect(input(page)).toHaveValue("");
    expect(await groupHeadings(page)).toEqual(["Actions", "Navigate"]);
  });

  test("a token in today's queue is found by its number and opens Today", async ({ page }) => {
    const { tenantA } = readRunData();
    const p = await seedPatient(tenantA.id, tenantA.users.owner.id, `E2E Synthetic Queue Palette ${testTag()}`);
    const visitId = await seedVisit({
      tenantId: tenantA.id,
      patientId: p.id,
      doctorId: tenantA.users.doctor.id,
      createdBy: tenantA.users.receptionist.id,
      status: "waiting",
    });
    const token = await seedQueueToken(tenantA.id, visitId);

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/patients");
    await openWithShortcut(page);
    await input(page).fill(`T${token}`);
    const row = dialog(page).getByRole("option", { name: new RegExp(`^Token ${token} · `) });
    await expect(row).toBeVisible();
    expect(await groupHeadings(page)).toContain("Today queue");
    await row.click();
    await page.waitForURL((url) => url.pathname === "/today");
  });

  // 06-09c (IND L-3): before, "re" + Enter typed fast (meant for a patient called Rekha) opened "Register patient": the
  // first matching action was the default selection while the patient search ran.
  test("Enter before the answer to what is typed opens nothing; after the answer it acts", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/today");
    await expect(page.getByRole("main")).toBeVisible();
    // Hold the patient search's answer, so the search is still running when Enter is pressed.
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/api/patients/search**", async (route) => {
      await held;
      await route.fallback();
    });
    await openWithShortcut(page);
    await input(page).pressSequentially("re");
    await expect(dialog(page).getByRole("progressbar")).toBeVisible();
    await page.keyboard.press("Enter");
    await page.waitForTimeout(300);
    expect(new URL(page.url()).pathname).toBe("/today");
    await expect(dialog(page)).toBeVisible();
    release();
    await expect(dialog(page).getByRole("progressbar")).toHaveCount(0);
    await expect(dialog(page).getByRole("option", { selected: true })).toHaveCount(1);
    await page.keyboard.press("Enter");
    await expect(dialog(page)).toBeHidden();
    await page.unrouteAll({ behavior: "ignoreErrors" });
  });

  test("below 768 px the palette is full screen with a Close button (opened from the Search button)", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto("/today");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(dialog(page)).toBeVisible();
    await settleAnimations(page);
    const box = await dialog(page).boundingBox();
    expect(box && [box.x, box.y, box.width, Math.round(box.height)]).toEqual([0, 0, 360, 780]);
    expect(await axeShell(page, testInfo, "palette-open-360", { include: "[data-overlay=command]" })).toEqual([]);
    await dialog(page).getByRole("button", { name: "Close" }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Search", exact: true })).toBeFocused();
  });
});

test.describe("receptionist", () => {
  test.use({ storageState: storageStatePath("receptionist") });

  test("a receptionist sees no settings action and no settings destination", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/today");
    await openWithShortcut(page);
    const options = await dialog(page).getByRole("option").allTextContents();
    expect(options.map((o) => o.trim())).toEqual([
      "Register patient",
      "Add walk-in",
      "Book appointment",
      "Today",
      "Schedule",
      "Patients",
      "Visits",
      "Referrals",
    ]);
    for (const settings of ["Invite staff", "Staff & Team", "Clinic Profile", "Subscription & Billing", "Developer Settings", "Billing & Reports"]) {
      await expect(dialog(page).getByRole("option", { name: settings })).toHaveCount(0);
    }
    await input(page).fill("Clinic Profile");
    await expect(dialog(page).getByText("No results for “Clinic Profile”")).toBeVisible();
  });
});
