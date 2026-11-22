/**
 * The amendment screens (V2-09a 09A-05, R-16; CLAUDE.md DoD 3; DESIGN_SYSTEM): the sealed consultation workspace with its signed chip
 * and Amend action, the open "Reopen Visit for Clinical Amendment" dialog, and the amending state (banner, Save Draft, Finalize
 * amendment and its confirmation) at 360, 820 and 1280 px.
 *
 * What is asserted, through the real app:
 *   - the new surfaces (the header actions and chip, the dialogs, the banner) have no serious or critical axe violation: ZERO, scoped
 *     with `include`; the rest of /consultation/[id] is the v1 workspace V2-09b rebuilds, so for the page as a whole the rule is the one
 *     of the other consult screens: no serious/critical rule id the M0 baseline (02-03b) did not already have on this route;
 *   - keyboard: the Amend button opens the dialog, focus moves into it, Escape closes it and focus returns to Amend; a reason typed by
 *     keyboard enables the confirm button, which a keyboard press activates (the banner then shows);
 *   - targets: the Amend, Save draft and Finalize amendment buttons are at least 44 px high, the dialog buttons meet the design system's
 *     button size, and the dialog fits the viewport width (no horizontal scroll inside it).
 * Screenshots and the axe JSON go to test-results/amendment/ for the evidence. Runs on desktop-chrome only (a11y specs own their
 * viewport). Synthetic data only.
 */
import { rxField } from "../support/rx-entry";
import fs from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page, TestInfo } from "@playwright/test";
import { expect, test } from "../fixtures";
import { ROOT } from "../support/app-env";
import { run, seedPatient, seedPrescription, seedSignedConsultation, seedVisit, testTag } from "../support/m0-data";
import { storageStatePath } from "../support/run-data";

const TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const BLOCKING_IMPACTS = new Set(["serious", "critical"]);
const BASELINE_DIR = path.join(ROOT, ".planning/phases/02-ci-e2e-foundations/evidence/m0-baseline/axe");
const OUT_DIR = path.join(ROOT, "test-results/amendment");
const WIDTHS = [
  { width: 360, height: 780 },
  { width: 820, height: 1180 },
  { width: 1280, height: 800 },
];
const REASON = "Added the missing antibiotic after the patient called back";

/** Serious/critical rule ids the M0 baseline recorded on /consultation/[id] on any PR-lane device. */
function baselineRules(): Set<string> {
  const ids = new Set<string>();
  for (const file of fs.readdirSync(BASELINE_DIR).filter((f) => f.endsWith(".json"))) {
    const report = JSON.parse(fs.readFileSync(path.join(BASELINE_DIR, file), "utf8")) as {
      routes: Array<{ route: string; violations: Array<{ id: string; impact: string | null }> }>;
    };
    for (const r of report.routes.filter((x) => x.route === "/consultation/[id]")) {
      for (const v of r.violations) if (BLOCKING_IMPACTS.has(v.impact ?? "")) ids.add(v.id);
    }
  }
  if (ids.size === 0) throw new Error("no M0 baseline axe entry for /consultation/[id]");
  return ids;
}

