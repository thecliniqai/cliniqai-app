/**
 * V2-09c 09C-05 (R-15, T-09C-10; FT-04, PWA-12, PWA §6.5; roadmap acceptance 5): a phone photo is compressed in the browser before it is uploaded.
 *   - a 4,000 x 3,000 JPEG larger than the server's 4 MB limit, with an Exif APP1 segment holding GPS tags (built in the test), goes up through the "Take photo"
 *     input (a coarse pointer) or the picker (a fine pointer) and is STORED as image/jpeg of at most 1 MB, long edge at most 2,000 px, with the aspect ratio kept,
 *     and NO APP1 segment and none of the coordinates in the stored bytes (read from the stored object);
 *   - a PNG screenshot is stored as a JPEG within the budget;
 *   - a PDF is stored byte for byte;
 *   - a photo that cannot be decoded and is over the server's limit is refused with the fixed text and sends no request;
 *   - the "Take photo" input carries capture="environment" and accept="image/*" on a coarse pointer, and does not exist on a fine pointer.
 * The compression numbers (input and output bytes, dimensions) are attached to each run as evidence. Synthetic data only.
 */
import AxeBuilder from "@axe-core/playwright";
import type { Page, Request } from "@playwright/test";
import { expect, test } from "../fixtures";
import { awaitHydrated } from "../support/hydrated";
import { run, seedPatient, seedVisit, testTag } from "../support/m0-data";
import { storageStatePath } from "../support/run-data";
import { jpegInfo, withExifGps, GPS_MARKER_TEXT } from "../support/jpeg";
import { getAdminClient } from "../../helpers/supabase-admin";

test.use({ storageState: storageStatePath("doctor") });

const admin = getAdminClient();
const MB = 1024 * 1024;
const isAction = (r: Request) => r.method() === "POST" && r.headers()["next-action"] !== undefined;

async function openFreshConsult(page: Page, label: string) {
  const { tenantA } = run();
  const patient = await seedPatient(tenantA.id, tenantA.users.owner.id, `E2E Synthetic ${label} ${testTag()}`);
  const visitId = await seedVisit({ tenantId: tenantA.id, patientId: patient.id, doctorId: tenantA.users.doctor.id, createdBy: tenantA.users.receptionist.id, status: "in_consultation" });
  await page.goto(`/consultation/${visitId}`);
  await expect(page.getByLabel("History of Present Illness & Clinical Notes")).toBeVisible();
  await awaitHydrated(page);
  return { visitId, patientId: patient.id };
}

/** Draws a synthetic picture (a gradient under coloured blocks: hard to compress, like a detailed photo) in the page and returns it encoded as `mime`. */
async function syntheticPicture(page: Page, opts: { width: number; height: number; block: number; mime: "image/jpeg" | "image/png"; quality?: number }): Promise<Buffer> {
  const b64 = await page.evaluate(async ({ width, height, block, mime, quality }) => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d")!;
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, "#2a6fb0");
    gradient.addColorStop(1, "#e8c27a");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    let seed = 1234567;
    const rnd = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let y = 0; y < height; y += block) {
      for (let x = 0; x < width; x += block) {
        ctx.fillStyle = `rgb(${(rnd() * 255) | 0},${(rnd() * 255) | 0},${(rnd() * 255) | 0})`;
        ctx.fillRect(x, y, block, block);
      }
    }
    const blob: Blob = await new Promise((resolve) => canvas.toBlob((b) => resolve(b!), mime, quality));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return btoa(binary);
  }, opts);
  return Buffer.from(b64, "base64");
}

