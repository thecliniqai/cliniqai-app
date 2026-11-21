import type { LabDocumentItem } from "./types";

/**
 * The part of a patient document the consult shows (V2-09b 09B-05, R-16): what the list needs and nothing that locates the object (no storage path, no
 * uploader). Client-safe. The bytes are opened only through the 5-minute signed link (`getDocumentSignedUrl`).
 */
export interface ConsultDocument {
  id: string;
  visit_id: string | null;
  title: string;
  original_filename: string;
  mime_type: string;
  file_size_bytes: number;
  /** Clinic date `YYYY-MM-DD`. */
  report_date: string;
  created_at: string;
}

export function toConsultDocument(doc: Pick<LabDocumentItem, keyof ConsultDocument>): ConsultDocument {
  return {
    id: doc.id,
    visit_id: doc.visit_id,
    title: doc.title,
    original_filename: doc.original_filename,
    mime_type: doc.mime_type,
    file_size_bytes: doc.file_size_bytes,
    report_date: doc.report_date,
    created_at: doc.created_at,
  };
}

/** A document title from a file name: the name without its extension, at most 255 characters. */
export function titleFromFilename(filename: string): string {
  const base = filename.replace(/\.[^/.]+$/, "").trim();
  return (base || filename.trim() || "Report").slice(0, 255);
}
