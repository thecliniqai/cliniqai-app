import "server-only";

import { createShareToken } from "@/features/sharing/tokens";
import { assertPerm } from "@/lib/permissions";
import type { ServiceContext } from "@/lib/auth/context";
import { FOREIGN_REFERENCE_MESSAGE, visitInTenant } from "@/lib/auth/tenant-refs";
import { recordAudit } from "@/lib/audit/audit";
import { PatientDocument } from "@/lib/db/types";
import { uploadFile, getSignedUrl, deleteFile, getStorageProviderForDb } from "@/lib/storage";
import { isPatientStoragePath } from "@/lib/storage/tenant-path";
import { uploadLabDocumentSchema, generateShareTokenSchema } from "./schema";
import { LabDocumentItem, ShareTokenResult, DeleteLabDocumentResult } from "./types";
import { formatAmendedFilename } from "./utils";
import { enqueueMessage } from "@/lib/messaging/dispatcher";
import { enqueueWebhookEvent } from "@/lib/webhooks/outbox";

const ALLOWED_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB

export type UploadLabDocumentResult =
  | { success: true; document: PatientDocument }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

/**
 * Uploads a patient diagnostic lab report or document, enforces auto-amended naming,
 * archives to private storage, and stores document record in PostgreSQL.
 */
export async function uploadLabDocument(ctx: ServiceContext, formData: FormData): Promise<UploadLabDocumentResult> {
  const supabase = ctx.db;

  try {
    assertPerm(ctx.role, "patients:edit");
    const session = ctx;

    // 1. Extract and validate file
    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      return { success: false, error: "Please select a valid document file to upload." };
    }

    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      return {
        success: false,
        error: "Invalid file type. Allowed formats: PDF, JPEG, PNG, WEBP.",
      };
    }

    if (file.size > MAX_FILE_SIZE) {
      return {
        success: false,
        error: "File size exceeds the 25MB limit. Please upload a smaller file.",
      };
    }

    // 2. Validate metadata
    const rawInput = {
      patient_id: formData.get("patient_id"),
      visit_id: formData.get("visit_id") || undefined,
      title: formData.get("title"),
      document_type: formData.get("document_type") || "lab_report",
      report_date: formData.get("report_date") || new Date().toISOString().split("T")[0],
      notes: formData.get("notes") || undefined,
      is_abnormal: formData.get("is_abnormal"),
    };

    const parseResult = uploadLabDocumentSchema.safeParse(rawInput);
    if (!parseResult.success) {
      const fieldErrors: Record<string, string[]> = {};
      for (const issue of parseResult.error.issues) {
        const field = issue.path[0]?.toString() || "form";
        fieldErrors[field] = fieldErrors[field] || [];
        fieldErrors[field].push(issue.message);
      }
      return { success: false, error: "Validation failed.", fieldErrors };
    }

    const { patient_id, visit_id, title, document_type, report_date, notes, is_abnormal } = parseResult.data;

    // 3. Fetch patient name for filename auto-amendment
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: patient, error: patientErr } = await (supabase.from("patients") as any)
      .select("full_name")
      .eq("id", patient_id)
      .eq("tenant_id", session.tenantId)
      .single();

    if (patientErr || !patient) {
      return { success: false, error: "Patient record not found." };
    }

    // A linked visit must be this clinic's and this patient's (P0-13 / IR-F1: the FK references the visit id alone).
    if (visit_id && !(await visitInTenant(ctx, visit_id, patient_id))) {
      return { success: false, error: FOREIGN_REFERENCE_MESSAGE };
    }

    // 4. Compute amended filename & storage path
    const amendedFilename = formatAmendedFilename(patient.full_name, file.name, report_date);
    const storagePath = `tenants/${session.tenantId}/patients/${patient_id}/labs/${amendedFilename}`;

    // 5. Read buffer and upload via unified storage abstraction
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const storageProvider = getStorageProviderForDb(ctx.db, "clinic-records");

    await uploadFile(
      {
        path: storagePath,
        buffer,
        contentType: file.type,
        bucket: "clinic-records",
        upsert: true,
      },
      storageProvider
    );

    // 6. Insert row into patient_documents
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: newDoc, error: insertErr } = await (supabase.from("patient_documents") as any)
      .insert({
        tenant_id: session.tenantId,
        patient_id,
        visit_id: visit_id || null,
        title,
        document_type,
        original_filename: file.name,
        storage_path: storagePath,
        file_size_bytes: file.size,
        mime_type: file.type,
        report_date,
        notes: notes || null,
        is_abnormal,
        uploaded_by: session.userId,
      })
      .select("*")
      .single();

    if (insertErr || !newDoc) {
      console.error("[features/labs/actions] Failed to insert patient_document row:", insertErr);
      return { success: false, error: "Failed to save document metadata in clinic database." };
    }

    // 7. Audit logging
    await recordAudit(ctx, {
      action: "patient_document.upload",
      entityType: "patient_document",
      entityId: newDoc.id,
      metadata: {
        patient_id,
        title,
        storage_path: storagePath,
        file_size_bytes: file.size,
        is_abnormal,
      },
    });

    // 8. Enqueue webhook event: lab_result.ready
    try {
      await enqueueWebhookEvent(
        supabase,
        session.tenantId,
        "lab_result.ready",
        {
          document_id: newDoc.id,
          patient_id: newDoc.patient_id,
          title: newDoc.title,
        }
      );
    } catch (webhookErr) {
      console.warn("[uploadLabDocument] Failed to enqueue webhook event:", webhookErr);
    }

    return { success: true, document: newDoc };
  } catch (err: unknown) {
    console.error("[features/labs/actions] uploadLabDocument exception:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "An unexpected error occurred during upload.",
    };
  }
}

