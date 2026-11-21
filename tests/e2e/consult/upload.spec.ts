/**
 * V2-09b 09B-05 (P1-24, R-16, T-09B-08): the upload on the consult. A report chosen in the Plan section's drop zone goes through the existing
 * `uploadLabDocument` (one action per file, this visit's id):
 *   - a PDF and a JPEG are stored (a row with this visit id, the object at its id-only key, the bytes intact) and listed; the list survives a refresh
 *     and the documents appear on the patient's record;
 *   - a 26 MB file and an .exe are refused on the client with the server's own texts and send no request at all;
 *   - the rows move queued, uploading, stored; a failed upload (the request aborted) shows Retry, and Retry stores exactly one row, sending only that file;
 *   - a sealed consult shows its list and no drop zone;
 *   - no part of the file is left in Cache Storage or IndexedDB.
 * Synthetic data only.
 */
import { randomUUID } from "node:crypto";
import type { Page, Request } from "@playwright/test";
import { expect, test } from "../fixtures";
import { awaitHydrated } from "../support/hydrated";
import { run, seedPatient, seedSignedConsultation, seedVisit, testTag } from "../support/m0-data";
import { storageDump } from "../support/storage-dump";
import { getAdminClient } from "../../helpers/supabase-admin";
import { storageStatePath } from "../support/run-data";

test.use({ storageState: storageStatePath("doctor") });

const admin = getAdminClient();
const isAction = (r: Request) => r.method() === "POST" && r.headers()["next-action"] !== undefined;

function pdf(marker: string) {
  return Buffer.from(`%PDF-1.4\n% ${marker}\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n`);
}
function jpeg(marker: string) {
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]), Buffer.from(marker), Buffer.from([0xff, 0xd9])]);
}

async function openFreshConsult(page: Page, label: string) {
  const { tenantA } = run();
  const patient = await seedPatient(tenantA.id, tenantA.users.owner.id, `E2E Synthetic ${label} ${testTag()}`);
  const visitId = await seedVisit({
    tenantId: tenantA.id,
    patientId: patient.id,
    doctorId: tenantA.users.doctor.id,
    createdBy: tenantA.users.receptionist.id,
    status: "in_consultation",
  });
  await page.goto(`/consultation/${visitId}`);
  await expect(page.getByLabel("History of Present Illness & Clinical Notes")).toBeVisible();
  await awaitHydrated(page);
  return { visitId, patientId: patient.id };
}

const picker = (page: Page) => page.locator("[data-file-drop] input[type=file]");
const rows = (page: Page) => page.locator("[data-file-drop] [data-file-row]");