/** Axe on the page (no rule id beyond the M0 baseline) and, for each new surface, zero serious or critical violations. */
async function check(page: Page, testInfo: TestInfo, name: string, scopes: string[]): Promise<void> {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`), fullPage: false, animations: "disabled", caret: "hide" });
  const whole = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const blocking = whole.violations.filter((v) => BLOCKING_IMPACTS.has(v.impact ?? ""));
  const scoped: Record<string, Array<{ id: string; impact: string | null | undefined; nodes: string[] }>> = {};
  for (const scope of scopes) {
    expect(await page.locator(scope).count(), `scope ${scope} is on the page (${name})`).toBeGreaterThan(0);
    const result = await new AxeBuilder({ page }).withTags(TAGS).include(scope).analyze();
    scoped[scope] = result.violations
      .filter((v) => BLOCKING_IMPACTS.has(v.impact ?? ""))
      .map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.map((n) => n.target.join(" ")) }));
  }
  const summary = {
    screen: name,
    baseline_rules: [...baselineRules()].sort(),
    serious_or_critical_page: blocking.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length })),
    serious_or_critical_scoped: scoped,
  };
  fs.writeFileSync(path.join(OUT_DIR, `${name}.axe.json`), JSON.stringify(summary, null, 2));
  await testInfo.attach(`axe-${name}.json`, { body: JSON.stringify(summary, null, 2), contentType: "application/json" });
  const baseline = baselineRules();
  expect(blocking.map((v) => v.id).filter((id) => !baseline.has(id)), `serious/critical axe rules not in the M0 baseline on ${name}`).toEqual([]);
  for (const [scope, found] of Object.entries(scoped)) expect(found, `serious/critical axe violations in ${scope} on ${name}`).toEqual([]);
}

async function heightOf(locator: Locator): Promise<number> {
  // 09A-06a (flake root cause): the dialog opens with a translate transition, and a box measured mid-transition comes back as 35.99997 px for a 36 px
  // button (float noise of the moving box). Measure after every finite animation on the page has finished.
  await locator.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
  const box = await locator.boundingBox();
  if (!box) throw new Error("control has no box");
  return box.height;
}

async function openAmendDialog(page: Page): Promise<Locator> {
  const amend = page.getByRole("button", { name: "Amend", exact: true });
  await amend.click();
  const dialog = page.getByRole("dialog", { name: "Reopen Visit for Clinical Amendment" });
  await expect(dialog).toBeVisible();
  return dialog;
}

for (const size of WIDTHS) {
  test.describe(`amendment screens at ${size.width}px`, () => {
    test.use({ storageState: storageStatePath("doctor") });

    test(`sealed workspace: signed chip, Amend, nothing editable (${size.width}px)`, async ({ page }, testInfo) => {
      const { visitId } = await seedSignedConsultation("Screens Sealed");
      await page.setViewportSize(size);
      await page.goto(`/consultation/${visitId}`);
      await expect(page.getByTestId("signed-chip")).toContainText("Rx v1");
      // 09A-06a (review B-6): read-only, not disabled, so a keyboard user can reach and scroll the signed notes.
      await expect(page.getByLabel("History of Present Illness & Clinical Notes")).not.toBeEditable();
      const amend = page.getByRole("button", { name: "Amend", exact: true });
      await expect(amend).toBeVisible();
      expect(await heightOf(amend)).toBeGreaterThanOrEqual(44);
      await check(page, testInfo, `sealed-${size.width}`, ["header", '[data-testid="signed-chip"]']);
    });

    test(`amend dialog: keyboard, focus, Escape and the 10-character reason (${size.width}px)`, async ({ page }, testInfo) => {
      const { visitId } = await seedSignedConsultation("Screens Dialog");
      await page.setViewportSize(size);
      await page.goto(`/consultation/${visitId}`);
      const amend = page.getByRole("button", { name: "Amend", exact: true });
      // Keyboard: focus the button and press Enter.
      await amend.focus();
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog", { name: "Reopen Visit for Clinical Amendment" });
      await expect(dialog).toBeVisible();
      // Focus moved into the dialog (on the reason field) and Escape closes it with focus back on Amend.
      await expect(dialog.getByLabel(/Reason for Amendment/)).toBeFocused();
      const box = await dialog.boundingBox();
      expect(box && box.x >= 0 && box.x + box.width <= size.width, "the dialog fits the viewport width").toBe(true);
      const confirm = dialog.getByRole("button", { name: /Confirm & Reopen for Amendment/ });
      await expect(confirm).toBeDisabled();
      expect(await heightOf(confirm)).toBeGreaterThanOrEqual(36);
      await page.keyboard.type("too short");
      await expect(confirm).toBeDisabled();
      await check(page, testInfo, `amend-dialog-${size.width}`, ['[role="dialog"]']);
      // A typed reason is not dropped silently: Escape asks first; "Keep editing" returns to the form with the text intact.
      await page.keyboard.press("Escape");
      const discard = page.getByRole("alertdialog");
      await expect(discard).toBeVisible();
      await discard.getByRole("button", { name: "Keep editing" }).click();
      await expect(dialog.getByLabel(/Reason for Amendment/)).toHaveValue("too short");
      await dialog.getByLabel(/Reason for Amendment/).fill("");
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(amend).toBeFocused();
      // Enabled at 10 characters; a keyboard press on the confirm button reopens the consultation.
      await amend.focus();
      await page.keyboard.press("Enter");
      await expect(dialog).toBeVisible();
      await page.keyboard.type(REASON);
      await expect(confirm).toBeEnabled();
      await confirm.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("status").filter({ hasText: "Amending a signed consultation" })).toBeVisible({ timeout: 30_000 });
    });

    test(`amending: banner, Save draft, Finalize amendment and its confirmation (${size.width}px)`, async ({ page }, testInfo) => {
      const { visitId } = await seedSignedConsultation("Screens Amending");
      await page.setViewportSize(size);
      await page.goto(`/consultation/${visitId}`);
      const dialog = await openAmendDialog(page);
      await dialog.getByLabel(/Reason for Amendment/).fill(REASON);
      await dialog.getByRole("button", { name: /Confirm & Reopen for Amendment/ }).click();
      const banner = page.getByRole("status").filter({ hasText: `Amending a signed consultation (v1 to v2): ${REASON}` });
      await expect(banner).toBeVisible({ timeout: 30_000 });
      await expect(rxField(page.locator("#prescription"))).toBeEnabled();
      const save = page.getByRole("button", { name: "Save draft" });
      const finalize = page.getByRole("button", { name: "Finalize amendment" });
      expect(await heightOf(save)).toBeGreaterThanOrEqual(44);
      expect(await heightOf(finalize)).toBeGreaterThanOrEqual(44);
      await check(page, testInfo, `amending-${size.width}`, ['[data-banner="past-due"]', "header"]);
      // The confirmation: reachable by keyboard, Escape closes it with focus back on the button, then Finalize amendment seals it again.
      await finalize.focus();
      await page.keyboard.press("Enter");
      const confirmDialog = page.getByRole("dialog", { name: "Finalize amendment" });
      await expect(confirmDialog).toBeVisible();
      await check(page, testInfo, `finalize-dialog-${size.width}`, ['[role="dialog"]']);
      await page.keyboard.press("Escape");
      await expect(confirmDialog).toBeHidden();
      await expect(finalize).toBeFocused();
    });
  });
}

/**
 * V2-09a 09A-06a (review B-1, B-3, B-4): the in-session transitions, through real interaction (desktop width; the a11y specs own their viewport).
 *  - B-1: an editor left open while the record becomes sealed (the vitals editor, a drug staged in the builder) does not survive the refresh;
 *  - B-3: after a successful Amend focus lands on the amendment banner, after a successful Finalize on the signed chip (never on <body>);
 *  - B-4: while the Finalize dialog saves and finalizes it cannot be dismissed (Escape, outside click; the Close button is gone).
 */
test.describe("amendment: in-session transitions", () => {
  test.use({ storageState: storageStatePath("doctor") });

  test("B-1: the vitals editor and a staged drug do not survive the sign-off refresh; nothing in #vitals is editable", async ({ page }) => {
    const { tenantA } = run();
    const doctor = tenantA.users.doctor;
    const tag = testTag();
    const patient = await seedPatient(tenantA.id, tenantA.users.owner.id, `E2E Synthetic Session Sign ${tag}`);
    const visitId = await seedVisit({ tenantId: tenantA.id, patientId: patient.id, doctorId: doctor.id, createdBy: tenantA.users.receptionist.id, status: "waiting" });
    await seedPrescription({ tenantId: tenantA.id, visitId, patientId: patient.id, doctorId: doctor.id, medicineName: `E2E Synthetic Session Med ${tag}` });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/consultation/${visitId}`);
    await page.getByLabel("History of Present Illness & Clinical Notes").fill("E2E synthetic note for the in-session sign-off");
    // Open the vitals editor and leave it open.
    await page.locator("#vitals").getByRole("button", { name: "Edit vitals" }).click();
    await expect(page.locator("#vitals input:not([disabled])").first()).toBeVisible();
    await page.locator("#vitals").getByPlaceholder("Sys").fill("120");
    // Stage a drug in the builder (its dose builder open) and leave it staged.
    const staged = `E2E Synthetic Staged ${tag}`;
    const rx = page.locator("#prescription");
    await rxField(rx).fill(staged);
    await expect(rx.getByRole("option", { name: new RegExp(`^Add .${staged}.$`) })).toBeVisible({ timeout: 10_000 });
    await rxField(rx).press("Enter");
    await expect(rx.locator("[data-dose-builder]")).toBeVisible();

    await page.getByRole("button", { name: /Finish visit/ }).first().click();
    const dialog = page.getByRole("dialog", { name: "Complete & Sign Consultation" });
    await dialog.getByRole("button", { name: /Sign & Route to Reception/ }).click();
    await expect(page.getByRole("heading", { name: "Consultation Finalized & Signed" })).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Review Encounter" }).click();

    await expect(page.getByTestId("signed-chip")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("#vitals input")).toHaveCount(0);
    await expect(page.locator("#vitals").getByRole("button", { name: "Edit vitals" })).toHaveCount(0);
    await expect(page.locator("[data-dose-builder]")).toHaveCount(0);
    await expect(page.locator("#prescription input:not([disabled]), #prescription textarea:not([disabled]):not([readonly])")).toHaveCount(0);
  });

  test("B-3 and B-4: focus lands on the banner after Amend and on the signed chip after Finalize; the Finalize dialog holds while it works", async ({ page }) => {
    const { visitId } = await seedSignedConsultation("Session Focus");
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/consultation/${visitId}`);
    const amend = page.getByRole("button", { name: "Amend", exact: true });
    await amend.click();
    const amendDialog = page.getByRole("dialog", { name: "Reopen Visit for Clinical Amendment" });
    await amendDialog.getByLabel(/Reason for Amendment/).fill(REASON);
    await amendDialog.getByRole("button", { name: /Confirm & Reopen for Amendment/ }).click();
    await expect(page.getByTestId("amending-banner")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("amending-banner")).toBeFocused();

    // Slow every server action down, so the dialog's save and finalize phases are long enough to try to dismiss it.
    await page.route(`**/consultation/${visitId}`, async (route) => {
      if (route.request().method() === "POST" && route.request().headers()["next-action"]) await new Promise((r) => setTimeout(r, 2_500));
      await route.continue();
    });
    await page.getByRole("button", { name: "Finalize amendment" }).click();
    const confirm = page.getByRole("dialog", { name: "Finalize amendment" });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "Finalize amendment" }).click();
    // Busy: Escape and an outside click do not dismiss it, and its Close button is gone.
    // (A short timeout: the busy phase lasts several seconds, so a Close button that is still there must fail here, not disappear with the dialog.)
    await expect(confirm.locator("[data-overlay-close]")).toHaveCount(0, { timeout: 1_000 });
    await page.keyboard.press("Escape");
    await page.mouse.click(5, 5);
    await expect(confirm).toBeVisible();
    // It completes: the consultation is sealed again at v2 and focus is on the signed chip.
    await expect(page.getByTestId("signed-chip")).toContainText("Rx v2", { timeout: 30_000 });
    await expect(confirm).toBeHidden();
    await expect(page.getByTestId("signed-chip")).toBeFocused();
  });
});
