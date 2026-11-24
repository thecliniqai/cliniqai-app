"use server";

import { revalidatePath } from "next/cache";
import { resolveServiceContext } from "@/lib/auth/context";
import * as labsService from "./service";
import type { UploadLabDocumentResult } from "./service";
import { LabDocumentItem, ShareTokenResult } from "./types";
import { markAction } from "@/lib/observability/db-timing";

export type { UploadLabDocumentResult } from "./service";

// Each action authenticates and checks permission before it reads any input and derives the tenant and actor from
// the session (ADR-0005 D1), then delegates to the server-only service. Failure shapes are unchanged.

function revalidate(path: string, type?: "page") {
  try {
    revalidatePath(path, type);
  } catch {
    // Outside a Next.js request (tests) revalidation is a no-op
  }
}

/**
 * Uploads a patient diagnostic lab report or document (auto-amended name, private storage, metadata row).
 */
export async function uploadLabDocument(formData: FormData): Promise<UploadLabDocumentResult> {
  await markAction("labs.upload_lab_document");
  const resolved = await resolveServiceContext("labs:edit");
  if (!resolved.ok) return { success: false, error: resolved.error };
  const result = await labsService.uploadLabDocument(resolved.ctx, formData);
  if (result.success) revalidate(`/patients/${result.document.patient_id}`);
  return result;
}

/**
 * Retrieves all lab documents and diagnostic records for a specific patient.
 */
export async function getPatientDocuments(
  patientId: string
): Promise<{ success: boolean; documents: LabDocumentItem[]; error?: string }> {
  await markAction("labs.get_patient_documents");
  const resolved = await resolveServiceContext("labs:view");
  if (!resolved.ok) return { success: false, documents: [], error: resolved.error };
  return labsService.getPatientDocuments(resolved.ctx, patientId);
}

/**
 * Generates a short-lived (5-minute, `VIEW_LINK_TTL_SECONDS`) signed URL for authorized staff to view/download a document.
 */
export async function getDocumentSignedUrl(
  documentId: string
): Promise<{ success: boolean; signedUrl?: string; error?: string }> {
  await markAction("labs.get_document_signed_url");
  const resolved = await resolveServiceContext("labs:view");
  if (!resolved.ok) return { success: false, error: resolved.error };
  return labsService.getDocumentSignedUrl(resolved.ctx, documentId);
}

/**
 * Generates a 7-day patient share token for a document.
 */
export async function generateDocumentShareToken(documentId: string): Promise<ShareTokenResult> {
  await markAction("labs.generate_document_share_token");
  const resolved = await resolveServiceContext("labs:view");
  if (!resolved.ok) return { success: false, error: resolved.error };
  return labsService.generateDocumentShareToken(resolved.ctx, documentId);
}

/**
 * Shares a lab document via WhatsApp with a 7-day tokenized link (Event #7 outbox notification).
 */
export async function shareLabReportViaWhatsApp(
  documentId: string
): Promise<{ success: boolean; shareUrl?: string; token?: string; error?: string }> {
  await markAction("labs.share_lab_report_via_whats_app");
  const resolved = await resolveServiceContext("labs:view");
  if (!resolved.ok) return { success: false, error: resolved.error };
  return labsService.shareLabReportViaWhatsApp(resolved.ctx, documentId);
}