async function documentsOf(visitId: string) {
  const { data, error } = await admin
    .from("patient_documents")
    .select("id, title, original_filename, storage_path, mime_type, file_size_bytes, visit_id, patient_id, tenant_id")
    .eq("visit_id", visitId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

test("@golden a PDF and a JPEG are stored with this visit, listed, still there after a refresh and on the patient's record", async ({ page }) => {
  const { tenantA } = run();
  const { visitId, patientId } = await openFreshConsult(page, "Upload");
  const tag = testTag().replace(/\W/g, "");
  const pdfBytes = pdf(`E2EUPLOAD${tag}`);
  const jpgBytes = jpeg(`E2EUPLOAD${tag}`);

  await picker(page).setInputFiles([
    { name: `e2e-report-${tag}.pdf`, mimeType: "application/pdf", buffer: pdfBytes },
    { name: `e2e-scan-${tag}.jpg`, mimeType: "image/jpeg", buffer: jpgBytes },
  ]);
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).first()).toHaveAttribute("data-status", "stored", { timeout: 20_000 });
  await expect(rows(page).nth(1)).toHaveAttribute("data-status", "stored", { timeout: 20_000 });

  const documents = await documentsOf(visitId);
  expect(documents).toHaveLength(2);
  const [first, second] = documents;
  expect(first).toMatchObject({ title: `e2e-report-${tag}`, original_filename: `e2e-report-${tag}.pdf`, mime_type: "application/pdf", patient_id: patientId, tenant_id: tenantA.id });
  expect(second).toMatchObject({ title: `e2e-scan-${tag}`, mime_type: "image/jpeg" });
  // The object is at its id-only key and holds exactly the bytes sent.
  expect(first.storage_path).toBe(`tenants/${tenantA.id}/patients/${patientId}/labs/${first.id}.pdf`);
  expect(first.storage_path).not.toContain(tag);
  const stored = await admin.storage.from("clinic-records").download(first.storage_path);
  expect(stored.error).toBeNull();
  expect(Buffer.from(await stored.data!.arrayBuffer()).equals(pdfBytes)).toBe(true);
  const storedJpg = await admin.storage.from("clinic-records").download(second.storage_path);
  expect(Buffer.from(await storedJpg.data!.arrayBuffer()).equals(jpgBytes)).toBe(true);

  // Listed under Attachments, and the list is what the server holds after a refresh.
  const list = page.getByRole("list", { name: "Attachments" });
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await expect(list).toContainText(`e2e-report-${tag}`);
  await page.reload();
  await awaitHydrated(page);
  await expect(page.getByRole("list", { name: "Attachments" }).getByRole("listitem")).toHaveCount(2);
  await expect(page.getByRole("list", { name: "Attachments" })).toContainText(`e2e-scan-${tag}`);

  // On the patient's record.
  await page.goto(`/patients/${patientId}`);
  // The tab switch is a click handler: until React has hydrated the click is ignored, so it is repeated until the list shows.
  await expect(async () => {
    await page.getByRole("button", { name: /Lab Reports/ }).click();
    await expect(page.getByText(`e2e-report-${tag}`).first()).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
});

test("a 2 MB report is stored (above Next's default 1 MB server-action body limit)", async ({ page }) => {
  const { visitId } = await openFreshConsult(page, "UploadLarge");
  const tag = testTag().replace(/\W/g, "");
  const bytes = Buffer.concat([pdf(`large${tag}`), Buffer.alloc(2 * 1024 * 1024, 0x20)]);
  await picker(page).setInputFiles([{ name: `large-${tag}.pdf`, mimeType: "application/pdf", buffer: bytes }]);
  await expect(rows(page).first()).toHaveAttribute("data-status", "stored", { timeout: 30_000 });
  const [doc] = await documentsOf(visitId);
  expect(doc.file_size_bytes).toBe(bytes.length);
});

test("a 26 MB file and an .exe are refused before any request, with the server's own texts", async ({ page }) => {
  const { visitId } = await openFreshConsult(page, "UploadRefused");
  const sent: string[] = [];
  page.on("request", (r) => {
    if (isAction(r)) sent.push(r.url());
  });
  await picker(page).setInputFiles([
    { name: "too-big.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(26 * 1024 * 1024, 0x20) },
    { name: "run-me.exe", mimeType: "application/x-msdownload", buffer: Buffer.from("MZ synthetic") },
  ]);
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).first()).toHaveAttribute("data-status", "failed");
  await expect(rows(page).first()).toContainText("File size exceeds the 25MB limit. Please upload a smaller file.");
  await expect(rows(page).nth(1)).toHaveAttribute("data-status", "failed");
  await expect(rows(page).nth(1)).toContainText("Invalid file type. Allowed formats: PDF, JPEG, PNG, WEBP.");
  // Sending again cannot change the answer: no Retry on a refused file, only a dismiss.
  await expect(page.getByRole("button", { name: /^Retry/ })).toHaveCount(0);
  await page.waitForTimeout(500);
  expect(sent).toEqual([]);
  expect(await documentsOf(visitId)).toEqual([]);
  await page.getByRole("button", { name: "Dismiss too-big.pdf" }).click();
  await expect(rows(page)).toHaveCount(1);
});

test("the row moves queued, uploading, stored; a request that fails shows Retry, and Retry sends only that file and stores exactly one row", async ({ page }) => {
  const { visitId } = await openFreshConsult(page, "UploadRetry");
  const tag = testTag().replace(/\W/g, "");
  let posts = 0;
  let abortFirst = true;
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/consultation/**", async (route) => {
    const request = route.request();
    if (!isAction(request)) return route.continue();
    posts += 1;
    if (abortFirst) {
      abortFirst = false;
      return route.abort("failed");
    }
    await gate;
    return route.continue();
  });

  await picker(page).setInputFiles([
    { name: `first-${tag}.pdf`, mimeType: "application/pdf", buffer: pdf(`first${tag}`) },
    { name: `second-${tag}.pdf`, mimeType: "application/pdf", buffer: pdf(`second${tag}`) },
  ]);
  // The first request was aborted; the second is held at the gate: it is uploading while the first shows its failure.
  const [first, second] = [rows(page).nth(0), rows(page).nth(1)];
  await expect(first).toHaveAttribute("data-status", "failed");
  await expect(first).toContainText("did not reach the server");
  await expect(second).toHaveAttribute("data-status", "uploading");
  release();
  await expect(second).toHaveAttribute("data-status", "stored", { timeout: 20_000 });
  expect((await documentsOf(visitId)).map((d) => d.original_filename)).toEqual([`second-${tag}.pdf`]);
  expect(posts).toBe(2);

  await page.getByRole("button", { name: `Retry first-${tag}.pdf` }).click();
  await expect(first).toHaveAttribute("data-status", "stored", { timeout: 20_000 });
  // Exactly one more request, for that file only, and exactly one row for it.
  expect(posts).toBe(3);
  expect((await documentsOf(visitId)).map((d) => d.original_filename).sort()).toEqual([`first-${tag}.pdf`, `second-${tag}.pdf`]);
  await expect(page.getByRole("list", { name: "Attachments" }).getByRole("listitem")).toHaveCount(2);
});

test("a sealed consult shows its documents and no drop zone", async ({ page }) => {
  const { tenantA } = run();
  const sealed = await seedSignedConsultation("UploadSealed");
  const id = randomUUID();
  const inserted = await admin.from("patient_documents").insert({
    id,
    tenant_id: tenantA.id,
    patient_id: sealed.patientId,
    visit_id: sealed.visitId,
    title: "E2E Synthetic sealed report",
    document_type: "lab_report",
    original_filename: "sealed.pdf",
    storage_path: `tenants/${tenantA.id}/patients/${sealed.patientId}/labs/${id}.pdf`,
    file_size_bytes: 1234,
    mime_type: "application/pdf",
    report_date: new Date().toISOString().slice(0, 10),
    uploaded_by: tenantA.users.doctor.id,
  });
  expect(inserted.error).toBeNull();
  await page.goto(`/consultation/${sealed.visitId}`);
  await awaitHydrated(page);
  await expect(page.getByRole("list", { name: "Attachments" })).toContainText("E2E Synthetic sealed report");
  await expect(page.locator("[data-file-drop]")).toHaveCount(0);
  await expect(page.locator("[data-attachments-readonly]")).toContainText("This record is signed");
  await expect(picker(page)).toHaveCount(0);
});

test("no part of an uploaded file is left in Cache Storage, IndexedDB or the web storages", async ({ page }) => {
  const { visitId } = await openFreshConsult(page, "UploadStorage");
  const marker = `ZQXUPLOADMARKER${testTag().replace(/\W/g, "")}`;
  await picker(page).setInputFiles([{ name: "audit.pdf", mimeType: "application/pdf", buffer: pdf(marker) }]);
  await expect(rows(page).first()).toHaveAttribute("data-status", "stored", { timeout: 20_000 });
  expect(await documentsOf(visitId)).toHaveLength(1);
  const dump = await storageDump(page);
  for (const part of [dump.local, dump.session, dump.indexedDb, dump.caches]) expect(part).not.toContain(marker);
  expect(dump.local).not.toContain("audit.pdf");
  expect(dump.caches).not.toContain("audit.pdf");
});
