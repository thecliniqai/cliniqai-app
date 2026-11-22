/**
 * Pure utility functions for Labs & Diagnostic Documents
 */

/**
 * Computes the readable download filename [Patient_Name]_[Original]_[Date].[ext] (Phase 4 Decision D-03). Since V2-05
 * 05-02c (R-45) it is used ONLY as the signed URL's download name: never in a storage key, a log or an audit row (the
 * key is `labStorageKey`).
 */
export function formatAmendedFilename(
  patientName: string,
  originalFilename: string,
  reportDate: string
): string {
  const cleanPatient = patientName.trim().replace(/[^a-zA-Z0-9]/g, "_");
  // [A-Za-z0-9_.-] only: the name travels in the signed URL's `download` parameter.
  const rawExt = originalFilename.includes(".") ? originalFilename.split(".").pop() || "" : "";
  const ext = rawExt.replace(/[^a-zA-Z0-9]/g, "").slice(0, 10) || "pdf";
  const baseName = originalFilename.replace(/\.[^/.]+$/, "");
  const cleanOriginal = baseName.replace(/[^a-zA-Z0-9_-]/g, "_");

  return `${cleanPatient}_${cleanOriginal}_${reportDate}.${ext}`;
}

/**
 * The storage extension of an accepted type (V2-09b 09B-06a, S-6): taken from the type the server verified (the declared MIME type, checked against the
 * file's first bytes by `labFileSignatureMatches`), never from the client's file name, so `report.html` sent as `image/png` is stored as `.png`.
 */
const LAB_EXTENSION_BY_TYPE: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export function labStorageExtension(mimeType: string): string {
  return LAB_EXTENSION_BY_TYPE[mimeType] ?? "bin";
}

/**
 * The storage key of a lab document (V2-05 05-02c, R-45, T-05-41): ids only, so a key (and every signed-URL path) never names a person:
 * `tenants/<tenant>/patients/<patient>/labs/<object id>.<ext>`. The object id is the upload's client request id (09B-06a, A-4: a repeat of the same
 * upload names the same object), or the new row's id when the caller sent none; the extension comes from the verified type (S-6).
 */
export function labStorageKey(tenantId: string, patientId: string, objectId: string, mimeType: string): string {
  return `tenants/${tenantId}/patients/${patientId}/labs/${objectId}.${labStorageExtension(mimeType)}`;
}

/**
 * Does the file start with the signature of its declared type (09B-06a, S-6)? `%PDF-`; JPEG `FF D8 FF`; PNG `89 50 4E 47 0D 0A 1A 0A`; WEBP `RIFF` then
 * `WEBP` at offset 8. A file whose bytes do not match its label is refused, so the stored content type is the content.
 */
export function labFileSignatureMatches(mimeType: string, head: Uint8Array): boolean {
  const starts = (bytes: number[], offset = 0) => head.length >= offset + bytes.length && bytes.every((b, i) => head[offset + i] === b);
  switch (mimeType) {
    case "application/pdf":
      return starts([0x25, 0x50, 0x44, 0x46, 0x2d]);
    case "image/jpeg":
      return starts([0xff, 0xd8, 0xff]);
    case "image/png":
      return starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/webp":
      return starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8);
    default:
      return false;
  }
}

// C0 controls, DEL and C1 controls, and the Unicode bidirectional marks, embeddings, overrides and isolates (ALM, LRM, RLM, LRE..RLO, LRI..PDI).
const UNSAFE_NAME_CHARS = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
export const LAB_FILENAME_MAX = 255;

/**
 * The client's file name as it is stored (`patient_documents.original_filename`, 09B-06a, S-6): control and bidirectional-formatting characters removed
 * (a name such as `scan\u202Efdp.exe` cannot draw itself as `scanexe.pdf`), trimmed, at most 255 characters; `document` when nothing is left.
 */
export function cleanOriginalFilename(name: string): string {
  const cleaned = Array.from(name.replace(UNSAFE_NAME_CHARS, "").trim()).slice(0, LAB_FILENAME_MAX).join("");
  return cleaned || "document";
}

/**
 * What a lab or consult upload accepts (V2-09b 09B-05, R-16), exported once: the server (`uploadLabDocument`) and the upload control (`FileDrop`)
 * both read these, so the client check and the server check cannot drift. The client check is a courtesy; the server's is the one that counts.
 */
export const LAB_ACCEPTED_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"] as const;
// 09B-06a, ruling R-U: 4 MB. Production runs on Vercel, which refuses request bodies over 4.5 MB, so a larger file could never arrive (the server-action
// body limit is "4mb", next.config.ts). Uploads up to 25 MB need a direct-to-Storage upload: a PO decision (09B-REVIEW-TRIAGE R-U).
export const LAB_MAX_FILE_BYTES = 4 * 1024 * 1024; // 4 MB
export const LAB_MAX_FILE_LABEL = "4 MB";
export const LAB_INVALID_TYPE_MESSAGE = "Invalid file type. Allowed formats: PDF, JPEG, PNG, WEBP.";
export const LAB_TOO_LARGE_MESSAGE = "File is larger than 4 MB, the upload limit. Please upload a smaller file.";
/** The file's bytes do not match its type (09B-06a, S-6). */
export const LAB_CONTENT_MISMATCH_MESSAGE = "The file's content does not match its type. Upload a PDF, JPEG, PNG or WEBP file.";
/** A report linked to a visit whose record is signed, completed or cancelled (09B-06a, S-2 / A-8). */
export const LAB_VISIT_LOCKED_MESSAGE = "This visit's record is signed or closed. Reports can no longer be added to it.";

/**
 * The most a photo may weigh BEFORE it is compressed in the browser (V2-09c 09C-05, R-15): a phone photo is often 3 to 12 MB and goes up as a JPEG of at most
 * 1 MB. The server's own limit (4 MB, above) is applied to what is sent, not to what the camera made.
 */
export const LAB_MAX_IMAGE_INPUT_BYTES = 40 * 1024 * 1024;

/** The client check of a file the browser will compress when it is a picture: the type, then the size (an image up to `LAB_MAX_IMAGE_INPUT_BYTES`, any other file up to 4 MB). */
export function labClientFileRefusal(file: { type: string; size: number }): string | null {
  if (!(LAB_ACCEPTED_MIME_TYPES as readonly string[]).includes(file.type)) return LAB_INVALID_TYPE_MESSAGE;
  const limit = file.type.startsWith("image/") ? LAB_MAX_IMAGE_INPUT_BYTES : LAB_MAX_FILE_BYTES;
  if (file.size > limit) return LAB_TOO_LARGE_MESSAGE;
  return null;
}

/** The refusal text for a file the upload would not take, or null when it is acceptable (a type, then the size). */
export function labFileRefusal(file: { type: string; size: number }): string | null {
  if (!(LAB_ACCEPTED_MIME_TYPES as readonly string[]).includes(file.type)) return LAB_INVALID_TYPE_MESSAGE;
  if (file.size > LAB_MAX_FILE_BYTES) return LAB_TOO_LARGE_MESSAGE;
  return null;
}
