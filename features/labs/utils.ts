/**
 * Pure utility functions for Labs & Diagnostic Documents
 */

/**
 * Computes deterministic auto-amended filename adhering to:
 * [Patient_Name]_[Original]_[Date].[ext] (Phase 4 Decision D-03)
 */
export function formatAmendedFilename(
  patientName: string,
  originalFilename: string,
  reportDate: string
): string {
  const cleanPatient = patientName.trim().replace(/[^a-zA-Z0-9]/g, "_");
  const ext = originalFilename.includes(".")
    ? originalFilename.split(".").pop() || "pdf"
    : "pdf";
  const baseName = originalFilename.replace(/\.[^/.]+$/, "");
  const cleanOriginal = baseName.replace(/[^a-zA-Z0-9_-]/g, "_");

  return `${cleanPatient}_${cleanOriginal}_${reportDate}.${ext}`;
}
