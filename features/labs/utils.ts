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

/** The lower-case extension of an uploaded file for its storage key: [a-z0-9]{1,10}, `pdf` when there is none. */
export function labStorageExtension(originalFilename: string): string {
  const rawExt = originalFilename.includes(".") ? originalFilename.split(".").pop() || "" : "";
  return rawExt.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 10) || "pdf";
}

/**
 * The storage key of a lab document (V2-05 05-02c, R-45, T-05-41): ids only, so a key (and every signed-URL path) never
 * names a person: `tenants/<tenant>/patients/<patient>/labs/<document id>.<ext>`. The document id is the
 * `patient_documents.id` inserted after the upload, so two uploads never share a key.
 */
export function labStorageKey(tenantId: string, patientId: string, documentId: string, originalFilename: string): string {
  return `tenants/${tenantId}/patients/${patientId}/labs/${documentId}.${labStorageExtension(originalFilename)}`;
}
