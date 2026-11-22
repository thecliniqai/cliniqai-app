/**
 * V2-09c 09C-04 (R-12; roadmap acceptance 2): golden files of the prescription PDF. Fixed synthetic payloads are rendered; for each case two renders give the
 * same bytes (the document's dates are the version's signature, so a signed version is reproducible), the bytes equal `golden/<case>.pdf`, the text the pages
 * show equals `golden/<case>.txt`, and the page size is the expected one. The text file is the readable diff; the .pdf is the byte contract.
 *
 * Goldens are rewritten only on purpose: `UPDATE_GOLDEN=1 npx vitest run tests/prescriptions/rx-golden.spec.ts` when the template changes, then the text diff is
 * reviewed (an `@react-pdf` upgrade changes the bytes and leaves the text alone; an archived version keeps the bytes it was signed with). Synthetic data only.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REGENERATED_COPY_NOTICE, renderPrescriptionPdf } from "@/features/prescriptions/pdf/generator";
import type { PrescriptionPdfPayload } from "@/features/prescriptions/pdf/types";
import { PAGE_A4, PAGE_A5, pdfPageSizes, pdfTextLines } from "../helpers/pdf-text";
import { basePayload, longPayload } from "../helpers/rx-pdf-fixtures";

const DIR = path.join(__dirname, "golden");
const UPDATE = process.env.UPDATE_GOLDEN === "1";

interface GoldenCase {
  name: string;
  payload: () => PrescriptionPdfPayload;
  pages: number;
  size: { width: number; height: number };
}

/** A short Rx (no vitals, exam, investigations or advice): what a typical A5 pad carries on one sheet. */
const compact = (over: Partial<PrescriptionPdfPayload> = {}): PrescriptionPdfPayload => {
  const base = basePayload();
  return basePayload({
    visit: { ...base.visit, vitals: null, exam: null, chief_complaints: [{ symptom: "Fever", duration_val: 3, duration_unit: "days" }] },
    medications: base.medications.slice(0, 2),
    investigations_advised: [],
    advice: [],
    ...over,
  });
};

const CASES: GoldenCase[] = [
  { name: "a4-blank-paper", payload: () => basePayload(), pages: 1, size: PAGE_A4 },
  { name: "a4-preprinted-margins", payload: () => basePayload({ letterhead_mode: "preprinted_letterhead", letterhead_margins: { top: 114, bottom: 60 } }), pages: 1, size: PAGE_A4 },
  { name: "a5-blank-paper", payload: () => compact({ paper_size: "A5" }), pages: 1, size: PAGE_A5 },
  { name: "a5-full-runs-on", payload: () => basePayload({ paper_size: "A5" }), pages: 2, size: PAGE_A5 },
  { name: "a5-preprinted-margins", payload: () => compact({ paper_size: "A5", letterhead_mode: "preprinted_letterhead", letterhead_margins: { top: 90, bottom: 50 } }), pages: 1, size: PAGE_A5 },
  {
    name: "a4-amended-v2",
    payload: () => basePayload({ version: 2, amendment_reason: "Dose of cetirizine corrected after review", amended_at: "2026-11-21T04:00:00.000Z", signed_at: "2026-11-21T04:05:00.000Z" }),
    pages: 1,
    size: PAGE_A4,
  },
  { name: "a4-regenerated-copy", payload: () => basePayload({ regenerated_notice: REGENERATED_COPY_NOTICE }), pages: 1, size: PAGE_A4 },
  { name: "a4-two-pages", payload: () => longPayload(), pages: 2, size: PAGE_A4 },
  { name: "a5-two-pages-preprinted", payload: () => ({ ...longPayload(), paper_size: "A5", letterhead_mode: "preprinted_letterhead" }), pages: 3, size: PAGE_A5 },
  {
    name: "a4-outside-standard-fonts",
    payload: () =>
      basePayload({
        patient: { full_name: "रमेश Ünïcode", age: 41, sex: "male", phone: null, address: null, abha_id: null, uhid: "AB12CD34" },
        medications: [{ medicine_name: "पैरासिटामोल 650", dosage: "1-0-1", timing: null, duration: "5 days" }],
      }),
    pages: 1,
    size: PAGE_A4,
  },
];

describe("prescription PDF goldens", () => {
  if (UPDATE && !existsSync(DIR)) mkdirSync(DIR, { recursive: true });

  it.each(CASES)("$name: two renders are identical bytes, the bytes and the text equal the golden files, the page size is right", async (c) => {
    const first = await renderPrescriptionPdf(c.payload());
    const second = await renderPrescriptionPdf(c.payload());
    // Reproducible: the same signed version renders to the same bytes.
    expect(createHash("sha256").update(second).digest("hex")).toBe(createHash("sha256").update(first).digest("hex"));
    expect(Buffer.compare(first, second)).toBe(0);

    const sizes = pdfPageSizes(first);
    expect(sizes).toHaveLength(c.pages);
    for (const size of sizes) expect(size).toEqual(c.size);
    // The standard fonts write the bullet as the WinAnsi code 0x95; the text file shows it as a bullet so a diff is readable.
    const text = pdfTextLines(first).join("\n").replace(/\u0095/g, "•") + "\n";

    const pdfFile = path.join(DIR, `${c.name}.pdf`);
    const txtFile = path.join(DIR, `${c.name}.txt`);
    if (UPDATE) {
      writeFileSync(pdfFile, first);
      writeFileSync(txtFile, text);
    }
    expect(existsSync(pdfFile), `golden ${c.name}.pdf is missing (UPDATE_GOLDEN=1 writes it)`).toBe(true);
    // The text first: a template change shows as a readable diff before the bytes are compared.
    expect(text).toBe(readFileSync(txtFile, "utf8"));
    expect(Buffer.compare(first, readFileSync(pdfFile))).toBe(0);
  });

  it("the golden files are small: the PDFs use the standard fonts (no embedded font)", () => {
    for (const c of CASES) {
      const size = statSync(path.join(DIR, `${c.name}.pdf`)).size;
      expect(size, c.name).toBeLessThan(60_000);
    }
  });
});
