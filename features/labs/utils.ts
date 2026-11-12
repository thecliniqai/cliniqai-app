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
  // The extension is part of the storage key, so it gets the same [A-Za-z0-9] treatment as the rest (AR2-H1: keys are
  // [A-Za-z0-9_./-] only, enforced again by the patient_documents CHECK in 000022).
  const rawExt = originalFilename.includes(".") ? originalFilename.split(".").pop() || "" : "";
  const ext = rawExt.replace(/[^a-zA-Z0-9]/g, "").slice(0, 10) || "pdf";
  const baseName = originalFilename.replace(/\.[^/.]+$/, "");
  const cleanOriginal = baseName.replace(/[^a-zA-Z0-9_-]/g, "_");

  return `${cleanPatient}_${cleanOriginal}_${reportDate}.${ext}`;
}