/**
 * Retrieves all lab documents and diagnostic records for a specific patient.
 */
export async function getPatientDocuments(
  ctx: ServiceContext,
  patientId: string
): Promise<{ success: boolean; documents: LabDocumentItem[]; error?: string }> {
  const supabase = ctx.db;

  try {
    assertPerm(ctx.role, "patients:view");
    const session = ctx;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from("patient_documents") as any)
      .select("*, visits(scheduled_at, created_at)")
      .eq("patient_id", patientId)
      .eq("tenant_id", session.tenantId)
      .order("report_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[features/labs/actions] getPatientDocuments error:", error);
      return { success: false, documents: [], error: "Failed to retrieve patient documents." };
    }

    const documents: LabDocumentItem[] = (data || []).map((doc: any) => ({
      ...doc,
      visit_date: doc.visits?.scheduled_at || doc.visits?.created_at || null,
    }));

    return { success: true, documents };
  } catch (err: unknown) {
    console.error("[features/labs/actions] getPatientDocuments exception:", err);
    return {
      success: false,
      documents: [],
      error: err instanceof Error ? err.message : "Failed to load documents.",
    };
  }
}

/**
 * Generates a short-lived 3600-second signed URL for authorized staff to view/download a document.
 */
export async function getDocumentSignedUrl(
  ctx: ServiceContext,
  documentId: string
): Promise<{ success: boolean; signedUrl?: string; error?: string }> {
  const supabase = ctx.db;

  try {
    assertPerm(ctx.role, "patients:view");
    const session = ctx;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: doc, error } = await (supabase.from("patient_documents") as any)
      .select("storage_path, original_filename, patient_id")
      .eq("id", documentId)
      .eq("tenant_id", session.tenantId)
      .single();

    if (error || !doc) {
      return { success: false, error: "Document not found or access denied." };
    }

    // Only a key under this document's own tenant and patient is signed (AR-M1; same rule as 000021).
    if (!isPatientStoragePath(session.tenantId, doc.patient_id, doc.storage_path)) {
      return { success: false, error: "Document not found or access denied." };
    }

    const storageProvider = getStorageProviderForDb(ctx.db, "clinic-records");

    const { signedUrl } = await getSignedUrl(
      {
        path: doc.storage_path,
        bucket: "clinic-records",
        expiresInSeconds: 3600,
        downloadFilename: doc.original_filename,
      },
      storageProvider
    );

    return { success: true, signedUrl };
  } catch (err: unknown) {
    console.error("[features/labs/actions] getDocumentSignedUrl exception:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to generate download URL.",
    };
  }
}

/**
 * Generates a 64-hex cryptographically secure share token with 7-day TTL for zero-login patient viewing.
 */
export async function generateDocumentShareToken(ctx: ServiceContext, documentId: string): Promise<ShareTokenResult> {
  const supabase = ctx.db;

  try {
    assertPerm(ctx.role, "patients:view");
    const session = ctx;

    const parseResult = generateShareTokenSchema.safeParse({ document_id: documentId });
    if (!parseResult.success) {
      return { success: false, error: "Invalid document ID." };
    }

    // 1. Verify document belongs to active tenant
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: doc, error: docErr } = await (supabase.from("patient_documents") as any)
      .select("id, patient_id")
      .eq("id", documentId)
      .eq("tenant_id", session.tenantId)
      .single();

    if (docErr || !doc) {
      return { success: false, error: "Document not found or access denied." };
    }

    // 2. 64-hex token (256-bit) with a 7-day TTL, minted by create_share_token (tenant from the document row, P0-04)
    const created = await createShareToken(supabase, "patient_document", documentId);
    if (!created) {
      return { success: false, error: "Failed to generate patient share link." };
    }
    const { token, expiresAt } = created;

    // 4. Audit logging
    await recordAudit(ctx, {
      action: "patient_document.generate_share_token",
      entityType: "patient_document",
      entityId: documentId,
      metadata: {
        expires_at: expiresAt,
      },
    });

    const shareUrl = `/reports/view?token=${token}`;
    return {
      success: true,
      token,
      shareUrl,
      expiresAt,
    };
  } catch (err: unknown) {
    console.error("[features/labs/actions] generateDocumentShareToken exception:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to create share link.",
    };
  }
}

