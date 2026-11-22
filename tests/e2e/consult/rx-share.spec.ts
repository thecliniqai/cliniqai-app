/**
 * V2-09c 09C-05 (R-14, T-09C-09; PWA-12, PWA §4 D-6 and D-7; roadmap acceptance 2): sharing the signed prescription's PDF.
 *   - on a signed record "Share PDF" hands the system share sheet a `File` of type application/pdf whose bytes start with `%PDF-`, whose name carries the
 *     visit date and the version and never the patient's name, and whose SHA-256 is the stored `pdf_sha256` (the bytes shared are the archived original);
 *   - a device that cannot share files gets "Download PDF" instead: the same file, saved by the browser, the same hash;
 *   - nothing of the PDF is left in any storage API or Cache Storage afterwards (no cache, IndexedDB, localStorage or sessionStorage entry);
 *   - closing the share sheet without choosing (the browser's AbortError) is not an error.
 * `navigator.share` and `canShare` are stubbed by an init script that records the file it was given. Each test owns its doctor and patient. Synthetic data only.
 */
import { createHash } from "node:crypto";
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { awaitHydrated } from "../support/hydrated";
import { run, seedPatient, seedVisit, signSeededVisit, testTag } from "../support/m0-data";
import { storageStatePath, type RunUser } from "../support/run-data";
import { retireOwnDoctor, seedOwnDoctor, signInAsOwnDoctor } from "../support/own-doctor";
import { storageDump } from "../support/storage-dump";
import { getAdminClient } from "../../helpers/supabase-admin";

test.use({ storageState: storageStatePath("doctor") });

const admin = getAdminClient();
let doctor: RunUser | null = null;
test.afterEach(async () => {
  if (doctor) await retireOwnDoctor(doctor);
  doctor = null;
});

const sha256 = (bytes: Buffer | Uint8Array) => createHash("sha256").update(bytes).digest("hex");

interface Shared {
  name: string;
  type: string;
  size: number;
  title: string | undefined;
  b64: string;
}
declare global {
  interface Window {
    __shares: Shared[];
  }
}

/** Replaces the share API: `canShare(files)` answers `files`, and a share records the file's name, type and bytes (base64) instead of opening a sheet. */
async function stubShare(page: Page, opts: { files: boolean; cancel?: boolean }) {
  await page.addInitScript(({ files, cancel }) => {
    window.__shares = [];
    Object.defineProperty(navigator, "canShare", { configurable: true, value: (data?: { files?: File[] }) => files && Boolean(data?.files?.length) });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (data: { files?: File[]; title?: string }) => {
        if (cancel) throw new DOMException("Share canceled", "AbortError");
        const file = data.files?.[0];
        if (!file) throw new TypeError("no file");
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = "";
        for (let i = 0; i < bytes.length; i += 4096) binary += String.fromCharCode(...bytes.subarray(i, i + 4096));
        window.__shares.push({ name: file.name, type: file.type, size: file.size, title: data.title, b64: btoa(binary) });
      },
    });
  }, opts);
}

/** A signed record of the test's own doctor, opened on its page. */
async function openSigned(page: Page, label: string): Promise<{ visitId: string; patientName: string }> {
  const { tenantA } = run();
  const own = await seedOwnDoctor(label);
  doctor = own;
  const patientName = `E2E Synthetic ${label} ${testTag()}`;
  const patient = await seedPatient(tenantA.id, tenantA.users.owner.id, patientName);
  const visitId = await seedVisit({ tenantId: tenantA.id, patientId: patient.id, doctorId: own.id, createdBy: tenantA.users.receptionist.id, status: "waiting" });
  await admin.from("clinical_notes").update({ clinical_notes: "E2E synthetic note for the share case" }).eq("visit_id", visitId).throwOnError();
  const header = await admin.from("prescriptions").insert({ tenant_id: tenantA.id, visit_id: visitId, patient_id: patient.id, doctor_id: own.id, version: 1, status: "active" }).select("id").single();
  if (header.error || !header.data) throw new Error(header.error?.message);
  await admin
    .from("prescription_items")
    .insert({ tenant_id: tenantA.id, prescription_id: header.data.id, medicine_name: `Qzxshare Tablet ${testTag().replace(/\W/g, "")}`, dosage: "1-0-1", timing: null, duration: "5 days", sort_order: 0 })
    .throwOnError();
  await signSeededVisit(tenantA.id, visitId, own.email);
  await signInAsOwnDoctor(page, own);
  return { visitId, patientName };
}

