/**
 * The patient's Lab Reports tab after V2-05 05-02c (labs:view / labs:edit; CLAUDE.md DoD 3).
 *
 * Lab reports follow the database rule since 05-02c (patient_documents and the lab storage class: labs:view to read,
 * labs:edit to upload): receptionists and admins hold neither, so the tab shows a fixed notice instead of a refused
 * read, and no upload button; doctors (and nurses) keep the upload. The server refuses regardless
 * (tests/labs/lab-storage-key.spec.ts, the generated matrix). This spec checks the tab at 360, 820 and 1280 px:
 *   - receptionist: the notice, no "Upload Lab Report" button;
 *   - doctor: the upload button, no notice;
 *   - no serious/critical axe rule that the M0 baseline (02-03b) did not already have on /patients/[id]: BLOCKING on new
 *     rule ids; counts and a screenshot go to test-results/lab-reports/ for the 05-02c evidence.
 * Runs on desktop-chrome only (a11y specs own their viewport). Synthetic data only.
 */
import fs from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import type { Page, TestInfo } from "@playwright/test";
import { expect, test } from "../fixtures";
import { ROOT } from "../support/app-env";
import { run, seedPatient, testTag } from "../support/m0-data";
import { storageStatePath } from "../support/run-data";

const TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const BLOCKING_IMPACTS = new Set(["serious", "critical"]);
const BASELINE_DIR = path.join(ROOT, ".planning/phases/02-ci-e2e-foundations/evidence/m0-baseline/axe");
const OUT_DIR = path.join(ROOT, "test-results/lab-reports");
const NOTICE = "Lab reports are available to clinical staff only.";
const WIDTHS = [
  { width: 360, height: 780 },
  { width: 820, height: 1180 },
  { width: 1280, height: 800 },
];

/** Serious/critical rule ids the M0 baseline recorded on /patients/[id] on any PR-lane device. */
function baselineRules(): Set<string> {
  const ids = new Set<string>();
  for (const file of fs.readdirSync(BASELINE_DIR).filter((f) => f.endsWith(".json"))) {
    const report = JSON.parse(fs.readFileSync(path.join(BASELINE_DIR, file), "utf8")) as {
      routes: Array<{ route: string; violations: Array<{ id: string; impact: string | null }> }>;
    };
    for (const r of report.routes.filter((x) => x.route === "/patients/[id]")) {
      for (const v of r.violations) if (BLOCKING_IMPACTS.has(v.impact ?? "")) ids.add(v.id);
    }
  }
  return ids;
}

async function openLabsTab(page: Page, tag: string): Promise<void> {
  const { tenantA } = run();
  const patient = await seedPatient(tenantA.id, tenantA.users.owner.id, `E2E Synthetic Labs ${tag}`);
  await page.goto(`/patients/${patient.id}`);
  await page.getByRole("navigation", { name: "Patient Tabs" }).getByRole("button", { name: /Lab Reports/ }).click();
}

async function check(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`), fullPage: false, animations: "disabled", caret: "hide" });
  const result = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const blocking = result.violations.filter((v) => BLOCKING_IMPACTS.has(v.impact ?? ""));
  const baseline = baselineRules();
  const summary = {
    screen: name,
    baseline_rules: [...baseline].sort(),
    serious_or_critical_page: blocking.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length })),
  };
  fs.writeFileSync(path.join(OUT_DIR, `${name}.axe.json`), JSON.stringify(summary, null, 2));
  await testInfo.attach(`axe-${name}.json`, { body: JSON.stringify(summary, null, 2), contentType: "application/json" });
  const newRules = blocking.map((v) => v.id).filter((id) => !baseline.has(id));
  expect(newRules, `serious/critical axe rules not in the M0 baseline on ${name}`).toEqual([]);
  // The 05-02c notice adds no serious/critical node of its own.
  const touched = blocking.flatMap((v) => v.nodes.map((n) => n.html)).filter((html) => html.includes(NOTICE));
  expect(touched, `serious/critical axe nodes in the 05-02c notice on ${name}`).toEqual([]);
}

for (const size of WIDTHS) {
  test.describe(`Lab Reports tab at ${size.width}px`, () => {
    test.describe("receptionist (no labs:view)", () => {
      test.use({ storageState: storageStatePath("receptionist") });

      test(`shows the clinical-staff notice and no upload (${size.width}px)`, async ({ page }, testInfo) => {
        await page.setViewportSize(size);
        await openLabsTab(page, testTag());
        await expect(page.getByText(NOTICE)).toBeVisible();
        await expect(page.getByRole("button", { name: /Upload Lab Report|Upload First Report/ })).toHaveCount(0);
        await page.getByText(NOTICE).scrollIntoViewIfNeeded();
        await check(page, testInfo, `receptionist-${size.width}`);
      });
    });

    test.describe("doctor (labs:edit)", () => {
      test.use({ storageState: storageStatePath("doctor") });

      test(`keeps the upload, no notice (${size.width}px)`, async ({ page }, testInfo) => {
        await page.setViewportSize(size);
        await openLabsTab(page, testTag());
        await expect(page.getByRole("button", { name: "Upload Lab Report" })).toBeVisible();
        await expect(page.getByText(NOTICE)).toHaveCount(0);
        await page.getByRole("button", { name: "Upload Lab Report" }).scrollIntoViewIfNeeded();
        await check(page, testInfo, `doctor-${size.width}`);
      });
    });
  });
}