/**
 * Deletes a lab report document from storage and database under multi-tenant RLS checks.
 */
export async function deleteLabDocument(ctx: ServiceContext, documentId: string): Promise<DeleteLabDocumentResult> {
  const supabase = ctx.db;

  try {
    assertPerm(ctx.role, "patients:edit");
    const session = ctx;

    // 1. Fetch document storage path
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: doc, error: fetchErr } = await (supabase.from("patient_documents") as any)
      .select("id, patient_id, storage_path, title")
      .eq("id", documentId)
      .eq("tenant_id", session.tenantId)
      .single();

    if (fetchErr || !doc) {
      return { success: false, error: "Document not found or access denied." };
    }

    // 2. Delete the storage object, only when the stored key is this patient's own (AR2-L5: same rule as
    // getDocumentSignedUrl). A key outside tenants/<tenant>/patients/<patient>/ is never acted on (with R2's bucket-wide
    // credentials it could name any object); the row is still removed.
    const ownKey = isPatientStoragePath(session.tenantId, doc.patient_id, doc.storage_path);
    if (ownKey) {
      const storageProvider = getStorageProviderForDb(ctx.db, "clinic-records");
      try {
        await deleteFile(
          {
            path: doc.storage_path,
            bucket: "clinic-records",
          },
          storageProvider
        );
      } catch (storageErr) {
        console.warn(
          "[features/labs/actions] Storage file deletion warning:",
          storageErr instanceof Error ? storageErr.name : "error"
        );
      }
    } else {
      console.warn("[features/labs/actions] Stored key outside the patient prefix; storage object not deleted.");
    }

    // 3. Delete database record
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: deleteErr } = await (supabase.from("patient_documents") as any)
      .delete()
      .eq("id", documentId)
      .eq("tenant_id", session.tenantId);

    if (deleteErr) {
      console.error("[features/labs/actions] Failed to delete document row:", deleteErr);
      return { success: false, error: "Failed to delete document from database." };
    }

    // 4. Audit logging
    await recordAudit(ctx, {
      action: "patient_document.delete",
      entityType: "patient_document",
      entityId: documentId,
      metadata: {
        patient_id: doc.patient_id,
        title: doc.title,
        // No storage_path: the key embeds the patient's name (AR2-L5, as AR-L5 for the v1 lab-order audit).
      },
    });

    return { success: true };
  } catch (err: unknown) {
    console.error("[features/labs/actions] deleteLabDocument exception:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to delete document.",
    };
  }
}

/**
 * Shares an uploaded diagnostic lab report or document via WhatsApp with a 7-day secure tokenized link (/r/[token]).
 * Enqueues Event #7 (lab_report_uploaded) outbox notification.
 */
export async function shareLabReportViaWhatsApp(
  ctx: ServiceContext,
  documentId: string
): Promise<{ success: boolean; shareUrl?: string; token?: string; error?: string }> {
  const supabase = ctx.db;

  try {
    assertPerm(ctx.role, "patients:view");
    const session = ctx;

    // 1. Fetch document record joined with patient and tenant
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: doc, error: docErr } = await (supabase.from("patient_documents") as any)
      .select("*, patient:patients(id, full_name, phone), tenant:tenants(name, phone)")
      .eq("id", documentId)
      .eq("tenant_id", session.tenantId)
      .single();

    if (docErr || !doc) {
      return { success: false, error: "Patient document not found." };
    }

    if (!doc.patient?.phone) {
      return { success: false, error: "Patient does not have a phone number registered." };
    }

    // 2. Secure 64-character token via create_share_token (P0-04)
    const created = await createShareToken(supabase, "patient_document", documentId);
    if (!created) {
      return { success: false, error: "Failed to generate secure share link." };
    }
    const { token } = created;

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const shareUrl = `${baseUrl}/r/${token}`;

    // 3. Enqueue Event #7 (lab_report_uploaded)
    await enqueueMessage(
      supabase,
      {
        tenantId: session.tenantId,
        patientId: doc.patient_id,
        channel: "whatsapp",
        messageType: "lab_report_uploaded",
        templateId: "lab_report_uploaded",
        templateParams: {
          patient_name: doc.patient.full_name || "Patient",
          clinic_name: doc.tenant?.name || "Clinic",
          document_url: shareUrl,
          document_title: doc.title,
        },
        recipientPhone: doc.patient.phone,
        // No token or link in metadata (AR3-N1); the link travels only in template_params, redacted after sending.
        metadata: {
          document_id: documentId,
        },
      }
    );

    // 4. Record audit log
    await recordAudit(ctx, {
      action: "patient_document.share_whatsapp",
      entityType: "patient_document",
      entityId: documentId,
      // No token or phone in the audit trail (AR-L5); the link itself is audited by create_share_token (000021).
    });

    return { success: true, shareUrl, token };
  } catch (err: unknown) {
    console.error("[features/labs/actions] shareLabReportViaWhatsApp error:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to share lab report.",
    };
  }
}