async function openRecord(page: Page, visitId: string) {
  await page.goto(`/consultation/${visitId}`);
  await expect(page.getByTestId("signed-chip")).toBeVisible();
  await awaitHydrated(page);
}

test("@golden Share PDF gives the share sheet the archived original: application/pdf, a name without the patient's name, the stored SHA-256; nothing is left in any storage", async ({ page }) => {
  test.setTimeout(120_000);
  await stubShare(page, { files: true });
  const { visitId } = await openSigned(page, "ShareOk");
  await openRecord(page, visitId);

  const share = page.locator("[data-share-pdf]");
  await expect(share).toHaveAttribute("data-share-pdf", "share", { timeout: 20_000 });
  await expect(share).toHaveText("Share PDF");
  await share.click();
  await expect.poll(() => page.evaluate(() => window.__shares.length)).toBe(1);
  const [shared] = await page.evaluate(() => window.__shares);

  expect(shared.type).toBe("application/pdf");
  expect(shared.title).toBe("Prescription");
  expect(shared.name).toMatch(/^Prescription-\d{4}-\d{2}-\d{2}-v1\.pdf$/);
  expect(shared.name).not.toMatch(/Synthetic|ShareOk/);
  const bytes = Buffer.from(shared.b64, "base64");
  expect(bytes.length).toBe(shared.size);
  expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  // The bytes shared are the archived original: their hash is the stored one and the stored object's.
  const row = (await admin.from("prescriptions").select("pdf_storage_path, pdf_sha256").eq("visit_id", visitId).single()).data;
  expect(row?.pdf_sha256).toBe(sha256(bytes));
  const stored = await admin.storage.from("prescriptions").download(row!.pdf_storage_path!);
  expect(sha256(Buffer.from(await stored.data!.arrayBuffer()))).toBe(row?.pdf_sha256);

  // PWA D-3: no part of the PDF, its name or its text is in any storage API or Cache Storage.
  const dump = await storageDump(page);
  for (const [area, text] of Object.entries(dump)) {
    expect(text, `${area} holds part of the PDF`).not.toContain("%PDF-");
    expect(text, `${area} holds the PDF in base64`).not.toContain("JVBERi0");
    expect(text, `${area} holds the file name`).not.toContain("Prescription-");
    expect(text, `${area} holds the prescription route`).not.toContain("prescription-pdf");
  }
});

test("a device that cannot share files gets Download PDF: the same file, saved by the browser, the same hash", async ({ page }) => {
  test.setTimeout(120_000);
  await stubShare(page, { files: false });
  const { visitId } = await openSigned(page, "ShareDownload");
  await openRecord(page, visitId);

  const button = page.locator("[data-share-pdf]");
  await expect(button).toHaveAttribute("data-share-pdf", "download", { timeout: 20_000 });
  await expect(button).toHaveText("Download PDF");
  const [download] = await Promise.all([page.waitForEvent("download"), button.click()]);
  expect(download.suggestedFilename()).toMatch(/^Prescription-\d{4}-\d{2}-\d{2}-v1\.pdf$/);
  const path = await download.path();
  const bytes = (await import("node:fs")).readFileSync(path);
  expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  const row = (await admin.from("prescriptions").select("pdf_sha256").eq("visit_id", visitId).single()).data;
  expect(row?.pdf_sha256).toBe(sha256(bytes));
  expect(await page.evaluate(() => window.__shares.length)).toBe(0);
});

test("closing the share sheet without choosing is not an error", async ({ page }) => {
  test.setTimeout(120_000);
  await stubShare(page, { files: true, cancel: true });
  const { visitId } = await openSigned(page, "ShareCancel");
  await openRecord(page, visitId);
  const share = page.locator("[data-share-pdf]");
  await expect(share).toHaveAttribute("data-share-pdf", "share", { timeout: 20_000 });
  await share.click();
  await page.waitForTimeout(500);
  await expect(share).toHaveAttribute("data-share-pdf", "share");
  await expect(page.getByText("The share sheet could not open")).toHaveCount(0);
});
