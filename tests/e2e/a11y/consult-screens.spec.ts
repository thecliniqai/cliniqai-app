/**
 * The consult workspace's accessibility, the whole page (V2-09b 09B-02a, R-6, R-7; CLAUDE.md DoD 3; the V2-06 and V2-09a "consult axe debt"):
 * ZERO serious or critical axe violations on /consultation/[id], with NO allowance for the M0 baseline's v1 rules, at 360, 820, 1180 and 1280 px,
 * for the draft, the sealed record, the amending record and the Sign & Bill sheet open; 09B-04b and 09B-05 add the shorthand bar with its preview, the macro
 * list, the upload states (a refused file and a stored one) and a sealed record with a document. Moderate and minor findings are attached for the evidence.
 * Screenshots and the axe JSON go to test-results/consult-screens/. Runs on desktop-chrome only (a11y specs own their viewport). Synthetic data only.
 */
import fs from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import type { Page, TestInfo } from "@playwright/test";
import { expect, test } from "../fixtures";
import { ROOT } from "../support/app-env";
import { getAdminClient } from "../../helpers/supabase-admin";
import { randomUUID } from "node:crypto";
import { run, seedPatient, seedSignedConsultation, seedVisit, testTag } from "../support/m0-data";
import { awaitHydrated } from "../support/hydrated";
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
const PDF = Buffer.from("%PDF-1.4\n% synthetic axe report\n%%EOF\n");

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
    await awaitHydrated(page);
      await expect(page.locator("[data-consult-workspace]")).toBeVisible();
      await checkWholePage(page, testInfo, `draft-${size.width}`);
    });

    test(`sealed: the whole page (${size.width}px)`, async ({ page }, testInfo) => {
      const { visitId } = await seedSignedConsultation("Axe Sealed");
      await page.setViewportSize(size);
      await page.goto(`/consultation/${visitId}`);
    await awaitHydrated(page);
      await expect(page.getByTestId("signed-chip")).toBeVisible();
      await checkWholePage(page, testInfo, `sealed-${size.width}`);
    });

    test(`amending: the whole page (${size.width}px)`, async ({ page }, testInfo) => {
      const { visitId } = await seedSignedConsultation("Axe Amending");
      await page.setViewportSize(size);
      await page.goto(`/consultation/${visitId}`);
    await awaitHydrated(page);
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
    await awaitHydrated(page);
      await page.getByRole("button", { name: "Finish visit" }).click();
      await expect(page.getByRole("dialog", { name: "Complete & Sign Consultation" })).toBeVisible();
      await checkWholePage(page, testInfo, `sign-and-bill-${size.width}`);
    });

    test(`the shorthand bar open with its preview: the whole page (${size.width}px)`, async ({ page }, testInfo) => {
      const visitId = await seedDraftVisit();
      await page.setViewportSize(size);
      await page.goto(`/consultation/${visitId}`);
      await awaitHydrated(page);
      await page.getByRole("button", { name: "Shorthand" }).click();
      const bar = page.getByRole("dialog", { name: "Shorthand" });
      await bar.getByRole("textbox", { name: "Shorthand" }).fill("c/o fever 3d, cough 2d; o/e chest clear; adv steam inhalation BD; f/u 5d");
      await expect(bar.locator("[data-shorthand-group='follow-up']")).toBeVisible();
      await checkWholePage(page, testInfo, `shorthand-${size.width}`);
    });

    test(`the macro list open: the whole page (${size.width}px)`, async ({ page }, testInfo) => {
      const visitId = await seedDraftVisit();
      await page.setViewportSize(size);
      await page.goto(`/consultation/${visitId}`);
      await awaitHydrated(page);
      await page.getByRole("button", { name: "Shorthand" }).click();
      await page.getByRole("dialog", { name: "Shorthand" }).getByRole("button", { name: "Macros" }).click();
      const list = page.getByRole("dialog", { name: "Macros" });
      await list.locator("[data-macro-shortcut]").fill(".axe");
      await list.locator("[data-macro-expansion]").fill("adv rest");
      await list.locator("[data-macro-save]").click();
      await expect(list.locator("[data-macro-row='.axe']")).toBeVisible();
      await checkWholePage(page, testInfo, `macros-${size.width}`);
      await list.getByRole("button", { name: "Delete .axe" }).click();
      await expect(list.locator("[data-macro-row='.axe']")).toHaveCount(0);
    });

    test(`the upload states, a refused file and a stored one: the whole page (${size.width}px)`, async ({ page }, testInfo) => {
      const visitId = await seedDraftVisit();
      await page.setViewportSize(size);
      await page.goto(`/consultation/${visitId}`);
      await awaitHydrated(page);
      await page.locator("[data-file-drop] input[type=file]").setInputFiles([
        { name: "run-me.exe", mimeType: "application/x-msdownload", buffer: Buffer.from("MZ synthetic") },
        { name: "axe-report.pdf", mimeType: "application/pdf", buffer: PDF },
      ]);
      const rows = page.locator("[data-file-drop] [data-file-row]");
      await expect(rows).toHaveCount(2);
      await expect(rows.nth(0)).toHaveAttribute("data-status", "failed");
      await expect(rows.nth(1)).toHaveAttribute("data-status", "stored", { timeout: 20_000 });
      await page.locator("[data-attachments]").scrollIntoViewIfNeeded();
      await checkWholePage(page, testInfo, `upload-${size.width}`);
    });

    test(`a sealed record with a document, no drop zone: the whole page (${size.width}px)`, async ({ page }, testInfo) => {
      const { tenantA } = run();
      // The document is attached while the visit is open, then it is signed (000116, 09B-06a S-2: no document on a signed visit).
      const sealed = await seedSignedConsultation("Axe Sealed Docs", {
        beforeSign: async ({ visitId, patientId }) => {
          const id = randomUUID();
          const inserted = await getAdminClient().from("patient_documents").insert({
            id,
            tenant_id: tenantA.id,
            patient_id: patientId,
            visit_id: visitId,
            title: "E2E Synthetic sealed report",
            document_type: "lab_report",
            original_filename: "sealed.pdf",
            storage_path: `tenants/${tenantA.id}/patients/${patientId}/labs/${id}.pdf`,
            file_size_bytes: 1234,
            mime_type: "application/pdf",
            report_date: new Date().toISOString().slice(0, 10),
            uploaded_by: tenantA.users.doctor.id,
          });
          expect(inserted.error).toBeNull();
        },
      });
      await page.setViewportSize(size);
      await page.goto(`/consultation/${sealed.visitId}`);
      await awaitHydrated(page);
      await expect(page.locator("[data-attachments-readonly]")).toBeVisible();
      await checkWholePage(page, testInfo, `sealed-documents-${size.width}`);
    });
  });
}
