/**
 * The Sign & Bill modal after PO-3 (V2-05 plan 05-02b; CLAUDE.md DoD 3; rulings R-6, R-7).
 *
 * Doctors do not collect: for a doctor the modal offers no "collect at the desk" toggle and routes the bill to
 * reception ("Payment at reception" note, "Sign & Route to Reception"); the owner of a solo clinic holds
 * billing:collect and keeps the toggle ("Sign & Collect"). The server refuses a doctor's collection regardless
 * (tests/billing/collect-permission.spec.ts); this spec checks the form at 360, 820 and 1280 px:
 *   - doctor: no checkbox, the note, the routed submit label;
 *   - owner: the toggle (on by default), the collect submit label, and switching it off routes to reception;
 *   - no serious/critical axe rule that the M0 baseline (02-03b) did not already have on /consultation/[id]: BLOCKING on
 *     new rule ids; the counts and a screenshot go to test-results/sign-and-bill/ for the 05-02b evidence.
 * Runs on desktop-chrome only (a11y specs own their viewport). Synthetic data only.
 */
import fs from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page, TestInfo } from "@playwright/test";
import { expect, test } from "../fixtures";
import { ROOT } from "../support/app-env";
import { run, seedPatient, seedVisit, testTag } from "../support/m0-data";
import { storageStatePath } from "../support/run-data";

const TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const BLOCKING_IMPACTS = new Set(["serious", "critical"]);
const BASELINE_DIR = path.join(ROOT, ".planning/phases/02-ci-e2e-foundations/evidence/m0-baseline/axe");
const OUT_DIR = path.join(ROOT, "test-results/sign-and-bill");
const WIDTHS = [
  { width: 360, height: 780 },
  { width: 820, height: 1180 },
  { width: 1280, height: 800 },
];

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

async function openModal(page: Page, doctorId: string, tag: string): Promise<Locator> {
  const { tenantA } = run();
  const patient = await seedPatient(tenantA.id, tenantA.users.owner.id, `E2E Synthetic Sign Bill ${tag}`);
  const visitId = await seedVisit({
    tenantId: tenantA.id,
    patientId: patient.id,
    doctorId,
    createdBy: tenantA.users.receptionist.id,
    status: "in_consultation",
    scheduledAt: new Date().toISOString(),
  });
  await page.goto(`/consultation/${visitId}`);
  await page.getByRole("button", { name: /Complete & Sign/ }).first().click();
  const dialog = page.getByRole("dialog", { name: "Complete & Sign Consultation" });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function check(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`), fullPage: false, animations: "disabled", caret: "hide" });
  const page_ = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const dialog = await new AxeBuilder({ page }).withTags(TAGS).include('[aria-labelledby="sign-bill-title"]').analyze();
  const blocking = page_.violations.filter((v) => BLOCKING_IMPACTS.has(v.impact ?? ""));
  const inDialog = dialog.violations.filter((v) => BLOCKING_IMPACTS.has(v.impact ?? ""));
  const baseline = baselineRules();
  const summary = {
    screen: name,
    baseline_rules: [...baseline].sort(),
    serious_or_critical_page: blocking.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length })),
    serious_or_critical_dialog: inDialog.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.length,
      targets: v.nodes.map((n) => n.target.join(" ")),
    })),
  };
  fs.writeFileSync(path.join(OUT_DIR, `${name}.axe.json`), JSON.stringify(summary, null, 2));
  await testInfo.attach(`axe-${name}.json`, { body: JSON.stringify(summary, null, 2), contentType: "application/json" });
  const newRules = [...blocking, ...inDialog].map((v) => v.id).filter((id) => !baseline.has(id));
  expect(newRules, `serious/critical axe rules not in the M0 baseline on ${name}`).toEqual([]);
  // The 05-02b additions (the reception note, the labelled toggle) add no serious/critical node of their own.
  const touched = inDialog.flatMap((v) => v.nodes.map((n) => n.html)).filter((html) => /role="note"|Payment at reception|sent to the front desk|aria-label="Collect fee/.test(html));
  expect(touched, `serious/critical axe nodes in the 05-02b additions on ${name}`).toEqual([]);
}

for (const size of WIDTHS) {
  test.describe(`Sign & Bill modal at ${size.width}px`, () => {
    test.describe("doctor", () => {
      test.use({ storageState: storageStatePath("doctor") });

      test(`no collection: the bill is routed to reception (${size.width}px)`, async ({ page }, testInfo) => {
        await page.setViewportSize(size);
        const dialog = await openModal(page, run().tenantA.users.doctor.id, testTag());
        await expect(dialog.getByRole("checkbox")).toHaveCount(0);
        await expect(dialog.getByRole("note")).toContainText("Payment at reception");
        await expect(dialog.getByRole("button", { name: /Sign & Route to Reception/ })).toBeVisible();
        await expect(dialog.getByRole("button", { name: /Sign & Collect/ })).toHaveCount(0);
        await expect(dialog.getByRole("button", { name: "Cash" })).toHaveCount(0);
        await check(page, testInfo, `doctor-${size.width}`);
      });
    });

    test.describe("owner (solo clinic, billing:collect)", () => {
      test.use({ storageState: storageStatePath("owner") });

      test(`collects at the desk by default, may route to reception (${size.width}px)`, async ({ page }, testInfo) => {
        await page.setViewportSize(size);
        const dialog = await openModal(page, run().tenantA.users.owner.id, testTag());
        const toggle = dialog.getByRole("checkbox");
        await expect(toggle).toHaveCount(1);
        await expect(toggle).toBeChecked();
        await expect(dialog.getByRole("note")).toHaveCount(0);
        await expect(dialog.getByRole("button", { name: /Sign & Collect/ })).toBeVisible();
        await check(page, testInfo, `owner-${size.width}`);
        await toggle.uncheck({ force: true });
        await expect(dialog.getByRole("button", { name: /Sign & Route to Reception/ })).toBeVisible();
      });
    });
  });
}
