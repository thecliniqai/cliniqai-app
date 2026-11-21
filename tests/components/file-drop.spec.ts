/**
 * V2-09b 09B-05 (R-16, P1-24): the upload control's contract that does not need a browser: the client check is the server's own rule and texts (one
 * constant, `features/labs/utils.ts`), and the markup names the limits, offers the right types and has no camera attribute. The behaviour that needs a
 * DOM (a refused file sends no request, the status rows, Retry re-sends only the failed file, the drop) is proved in a real browser by
 * tests/e2e/consult/upload.spec.ts (the repository has no DOM test environment and this phase adds no dependency). Synthetic data only.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FileDrop } from "@/components/ui/file-drop";
import {
  LAB_ACCEPTED_MIME_TYPES,
  LAB_INVALID_TYPE_MESSAGE,
  LAB_MAX_FILE_BYTES,
  LAB_TOO_LARGE_MESSAGE,
  labFileRefusal,
  labStorageKey,
} from "@/features/labs/utils";
import { titleFromFilename } from "@/features/labs/consult-documents";

const MB = 1024 * 1024;
const props = { label: "Upload report", accept: LAB_ACCEPTED_MIME_TYPES, limitsText: "PDF, JPEG, PNG or WEBP, up to 25 MB each.", refuse: labFileRefusal, onUpload: async () => ({ ok: true as const }) };

describe("labFileRefusal: the one rule behind the control and the server", () => {
  it("accepts PDF, JPEG, PNG and WEBP up to exactly 25 MB", () => {
    for (const type of LAB_ACCEPTED_MIME_TYPES) expect(labFileRefusal({ type, size: 1 })).toBeNull();
    expect(labFileRefusal({ type: "application/pdf", size: LAB_MAX_FILE_BYTES })).toBeNull();
    expect(LAB_MAX_FILE_BYTES).toBe(25 * MB);
  });
  it("refuses 26 MB with the size text", () => {
    expect(labFileRefusal({ type: "application/pdf", size: 26 * MB })).toBe(LAB_TOO_LARGE_MESSAGE);
    expect(labFileRefusal({ type: "image/jpeg", size: LAB_MAX_FILE_BYTES + 1 })).toBe(LAB_TOO_LARGE_MESSAGE);
  });
  it("refuses an executable, an unknown type and an empty type with the type text, before the size", () => {
    expect(labFileRefusal({ type: "application/x-msdownload", size: 10 })).toBe(LAB_INVALID_TYPE_MESSAGE);
    expect(labFileRefusal({ type: "text/html", size: 10 })).toBe(LAB_INVALID_TYPE_MESSAGE);
    expect(labFileRefusal({ type: "", size: 10 })).toBe(LAB_INVALID_TYPE_MESSAGE);
    expect(labFileRefusal({ type: "application/x-msdownload", size: 30 * MB })).toBe(LAB_INVALID_TYPE_MESSAGE);
  });
  it("keeps the texts the server has always answered with", () => {
    expect(LAB_INVALID_TYPE_MESSAGE).toBe("Invalid file type. Allowed formats: PDF, JPEG, PNG, WEBP.");
    expect(LAB_TOO_LARGE_MESSAGE).toBe("File size exceeds the 25MB limit. Please upload a smaller file.");
  });
});

describe("FileDrop markup", () => {
  it("offers the picker with the accepted types, names the limits for assistive technology and has no camera capture", () => {
    const html = renderToStaticMarkup(createElement(FileDrop, props));
    expect(html).toContain('type="file"');
    expect(html).toContain('accept="application/pdf,image/jpeg,image/png,image/webp"');
    expect(html).toContain("multiple");
    expect(html).not.toContain("capture");
    const limitsId = /id="([^"]+-limits)"/.exec(html)?.[1];
    expect(limitsId).toBeTruthy();
    expect(html).toContain(`aria-describedby="${limitsId}"`);
    expect(html).toContain("up to 25 MB each");
    expect(html).toContain(">Upload report<");
    // The hidden input is never a second control for a screen reader: the button is the one.
    expect(html).toMatch(/<input[^>]*aria-hidden="true"/);
  });
  it("disabled: the input and the button are disabled and the reason replaces the prompt", () => {
    const html = renderToStaticMarkup(createElement(FileDrop, { ...props, disabled: true, disabledReason: "Your role cannot upload reports." }));
    expect(html).toContain("Your role cannot upload reports.");
    expect(html).not.toContain("Drop files here");
    expect(html.match(/disabled=""/g)?.length).toBeGreaterThanOrEqual(2);
    expect(html).toContain('data-disabled="true"');
  });
  it("draws no status rows before a file is chosen", () => {
    expect(renderToStaticMarkup(createElement(FileDrop, props))).not.toContain("data-file-row");
  });
});

describe("what a consult upload sends and where it lands", () => {
  it("the title is the file name without its extension, at most 255 characters", () => {
    expect(titleFromFilename("CBC report 2026.pdf")).toBe("CBC report 2026");
    expect(titleFromFilename("noextension")).toBe("noextension");
    expect(titleFromFilename(".pdf")).toBe(".pdf");
    expect(titleFromFilename(`${"a".repeat(300)}.pdf`)).toHaveLength(255);
  });
  it("the object key holds ids only, never the file name's words", () => {
    const key = labStorageKey("t1", "p1", "d1", "Ramesh Kumar CBC.PDF");
    expect(key).toBe("tenants/t1/patients/p1/labs/d1.pdf");
    expect(key).not.toMatch(/ramesh|kumar|cbc/i);
  });
});
