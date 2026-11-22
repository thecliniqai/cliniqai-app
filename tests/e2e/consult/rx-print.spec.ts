/**
 * V2-09c 09C-04 (R-11, R-12; DESIGN_SYSTEM §7.10; CTO ruling Q-2; roadmap acceptance 2): printing the prescription.
 *   - the clinic's "Prescription printing" card saves A5 paper, pre-printed letterhead and a 40 mm top margin (stored in points), and passes axe;
 *   - a consult started AFTER that change gets an A5, pre-printed header; once signed, the PDF route serves an A5 PDF (the page size read from the bytes), archived
 *     once, whose SHA-256 equals the stored `pdf_sha256` and the stored object's; a visit signed BEFORE the change keeps A4;
 *   - the signed record's "Print Rx" prints the prescription itself with the browser's print stylesheet: under print media only the prescription shows, the
 *     `@page` rule carries the paper and the margins of the same settings, and the browser's own PDF of the page has the paper's size;
 *   - the other-letterhead variant of the PDF is rendered on demand and never stored (no new object, the pair unchanged);
 *   - one phone case: the printing card fits 360 px with no horizontal scroll.
 * The clinic's settings are tenant-wide and the specs of one run are serial, so the test restores them (A4, blank paper, 110 and 60 points) when it ends.
 * Synthetic data only.
 */
import { createHash } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { awaitHydrated } from "../support/hydrated";
import { run, seedPatient, seedVisit, signSeededVisit, testTag } from "../support/m0-data";
import { storageStatePath, type RunUser } from "../support/run-data";
import { retireOwnDoctor, seedOwnDoctor, signInAsOwnDoctor } from "../support/own-doctor";
import { rxItemsOf } from "../support/cdci-fixtures";
import { settleAnimations } from "../support/settle";
import { addCustomMedicine } from "../support/rx-entry";
import { getAdminClient } from "../../helpers/supabase-admin";
import { PAGE_A4, PAGE_A5, pdfPageSizes, pdfText } from "../../helpers/pdf-text";

test.describe.configure({ mode: "serial" });

const admin = getAdminClient();
const TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
let doctor: (RunUser & { name: string }) | null = null;

test.afterEach(async () => {
  if (doctor) await retireOwnDoctor(doctor);
  doctor = null;
});

