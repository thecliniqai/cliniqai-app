import { PatientDocument, DocumentType } from "@/lib/db/types";

export type { PatientDocument, DocumentType };

export interface LabDocumentItem extends PatientDocument {
  uploaded_by_name?: string | null;
  visit_date?: string | null;
  signed_url?: string | null;
}

export interface UploadLabDocumentInput {
  patient_id: string;
  visit_id?: string | null;
  title: string;
  document_type: DocumentType;
  report_date: string;
  notes?: string | null;
  is_abnormal?: boolean;
}

export interface ShareTokenResult {
  success: boolean;
  token?: string;
  shareUrl?: string;
  expiresAt?: string;
  error?: string;
}

export interface DeleteLabDocumentResult {
  success: boolean;
  error?: string;
}
