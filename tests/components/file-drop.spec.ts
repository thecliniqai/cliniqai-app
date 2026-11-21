/**
 * V2-09b 09B-05 (R-16, P1-24): the upload control's contract that does not need a browser: the client check is the server's own rule and texts (one
 * constant, `features/labs/utils.ts`), and the markup names the limits, offers the right types and has no camera attribute. The behaviour that needs a
 * DOM (a refused file sends no request, the status rows, Retry re-sends only the failed file, the drop) is proved in a real browser by
 * tests/e2e/consult/upload.spec.ts (the repository has no DOM test environment and this phase adds no dependency). Synthetic data only.
 * 09B-06a: the limit is 4 MB (ruling R-U); the storage extension comes from the verified type and the file's first bytes must match it (S-6).
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
  cleanOriginalFilename,
  labFileRefusal,
  labFileSignatureMatches,
  labStorageKey,
} from "@/features/labs/utils";
import { titleFromFilename } from "@/features/labs/consult-documents";

const MB = 1024 * 1024;
const props = { label: "Upload report", accept: LAB_ACCEPTED_MIME_TYPES, limitsText: "PDF, JPEG, PNG or WEBP, up to 4 MB each.", refuse: labFileRefusal, onUpload: async () => ({ ok: true as const }) };

describe("labFileRefusal: the one rule behind the control and the server", () => {
  it("accepts PDF, JPEG, PNG and WEBP up to exactly 4 MB (09B-06a, R-U: Vercel refuses bodies over 4.5 MB)", () => {
    for (const type of LAB_ACCEPTED_MIME_TYPES) expect(labFileRefusal({ type, size: 1 })).toBeNull();
    expect(labFileRefusal({ type: "application/pdf", size: LAB_MAX_FILE_BYTES })).toBeNull();
    expect(LAB_MAX_FILE_BYTES).toBe(4 * MB);
  });
  it("refuses 4 MB + 1 byte and 26 MB with the size text", () => {
    expect(labFileRefusal({ type: "application/pdf", size: 26 * MB })).toBe(LAB_TOO_LARGE_MESSAGE);
    expect(labFileRefusal({ type: "image/jpeg", size: LAB_MAX_FILE_BYTES + 1 })).toBe(LAB_TOO_LARGE_MESSAGE);
  });
  it("refuses an executable, an unknown type and an empty type with the type text, before the size", () => {
    expect(labFileRefusal({ type: "application/x-msdownload", size: 10 })).toBe(LAB_INVALID_TYPE_MESSAGE);
    expect(labFileRefusal({ type: "text/html", size: 10 })).toBe(LAB_INVALID_TYPE_MESSAGE);
    expect(labFileRefusal({ type: "", size: 10 })).toBe(LAB_INVALID_TYPE_MESSAGE);
    expect(labFileRefusal({ type: "application/x-msdownload", size: 30 * MB })).toBe(LAB_INVALID_TYPE_MESSAGE);
  });
  it("keeps the type text and names the 4 MB limit", () => {
    expect(LAB_INVALID_TYPE_MESSAGE).toBe("Invalid file type. Allowed formats: PDF, JPEG, PNG, WEBP.");
    expect(LAB_TOO_LARGE_MESSAGE).toBe("File is larger than 4 MB, the upload limit. Please upload a smaller file.");
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
    expect(html).toContain("up to 4 MB each");
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
  it("the object key holds ids only, and its extension is the verified type's, never the file name's (09B-06a, S-6)", () => {
    expect(labStorageKey("t1", "p1", "d1", "application/pdf")).toBe("tenants/t1/patients/p1/labs/d1.pdf");
    expect(labStorageKey("t1", "p1", "d1", "image/jpeg")).toBe("tenants/t1/patients/p1/labs/d1.jpg");
    expect(labStorageKey("t1", "p1", "d1", "image/png")).toBe("tenants/t1/patients/p1/labs/d1.png");
    expect(labStorageKey("t1", "p1", "d1", "image/webp")).toBe("tenants/t1/patients/p1/labs/d1.webp");
  });
});

describe("S-6 (09B-06a): the content is what the type says; the stored name is safe", () => {
  const bytes = (...b: number[]) => Uint8Array.from(b);
  const ascii = (text: string) => Uint8Array.from(Buffer.from(text, "latin1"));
  it("accepts each type's signature", () => {
    expect(labFileSignatureMatches("application/pdf", ascii("%PDF-1.7\n"))).toBe(true);
    expect(labFileSignatureMatches("image/jpeg", bytes(0xff, 0xd8, 0xff, 0xe0))).toBe(true);
    expect(labFileSignatureMatches("image/png", bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe(true);
    expect(labFileSignatureMatches("image/webp", ascii("RIFF\x10\x00\x00\x00WEBPVP8 "))).toBe(true);
  });
  it("refuses bytes that are not the declared type, a short file and an unknown type", () => {
    expect(labFileSignatureMatches("image/png", ascii("<html><body>"))).toBe(false);
    expect(labFileSignatureMatches("application/pdf", bytes(0x89, 0x50, 0x4e, 0x47))).toBe(false);
    expect(labFileSignatureMatches("image/jpeg", bytes(0xff, 0xd8))).toBe(false);
    expect(labFileSignatureMatches("image/webp", ascii("RIFF\x10\x00\x00\x00WAVEfmt "))).toBe(false);
    expect(labFileSignatureMatches("text/html", ascii("%PDF-1.7"))).toBe(false);
  });
  it("strips control and bidi characters from the stored file name and caps it at 255", () => {
    expect(cleanOriginalFilename("scan\u202Egpj.exe")).toBe("scangpj.exe");
    expect(cleanOriginalFilename("a\u0000b\u001fc\u0085d\u200Fe\u2066f\u2069.pdf")).toBe("abcdef.pdf");
    expect(cleanOriginalFilename("  CBC report.pdf  ")).toBe("CBC report.pdf");
    expect(cleanOriginalFilename("x".repeat(300))).toHaveLength(255);
    expect(cleanOriginalFilename("\u202E\u0007")).toBe("document");
  });
});
