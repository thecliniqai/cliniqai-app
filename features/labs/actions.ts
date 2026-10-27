"use server";

import { revalidatePath } from "next/cache";
import crypto from "crypto";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/permissions/guards";
import { recordAudit } from "@/lib/audit/audit";
import { Database, PatientDocument } from "@/lib/db/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { uploadFile, getSignedUrl, deleteFile, SupabaseStorageProvider } from "@/lib/storage";
import { uploadLabDocumentSchema, generateShareTokenSchema } from "./schema";
import {
  LabDocumentItem,
  ShareTokenResult,
  DeleteLabDocumentResult,
} from "./types";
import { formatAmendedFilename } from "./utils";
import { enqueueMessage } from "@/lib/messaging/dispatcher";

const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
];
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB

export type UploadLabDocumentResult =
  | { success: true; document: PatientDocument }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

/**
 * Uploads a patient diagnostic lab report or document, enforces auto-amended naming,
 * archives to private storage, and stores document record in PostgreSQL.
 */
export async function uploadLabDocument(
  formData: FormData,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  clientOverride?: SupabaseClient<Database, any, any>,
  sessionOverride?: { userId: string; tenantId: string }
): Promise<UploadLabDocumentResult> {
  const supabase = clientOverride || (await createClient());

  try {
    const session = sessionOverride || (await requirePermission("patients:edit"));

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

    const { patient_id, visit_id, title, document_type, report_date, notes, is_abnormal } =
      parseResult.data;

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

    // 4. Compute amended filename & storage path
    const amendedFilename = formatAmendedFilename(
      patient.full_name,
      file.name,
      report_date
    );
    const storagePath = `tenants/${session.tenantId}/patients/${patient_id}/labs/${amendedFilename}`;

    // 5. Read buffer and upload via unified storage abstraction
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const storageProvider = clientOverride
      ? new SupabaseStorageProvider({ defaultBucket: "clinic-records", client: clientOverride })
      : undefined;

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
    await recordAudit(
      {
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
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      clientOverride as any,
      session
    );

    try {
      revalidatePath(`/patients/${patient_id}`);
    } catch {
      // Non-web contexts
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
  patientId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  clientOverride?: SupabaseClient<Database, any, any>,
  sessionOverride?: { userId: string; tenantId: string }
): Promise<{ success: boolean; documents: LabDocumentItem[]; error?: string }> {
  const supabase = clientOverride || (await createClient());

  try {
    const session = sessionOverride || (await requirePermission("patients:view"));

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
  documentId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  clientOverride?: SupabaseClient<Database, any, any>,
  sessionOverride?: { userId: string; tenantId: string }
): Promise<{ success: boolean; signedUrl?: string; error?: string }> {
  const supabase = clientOverride || (await createClient());

  try {
    const session = sessionOverride || (await requirePermission("patients:view"));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: doc, error } = await (supabase.from("patient_documents") as any)
      .select("storage_path, original_filename")
      .eq("id", documentId)
      .eq("tenant_id", session.tenantId)
      .single();

    if (error || !doc) {
      return { success: false, error: "Document not found or access denied." };
    }

    const storageProvider = clientOverride
      ? new SupabaseStorageProvider({ defaultBucket: "clinic-records", client: clientOverride })
      : undefined;

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
export async function generateDocumentShareToken(
  documentId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  clientOverride?: SupabaseClient<Database, any, any>,
  sessionOverride?: { userId: string; tenantId: string }
): Promise<ShareTokenResult> {
  const supabase = clientOverride || (await createClient());

  try {
    const session = sessionOverride || (await requirePermission("patients:view"));

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

    // 2. Generate 64-character random hex token (256-bit entropy)
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    // 3. Insert into document_share_tokens
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: tokenRow, error: insertErr } = await (supabase.from("document_share_tokens") as any)
      .insert({
        tenant_id: session.tenantId,
        document_id: documentId,
        token,
        expires_at: expiresAt,
        created_by: session.userId,
      })
      .select("token, expires_at")
      .single();

    if (insertErr || !tokenRow) {
      console.error("[features/labs/actions] Failed to create share token:", insertErr);
      return { success: false, error: "Failed to generate patient share link." };
    }

    // 4. Audit logging
    await recordAudit(
      {
        action: "patient_document.generate_share_token",
        entityType: "patient_document",
        entityId: documentId,
        metadata: {
          expires_at: expiresAt,
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      clientOverride as any,
      session
    );

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
export async function deleteLabDocument(
  documentId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  clientOverride?: SupabaseClient<Database, any, any>,
  sessionOverride?: { userId: string; tenantId: string }
): Promise<DeleteLabDocumentResult> {
  const supabase = clientOverride || (await createClient());

  try {
    const session = sessionOverride || (await requirePermission("patients:edit"));

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

    // 2. Delete storage object
    const storageProvider = clientOverride
      ? new SupabaseStorageProvider({ defaultBucket: "clinic-records", client: clientOverride })
      : undefined;

    try {
      await deleteFile(
        {
          path: doc.storage_path,
          bucket: "clinic-records",
        },
        storageProvider
      );
    } catch (storageErr) {
      console.warn("[features/labs/actions] Storage file deletion warning:", storageErr);
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
    await recordAudit(
      {
        action: "patient_document.delete",
        entityType: "patient_document",
        entityId: documentId,
        metadata: {
          patient_id: doc.patient_id,
          title: doc.title,
          storage_path: doc.storage_path,
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      clientOverride as any,
      session
    );

    try {
      revalidatePath(`/patients/${doc.patient_id}`);
    } catch {
      // Non-web contexts
    }

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
  documentId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  clientOverride?: any,
  sessionOverride?: { userId: string; tenantId: string }
): Promise<{ success: boolean; shareUrl?: string; token?: string; error?: string }> {
  const supabase = clientOverride || (await createClient());

  try {
    const session = sessionOverride || (await requirePermission("patients:view"));

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

    // 2. Generate secure 64-character token in document_share_tokens
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: tokenErr } = await (supabase.from("document_share_tokens") as any).insert({
      tenant_id: session.tenantId,
      document_id: documentId,
      resource_type: "patient_document",
      resource_id: documentId,
      token,
      expires_at: expiresAt,
      created_by: session.userId,
    });

    if (tokenErr) {
      console.error("[shareLabReportViaWhatsApp] Token creation error:", tokenErr);
      return { success: false, error: "Failed to generate secure share link." };
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const shareUrl = `${baseUrl}/r/${token}`;

    // 3. Enqueue Event #7 (lab_report_uploaded)
    await enqueueMessage(
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
        metadata: {
          document_id: documentId,
          share_token: token,
          share_url: shareUrl,
        },
      },
      supabase
    );

    // 4. Record audit log
    await recordAudit(
      {
        action: "patient_document.share_whatsapp",
        entityType: "patient_document",
        entityId: documentId,
        metadata: { share_token: token, recipient_phone: doc.patient.phone },
      },
      clientOverride,
      session
    );

    return { success: true, shareUrl, token };
  } catch (err: unknown) {
    console.error("[features/labs/actions] shareLabReportViaWhatsApp error:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to share lab report.",
    };
  }
}