async function documentsOf(visitId: string) {
  const { data, error } = await admin
    .from("patient_documents")
    .select("id, original_filename, storage_path, mime_type, file_size_bytes, visit_id")
    .eq("visit_id", visitId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}
async function storedBytes(path: string): Promise<Buffer> {
  const stored = await admin.storage.from("clinic-records").download(path);
  expect(stored.error).toBeNull();
  return Buffer.from(await stored.data!.arrayBuffer());
}

/** The control that takes the file: the camera input on a coarse pointer, the picker otherwise. */
async function pick(page: Page, coarse: boolean, files: Array<{ name: string; mimeType: string; buffer: Buffer }>) {
  if (coarse) await page.locator("[data-take-photo-input]").setInputFiles(files);
  else await page.locator("[data-file-drop] input[type=file]").setInputFiles(files);
}
const isCoarse = (page: Page) => page.evaluate(() => window.matchMedia("(pointer: coarse)").matches);
const rows = (page: Page) => page.locator("[data-file-drop] [data-file-row]");

test("@golden a 4,000 x 3,000 photo over the 4 MB limit with GPS Exif is stored as a JPEG of at most 1 MB and 2,000 px with no Exif; the camera input is there on a coarse pointer only", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const { visitId } = await openFreshConsult(page, "Capture");
  const coarse = await isCoarse(page);

  // The camera control: on a coarse pointer, capture=environment and image/*; on a fine pointer there is none (the picker stays).
  if (coarse) {
    const input = page.locator("[data-take-photo-input]");
    await expect(input).toHaveAttribute("capture", "environment");
    await expect(input).toHaveAttribute("accept", "image/*");
    await expect(page.getByRole("button", { name: "Take photo" })).toBeVisible();
    // The camera button beside the drop zone passes axe and is a touch-size target.
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).include("[data-attachments]").analyze();
    expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
    const box = await page.getByRole("button", { name: "Take photo" }).boundingBox();
    expect(box && box.height >= 44).toBe(true);
  } else {
    await expect(page.locator("[data-take-photo]")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Take photo" })).toHaveCount(0);
  }

  const plain = await syntheticPicture(page, { width: 4000, height: 3000, block: 5, mime: "image/jpeg", quality: 0.95 });
  const photo = withExifGps(plain);
  expect(photo.length).toBeGreaterThan(4 * MB); // more than the server takes: the client check no longer refuses it, the compression makes it fit
  const before = jpegInfo(photo);
  expect([before.width, before.height]).toEqual([4000, 3000]);
  expect(before.hasExif && before.hasGpsBytes).toBe(true);

  const sent: Request[] = [];
  page.on("request", (r) => {
    if (isAction(r)) sent.push(r);
  });
  await pick(page, coarse, [{ name: "IMG_20261122_093000.jpg", mimeType: "image/jpeg", buffer: photo }]);
  await expect(rows(page).first()).toHaveAttribute("data-status", "stored", { timeout: 60_000 });

  const [doc] = await documentsOf(visitId);
  expect(doc.mime_type).toBe("image/jpeg");
  expect(doc.file_size_bytes).toBeLessThanOrEqual(1 * MB);
  expect(doc.original_filename).toBe("IMG_20261122_093000.jpg");
  const out = await storedBytes(doc.storage_path);
  expect(out.length).toBe(doc.file_size_bytes);
  expect(out.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))).toBe(true);
  const info = jpegInfo(out);
  expect(Math.max(info.width, info.height)).toBeLessThanOrEqual(2000);
  expect(Math.abs(info.width / info.height - 4 / 3)).toBeLessThan(0.01);
  // The location left on the phone: no APP1 segment at all, and none of the coordinates or their text anywhere in the stored bytes.
  expect(info.hasApp1).toBe(false);
  expect(info.hasExif).toBe(false);
  expect(out.includes(GPS_MARKER_TEXT)).toBe(false);
  expect(out.includes(Buffer.from("Exif"))).toBe(false);
  // Evidence: the measurements of this run.
  await testInfo.attach("compression-photo.json", {
    body: JSON.stringify({ project: testInfo.project.name, coarsePointer: coarse, inputBytes: photo.length, inputDimensions: [before.width, before.height], outputBytes: out.length, outputDimensions: [info.width, info.height] }, null, 2),
    contentType: "application/json",
  });
});

test("@golden a PNG screenshot is stored as a JPEG within the budget, and a PDF is stored byte for byte", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const { visitId } = await openFreshConsult(page, "CaptureOther");
  const coarse = await isCoarse(page);
  const png = await syntheticPicture(page, { width: 1600, height: 1200, block: 2, mime: "image/png" });
  expect(png.length).toBeGreaterThan(1 * MB);
  expect(png.subarray(1, 4).toString("latin1")).toBe("PNG");
  const tag = testTag().replace(/\W/g, "");
  const pdf = Buffer.concat([Buffer.from(`%PDF-1.4\n% E2ECAPTURE${tag}\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n`), Buffer.alloc(300 * 1024, 0x20)]);

  await page.locator("[data-file-drop] input[type=file]").setInputFiles([
    { name: "Screenshot 2026-11-22.png", mimeType: "image/png", buffer: png },
    { name: `report-${tag}.pdf`, mimeType: "application/pdf", buffer: pdf },
  ]);
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).nth(0)).toHaveAttribute("data-status", "stored", { timeout: 60_000 });
  await expect(rows(page).nth(1)).toHaveAttribute("data-status", "stored", { timeout: 60_000 });

  const [image, report] = await documentsOf(visitId);
  expect(image.mime_type).toBe("image/jpeg");
  expect(image.original_filename).toBe("Screenshot 2026-11-22.jpg");
  expect(image.file_size_bytes).toBeLessThanOrEqual(1 * MB);
  const imageBytes = await storedBytes(image.storage_path);
  expect(jpegInfo(imageBytes).hasApp1).toBe(false);
  expect(Math.max(jpegInfo(imageBytes).width, jpegInfo(imageBytes).height)).toBeLessThanOrEqual(2000);
  expect(report.mime_type).toBe("application/pdf");
  expect((await storedBytes(report.storage_path)).equals(pdf)).toBe(true);
  await testInfo.attach("compression-png.json", {
    body: JSON.stringify({ project: testInfo.project.name, coarsePointer: coarse, inputBytes: png.length, outputBytes: imageBytes.length, outputDimensions: [jpegInfo(imageBytes).width, jpegInfo(imageBytes).height], pdfBytes: pdf.length, pdfStoredIdentical: true }, null, 2),
    contentType: "application/json",
  });
});

test("@golden a picture that cannot be decoded and is over the server's limit is refused with the fixed text and no request is sent", async ({ page }) => {
  await openFreshConsult(page, "CaptureRefused");
  const sent: string[] = [];
  page.on("request", (r) => {
    if (isAction(r)) sent.push(r.url());
  });
  await page.locator("[data-file-drop] input[type=file]").setInputFiles([{ name: "broken.jpg", mimeType: "image/jpeg", buffer: Buffer.alloc(5 * MB, 0x41) }]);
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toHaveAttribute("data-status", "failed", { timeout: 20_000 });
  await expect(rows(page).first()).toContainText("This photo could not be compressed. Try a smaller photo or a PDF.");
  await expect(page.getByRole("button", { name: /^Retry/ })).toHaveCount(0);
  await page.waitForTimeout(500);
  expect(sent).toEqual([]);
});