async function restoreSettings() {
  const { tenantA } = run();
  await admin.from("tenants").update({ rx_paper_size: "A4", rx_letterhead_mode: "blank_paper", letterhead_top_margin: 110, letterhead_bottom_margin: 60 }).eq("id", tenantA.id).throwOnError();
}
async function tenantPrint() {
  const { tenantA } = run();
  return (await admin.from("tenants").select("rx_paper_size, rx_letterhead_mode, letterhead_top_margin, letterhead_bottom_margin").eq("id", tenantA.id).single()).data;
}
const sha256 = (bytes: Buffer | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const near = (a: number, b: number) => Math.abs(a - b) <= 1;

/** A signed visit of `own` (a note, a header made by the database default, one line), signed through the doctor's own session. */
async function seedSignedBefore(own: RunUser, label: string): Promise<string> {
  const { tenantA } = run();
  const patient = await seedPatient(tenantA.id, tenantA.users.owner.id, `E2E Synthetic ${label} ${testTag()}`);
  const visitId = await seedVisit({ tenantId: tenantA.id, patientId: patient.id, doctorId: own.id, createdBy: tenantA.users.receptionist.id, status: "waiting" });
  await admin.from("clinical_notes").update({ clinical_notes: "E2E synthetic note" }).eq("visit_id", visitId).throwOnError();
  const header = await admin.from("prescriptions").insert({ tenant_id: tenantA.id, visit_id: visitId, patient_id: patient.id, doctor_id: own.id, version: 1, status: "active" }).select("id").single();
  if (header.error || !header.data) throw new Error(header.error?.message);
  await admin.from("prescription_items").insert({ tenant_id: tenantA.id, prescription_id: header.data.id, medicine_name: `Before Tablet ${testTag()}`, dosage: "1-0-1", timing: null, duration: "5 days", sort_order: 0 }).throwOnError();
  await signSeededVisit(tenantA.id, visitId, (own as RunUser).email);
  return visitId;
}

async function pdfOf(page: Page, visitId: string, query = ""): Promise<{ status: number; bytes: Buffer; disposition: string }> {
  const res = await page.request.get(`/api/visits/${visitId}/prescription-pdf${query}`);
  return { status: res.status(), bytes: Buffer.from(await res.body()), disposition: res.headers()["content-disposition"] ?? "" };
}

test.describe("the clinic's printing settings", () => {
  test.use({ storageState: storageStatePath("owner") });

  test("@golden the card saves A5, pre-printed and a 40 mm top margin; a consult started after it is A5 and its archived PDF is A5 with the stored hash; one signed before stays A4", async ({ page, viewport }, testInfo) => {
    test.skip(!viewport || viewport.width < 1024, "Desktop case; the phone case below covers the card at 360 px");
    test.setTimeout(180_000);
    const { tenantA } = run();
    try {
      const own = await seedOwnDoctor("RxPrint");
      doctor = own;
      // A version signed BEFORE the change (A4 and blank paper by the clinic's defaults).
      const beforeVisit = await seedSignedBefore(own, "PrintBefore");

      // The owner saves the card.
      await page.goto("/settings/clinic");
      const card = page.locator("[data-rx-print-settings]");
      await expect(card).toBeVisible();
      await expect(card.getByRole("radio", { name: "A4" })).toBeChecked();
      await card.getByRole("radio", { name: "A5" }).click();
      await card.getByRole("radio", { name: /Pre-printed letterhead/ }).click();
      await card.getByLabel("Top margin (mm)").fill("40");
      await card.getByLabel("Bottom margin (mm)").fill("20");
      await card.getByRole("button", { name: "Save printing settings" }).click();
      await expect(card.getByText(/Saved\. New prescriptions use this paper/)).toBeVisible({ timeout: 10_000 });
      expect(await tenantPrint()).toEqual({ rx_paper_size: "A5", rx_letterhead_mode: "preprinted_letterhead", letterhead_top_margin: 113, letterhead_bottom_margin: 57 });
      // The button fades between its loading and idle looks; axe reads computed colours, so it scans once nothing is animating.
      await settleAnimations(page);
      const axe = await new AxeBuilder({ page }).withTags(TAGS).include("[data-rx-print-settings]").analyze();
      await testInfo.attach("axe-rx-print-card.json", { body: JSON.stringify(axe.violations, null, 2), contentType: "application/json" });
      expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
      // A refused value is shown on the field and nothing is written.
      await card.getByLabel("Top margin (mm)").fill("100");
      await card.getByLabel("Bottom margin (mm)").fill("100");
      await card.getByRole("button", { name: "Save printing settings" }).click();
      await expect(card.getByText(/together can be at most 132 mm/).first()).toBeVisible();
      expect((await tenantPrint())?.letterhead_top_margin).toBe(113);

      // A consult started AFTER the change: the first line creates the header with the clinic's paper and letterhead.
      const patientName = `E2E Synthetic PrintAfter ${testTag()}`;
      const patient = await seedPatient(tenantA.id, tenantA.users.owner.id, patientName);
      const afterVisit = await seedVisit({ tenantId: tenantA.id, patientId: patient.id, doctorId: own.id, createdBy: tenantA.users.receptionist.id, status: "in_consultation" });
      await admin.from("clinical_notes").update({ clinical_notes: "E2E synthetic note" }).eq("visit_id", afterVisit).throwOnError();
      await signInAsOwnDoctor(page, own);
      await page.goto(`/consultation/${afterVisit}`);
      await awaitHydrated(page);
      await addCustomMedicine(page.locator("#prescription"), `After Syrup ${testTag()}`);
      expect((await rxItemsOf(afterVisit)).length).toBe(1);
      expect((await admin.from("prescriptions").select("paper_size, letterhead_mode").eq("visit_id", afterVisit).single()).data).toEqual({ paper_size: "A5", letterhead_mode: "preprinted_letterhead" });
      await signSeededVisit(tenantA.id, afterVisit, own.email);

      // The signed version's PDF: A5, archived once, its hash is the stored one and the stored object's.
      const after = await pdfOf(page, afterVisit);
      expect(after.status).toBe(200);
      expect(after.bytes.subarray(0, 5).toString()).toBe("%PDF-");
      expect(after.disposition).toContain("Prescription-");
      expect(after.disposition).toMatch(/-v1\.pdf/);
      const sizes = pdfPageSizes(after.bytes);
      expect(sizes.length).toBeGreaterThanOrEqual(1);
      for (const s of sizes) expect([s.width, s.height]).toEqual([PAGE_A5.width, PAGE_A5.height]);
      const row = (await admin.from("prescriptions").select("pdf_storage_path, pdf_sha256").eq("visit_id", afterVisit).single()).data;
      expect(row?.pdf_storage_path).toBe(`${tenantA.id}/${afterVisit}/rx_v1.pdf`);
      expect(row?.pdf_sha256).toBe(sha256(after.bytes));
      const stored = await admin.storage.from("prescriptions").download(row!.pdf_storage_path!);
      expect(sha256(Buffer.from(await stored.data!.arrayBuffer()))).toBe(row?.pdf_sha256);
      // A second read is the archive (same bytes).
      expect(sha256((await pdfOf(page, afterVisit)).bytes)).toBe(row?.pdf_sha256);

      // The file name carries no patient name.
      expect(after.disposition).not.toMatch(/PrintAfter|Synthetic/);

      // The version signed before the change keeps A4 (its header was frozen at its creation).
      const before = await pdfOf(page, beforeVisit);
      expect(before.status).toBe(200);
      for (const s of pdfPageSizes(before.bytes)) expect([s.width, s.height]).toEqual([PAGE_A4.width, PAGE_A4.height]);
      expect((await admin.from("prescriptions").select("paper_size").eq("visit_id", beforeVisit).single()).data?.paper_size).toBe("A4");
      expect(pdfText(before.bytes)).not.toContain("After food");

      // The other-letterhead variant is rendered on demand and never stored: the pair and the stored objects are unchanged.
      const pairBefore = (await admin.from("prescriptions").select("pdf_storage_path, pdf_sha256").eq("visit_id", beforeVisit).single()).data;
      const objectsBefore = (await admin.storage.from("prescriptions").list(`${tenantA.id}/${beforeVisit}`)).data?.map((o) => o.name).sort();
      const variant = await pdfOf(page, beforeVisit, "?letterhead=preprinted_letterhead");
      expect(variant.status).toBe(200);
      expect(variant.bytes.subarray(0, 5).toString()).toBe("%PDF-");
      expect(sha256(variant.bytes)).not.toBe(pairBefore?.pdf_sha256);
      expect((await admin.from("prescriptions").select("pdf_storage_path, pdf_sha256").eq("visit_id", beforeVisit).single()).data).toEqual(pairBefore);
      expect((await admin.storage.from("prescriptions").list(`${tenantA.id}/${beforeVisit}`)).data?.map((o) => o.name).sort()).toEqual(objectsBefore);
      // And another paper for the same version: also a render, not stored.
      const a5 = await pdfOf(page, beforeVisit, "?paper=A5");
      for (const s of pdfPageSizes(a5.bytes)) expect([s.width, s.height]).toEqual([PAGE_A5.width, PAGE_A5.height]);
      expect((await admin.storage.from("prescriptions").list(`${tenantA.id}/${beforeVisit}`)).data?.map((o) => o.name).sort()).toEqual(objectsBefore);

      // The print view of the signed record: only the prescription under print media, the @page rule of the same settings, the browser's PDF of the page A5.
      await page.goto(`/consultation/${afterVisit}`);
      await awaitHydrated(page);
      await expect(page.getByRole("button", { name: "Print Rx" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Rx PDF" })).toBeVisible();
      await expect(page.locator("[data-rx-print-root]")).toBeHidden();
      await page.emulateMedia({ media: "print" });
      await expect(page.locator("[data-rx-print-root]")).toBeVisible();
      await expect(page.locator("[data-consult-workspace]")).toBeHidden();
      const printed = await page.locator("[data-rx-print-root]").innerText();
      expect(printed).toContain(patientName);
      expect(printed).toContain("Prescribed Medications".toUpperCase());
      expect(printed).not.toContain("After food");
      const pageRule = await page.locator("[data-rx-print-root] style").textContent();
      expect(pageRule).toContain("size: A5 portrait");
      expect(pageRule).toMatch(/margin: 113pt 32\.4pt 57pt 32\.4pt/);
      const chromePdf = await page.pdf({ preferCSSPageSize: true });
      const chromeSizes = pdfPageSizes(chromePdf);
      expect(chromeSizes.length).toBeGreaterThanOrEqual(1);
      for (const s of chromeSizes) {
        expect(near(s.width, PAGE_A5.width), `width ${s.width}`).toBe(true);
        expect(near(s.height, PAGE_A5.height), `height ${s.height}`).toBe(true);
      }
      await page.emulateMedia({ media: "screen" });
      await expect(page.locator("[data-rx-print-root]")).toBeHidden();
    } finally {
      await restoreSettings();
    }
  });
});

test.describe("the printing card on a phone", () => {
  test.use({ storageState: storageStatePath("owner") });

  test("fits 360 px with no horizontal scroll and passes axe", async ({ page, viewport }, testInfo) => {
    test.skip(!viewport || viewport.width > 480, "Phone projects only");
    await page.goto("/settings/clinic");
    const card = page.locator("[data-rx-print-settings]");
    await expect(card).toBeVisible();
    await card.scrollIntoViewIfNeeded();
    await expect(card.getByLabel("Top margin (mm)")).toBeVisible();
    await settleAnimations(page);
    const scrolls = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(scrolls, "horizontal scroll").toBe(false);
    const axe = await new AxeBuilder({ page }).withTags(TAGS).include("[data-rx-print-settings]").analyze();
    await testInfo.attach("axe-rx-print-card-phone.json", { body: JSON.stringify(axe.violations, null, 2), contentType: "application/json" });
    expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
  });
});
