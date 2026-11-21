/**
 * The consult workspace's accessibility, the whole page (V2-09b 09B-02a, R-6, R-7; CLAUDE.md DoD 3; the V2-06 and V2-09a "consult axe debt"):
 * ZERO serious or critical axe violations on /consultation/[id], with NO allowance for the M0 baseline's v1 rules, at 360, 820, 1180 and 1280 px,
 * for the draft, the sealed record, the amending record and the Sign & Bill sheet open. Moderate and minor findings are attached for the evidence.
 * Screenshots and the axe JSON go to test-results/consult-screens/. Runs on desktop-chrome only (a11y specs own their viewport). Synthetic data only.
 */
import fs from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import type { Page, TestInfo } from "@playwright/test";
import { expect, test } from "../fixtures";
import { ROOT } from "../support/app-env";
import { getAdminClient } from "../../helpers/supabase-admin";
import { run, seedPatient, seedSignedConsultation, seedVisit, testTag } from "../support/m0-data";
import { storageStatePath } from "../support/run-data";

const TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const BLOCKING_IMPACTS = new Set(["serious", "critical"]);
const OUT_DIR = path.join(ROOT, "test-results/consult-screens");
const WIDTHS = [
  { width: 360, height: 780 },
  { width: 820, height: 1180 },
  { width: 1180, height: 820 },
  { width: 1280, height: 800 },
];
const REASON = "Added the missing antibiotic after the patient called back";

/** Axe over the whole page; the serious and critical findings must be empty (no baseline rule is tolerated). */
async function checkWholePage(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`), fullPage: false, animations: "disabled", caret: "hide" });
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const blocking = results.violations.filter((v) => BLOCKING_IMPACTS.has(v.impact ?? ""));
  const summary = {
    screen: name,
    baseline_allowance: "none",
    serious_or_critical: blocking.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.map((n) => n.target.join(" ")) })),
    other: results.violations.filter((v) => !BLOCKING_IMPACTS.has(v.impact ?? "")).map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length })),
  };
  fs.writeFileSync(path.join(OUT_DIR, `${name}.axe.json`), JSON.stringify(summary, null, 2));
  await testInfo.attach(`axe-${name}.json`, { body: JSON.stringify(summary, null, 2), contentType: "application/json" });
  expect(summary.serious_or_critical, `serious or critical axe violations on ${name}`).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `no horizontal scroll on ${name}`).toBe(true);
}

async function seedDraftVisit(): Promise<string> {
  const { tenantA } = run();
  const patient = await seedPatient(tenantA.id, tenantA.users.owner.id, `E2E Synthetic Consult Axe ${testTag()}`);
  const { error } = await getAdminClient().from("patients").update({ allergies: ["Penicillin"], chronic_conditions: ["T2DM"] }).eq("id", patient.id);
  if (error) throw new Error(error.message);
  return seedVisit({
    tenantId: tenantA.id,
    patientId: patient.id,
    doctorId: tenantA.users.doctor.id,
    createdBy: tenantA.users.receptionist.id,
    status: "in_consultation",
  });
}

for (const size of WIDTHS) {
  test.describe(`consult page axe at ${size.width}px`, () => {
    test.use({ storageState: storageStatePath("doctor") });

    test(`draft: the whole page (${size.width}px)`, async ({ page }, testInfo) => {
      const visitId = await seedDraftVisit();
      await page.setViewportSize(size);
      await page.goto(`/consultation/${visitId}`);
      await expect(page.locator("[data-consult-workspace]")).toBeVisible();
      await checkWholePage(page, testInfo, `draft-${size.width}`);
    });

    test(`sealed: the whole page (${size.width}px)`, async ({ page }, testInfo) => {
      const { visitId } = await seedSignedConsultation("Axe Sealed");
      await page.setViewportSize(size);
      await page.goto(`/consultation/${visitId}`);
      await expect(page.getByTestId("signed-chip")).toBeVisible();
      await checkWholePage(page, testInfo, `sealed-${size.width}`);
    });

    test(`amending: the whole page (${size.width}px)`, async ({ page }, testInfo) => {
      const { visitId } = await seedSignedConsultation("Axe Amending");
      await page.setViewportSize(size);
      await page.goto(`/consultation/${visitId}`);
      await page.getByRole("button", { name: "Amend", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Reopen Visit for Clinical Amendment" });
      await dialog.getByLabel(/Reason for Amendment/).fill(REASON);
      await dialog.getByRole("button", { name: /Confirm & Reopen for Amendment/ }).click();
      await expect(page.getByTestId("amending-banner")).toContainText(`(v1 to v2): ${REASON} · opened`, { timeout: 30_000 });
      await checkWholePage(page, testInfo, `amending-${size.width}`);
    });

    test(`the Sign & Bill sheet open: the whole page (${size.width}px)`, async ({ page }, testInfo) => {
      const visitId = await seedDraftVisit();
      await page.setViewportSize(size);
      await page.goto(`/consultation/${visitId}`);
      await page.getByRole("button", { name: "Finish visit" }).click();
      await expect(page.getByRole("dialog", { name: "Complete & Sign Consultation" })).toBeVisible();
      await checkWholePage(page, testInfo, `sign-and-bill-${size.width}`);
    });
  });
}
