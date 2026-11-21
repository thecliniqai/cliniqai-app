import "server-only";
import { serverEnv } from "@/lib/env-server";

import { createShareToken } from "@/features/sharing/tokens";
import { assertPerm } from "@/lib/permissions";
import type { ServiceContext } from "@/lib/auth/context";
import { FOREIGN_REFERENCE_MESSAGE, visitInTenant } from "@/lib/auth/tenant-refs";
import { recordAudit } from "@/lib/audit/audit";
import { PatientDocument } from "@/lib/db/types";
import { uploadFile, downloadFile, getSignedUrl, getStorageProviderForDb, VIEW_LINK_TTL_SECONDS } from "@/lib/storage";
import { isPatientStoragePath } from "@/lib/storage/tenant-path";
import { uploadLabDocumentSchema, generateShareTokenSchema } from "./schema";
import { LabDocumentItem, ShareTokenResult } from "./types";
import {
  cleanOriginalFilename,
  formatAmendedFilename,
  LAB_CONTENT_MISMATCH_MESSAGE,
  LAB_VISIT_LOCKED_MESSAGE,
  labFileRefusal,
  labFileSignatureMatches,
  labStorageKey,
} from "./utils";
import { recordState } from "@/features/consultation/record-state";
import { enqueueMessage, enqueueWebhookEvent } from "@/lib/jobs/enqueue";
import { errorTag, log } from "@/lib/log";
import { getRequestId } from "@/lib/log/request-id";
import { getTenantToday } from "@/lib/datetime/server";
import { clientErrorMessage } from "@/lib/errors/client-message";

export type UploadLabDocumentResult =
  | { success: true; document: PatientDocument }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

/** The upload of this request id was already used for another patient, visit or uploader (09B-06a, A-4). */
export const LAB_REQUEST_REUSED_MESSAGE = "This upload was already used for another record. Choose the file again.";

/**
 * Uploads a patient diagnostic lab report or document, enforces auto-amended naming,
 * archives to private storage, and stores document record in PostgreSQL.
 *
 * V2-09b 09B-06a:
 *  - A-4 idempotency: the form's `client_request_id` (one per file, re-sent on Retry) names the stored object and is stored on the row (unique per clinic,
 *    000116). A repeat whose row exists returns that row (no second object, row, audit or webhook); a repeat after an object was stored but no row was
 *    (a failure in between) adopts the object only when its bytes equal this file's. The same id for another patient, visit or uploader is refused.
 *  - S-2 / A-8: a report linked to a visit whose record is signed, completed or cancelled is refused before anything is stored (the database refuses
 *    the row too: `patient_documents_visit_open`).
 *  - S-6: the file's first bytes must match its declared type; the storage extension comes from that type; the stored file name is cleaned.
 */
export async function uploadLabDocument(ctx: ServiceContext, formData: FormData): Promise<UploadLabDocumentResult> {
  const supabase = ctx.db;

  try {
    // labs:edit: the key of the patient_documents and lab-storage rules (V2-05 05-02c; before: patients:edit).
    assertPerm(ctx.role, "labs:edit");
    const session = ctx;

    // 1. Extract and validate file
    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      return { success: false, error: "Please select a valid document file to upload." };
    }

    // The type and the size limit are `labFileRefusal` (features/labs/utils.ts), the same rule and texts the upload control checks before it sends anything.
    const refusal = labFileRefusal(file);
    if (refusal) return { success: false, error: refusal };

    // 2. Validate metadata
    const rawInput = {
      patient_id: formData.get("patient_id"),
      visit_id: formData.get("visit_id") || undefined,
      title: formData.get("title"),
      document_type: formData.get("document_type") || "lab_report",
      // The clinic date in the tenant's zone, passed explicitly (V2-03 03-05; R-33: never the SQL CURRENT_DATE).
      report_date: formData.get("report_date") || (await getTenantToday(supabase, session.tenantId)).today,
      notes: formData.get("notes") || undefined,
      is_abnormal: formData.get("is_abnormal"),
      client_request_id: formData.get("client_request_id") || undefined,
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

    const { patient_id, visit_id, title, document_type, report_date, notes, is_abnormal, client_request_id } = parseResult.data;

    // 3. The patient must be this clinic's
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: patient, error: patientErr } = await (supabase.from("patients") as any)
      .select("id")
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

    // A-4: a repeat of an upload that was stored returns the stored row and stores nothing.
    if (client_request_id) {
      const earlier = await documentForRequest(ctx, client_request_id);
      if (earlier) return repeatOf(earlier, { patient_id, visit_id: visit_id || null, uploaded_by: session.userId });
    }

    // S-2 / A-8: nothing is attached to a visit whose record is signed, completed or cancelled (checked before the object is stored).
    if (visit_id && (await visitLocked(ctx, visit_id))) {
      return { success: false, error: LAB_VISIT_LOCKED_MESSAGE };
    }

    // S-6: the bytes must be what the type says.
    const buffer = Buffer.from(await file.arrayBuffer());
    if (!labFileSignatureMatches(file.type, buffer.subarray(0, 16))) {
      return { success: false, error: LAB_CONTENT_MISMATCH_MESSAGE };
    }

    // 4. Storage key of ids only (R-45, T-05-41): the upload's request id (A-4), else the new row's own id, names the object, so the key, the
    // signed-URL path, the audit row and the logs never carry the patient's name, and two uploads never share a key. The readable name
    // (formatAmendedFilename) is computed only when a download URL is signed.
    const documentId = crypto.randomUUID();
    const storagePath = labStorageKey(session.tenantId, patient_id, client_request_id ?? documentId, file.type);

    // 5. Upload via unified storage abstraction
    const storageProvider = getStorageProviderForDb(ctx.db, "clinic-records");

    try {
      await uploadFile(
        {
          path: storagePath,
          buffer,
          contentType: file.type,
          bucket: "clinic-records",
          // Never replace an earlier report (before 05-02c a same-name, same-date upload overwrote it).
          upsert: false,
        },
        storageProvider
      );
    } catch (uploadErr) {
      // A-4: an earlier attempt of this upload stored the object and failed before its row. The object is kept only when it holds exactly these bytes.
      if (!client_request_id || !(await sameObject(storageProvider, storagePath, buffer))) throw uploadErr;
    }

    // 6. Insert row into patient_documents
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: newDoc, error: insertErr } = await (supabase.from("patient_documents") as any)
      .insert({
        id: documentId,
        tenant_id: session.tenantId,
        patient_id,
        visit_id: visit_id || null,
        title,
        document_type,
        original_filename: cleanOriginalFilename(file.name),
        storage_path: storagePath,
        file_size_bytes: file.size,
        mime_type: file.type,
        report_date,
        notes: notes || null,
        is_abnormal,
        uploaded_by: session.userId,
        client_request_id: client_request_id ?? null,
      })
      .select("*")
      .single();

    // A-4: a parallel repeat of this upload inserted first (unique per clinic and request id): its row is the answer.
    if (insertErr?.code === "23505" && client_request_id) {
      const earlier = await documentForRequest(ctx, client_request_id);
      if (earlier) return repeatOf(earlier, { patient_id, visit_id: visit_id || null, uploaded_by: session.userId });
    }
    // S-2: the visit was closed between the check above and the insert (the database refuses the row).
    if (insertErr?.code === "42501" && String(insertErr.message ?? "").includes("DOCUMENT_VISIT_LOCKED")) {
      return { success: false, error: LAB_VISIT_LOCKED_MESSAGE };
    }
    if (insertErr || !newDoc) {
      log.error({ event: "labs.document_insert.failed", code: errorTag(insertErr), requestId: await getRequestId(), tenantId: ctx.tenantId });
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

    // 8. Webhook event lab_result.ready (04-03b): queued through the RPC, data built in SQL from the document row.
    try {
      await enqueueWebhookEvent(ctx, "lab_result.ready", newDoc.id);
    } catch (webhookErr) {
      log.warn({ event: "labs.upload_webhook.failed", code: errorTag(webhookErr), requestId: await getRequestId(), tenantId: ctx.tenantId });
    }

    return { success: true, document: newDoc };
  } catch (err: unknown) {
    log.error({ event: "labs.upload.failed", code: errorTag(err), requestId: await getRequestId(), tenantId: ctx.tenantId });
    return {
      success: false,
      error: clientErrorMessage(err, "An unexpected error occurred during upload."),
    };
  }
}

/** The clinic's document stored under this upload request id, read under the caller's RLS (09B-06a, A-4). */
async function documentForRequest(ctx: ServiceContext, requestId: string): Promise<PatientDocument | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (ctx.db.from("patient_documents") as any)
    .select("*")
    .eq("tenant_id", ctx.tenantId)
    .eq("client_request_id", requestId)
    .maybeSingle();
  if (error) throw error;
  return (data as PatientDocument | null) ?? null;
}

/** A repeat answers with the stored row only when it is the same upload: same patient, visit and uploader. */
function repeatOf(
  earlier: PatientDocument,
  sent: { patient_id: string; visit_id: string | null; uploaded_by: string },
): UploadLabDocumentResult {
  if (earlier.patient_id !== sent.patient_id || (earlier.visit_id ?? null) !== sent.visit_id || earlier.uploaded_by !== sent.uploaded_by) {
    return { success: false, error: LAB_REQUEST_REUSED_MESSAGE };
  }
  return { success: true, document: earlier };
}

/** The visit's record is signed (not reopened), completed or cancelled (09B-06a, S-2): `recordState` plus the closed statuses. */
async function visitLocked(ctx: ServiceContext, visitId: string): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (ctx.db.from("visits") as any)
    .select("status, signed_at")
    .eq("id", visitId)
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return true;
  const visit = data as { status: string; signed_at: string | null };
  return visit.status === "completed" || visit.status === "cancelled" || recordState(visit) === "sealed";
}

/** The object at `path` holds exactly `bytes` (an earlier attempt of the same upload stored it). */
async function sameObject(provider: ReturnType<typeof getStorageProviderForDb>, path: string, bytes: Buffer): Promise<boolean> {
  try {
    const stored = await downloadFile({ path, bucket: "clinic-records" }, provider);
    return stored.equals(bytes);
  } catch {
    return false;
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
    assertPerm(ctx.role, "labs:view");
    const session = ctx;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from("patient_documents") as any)
      .select("*, visits(scheduled_at, created_at)")
      .eq("patient_id", patientId)
      .eq("tenant_id", session.tenantId)
      .order("report_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) {
      log.error({ event: "labs.documents_list_query.failed", code: errorTag(error), requestId: await getRequestId(), tenantId: ctx.tenantId });
      return { success: false, documents: [], error: "Failed to retrieve patient documents." };
    }

    const documents: LabDocumentItem[] = (data || []).map((doc: any) => ({
      ...doc,
      visit_date: doc.visits?.scheduled_at || doc.visits?.created_at || null,
    }));

    return { success: true, documents };
  } catch (err: unknown) {
    log.error({ event: "labs.documents_list.failed", code: errorTag(err), requestId: await getRequestId(), tenantId: ctx.tenantId });
    return {
      success: false,
      documents: [],
      error: clientErrorMessage(err, "Failed to load documents."),
    };
  }
}

/**
 * Generates a short-lived signed URL (`VIEW_LINK_TTL_SECONDS`, 5 minutes; 06-09b N-1) for authorized staff to
 * view/download a document. The caller opens it at once.
 */
export async function getDocumentSignedUrl(
  ctx: ServiceContext,
  documentId: string
): Promise<{ success: boolean; signedUrl?: string; error?: string }> {
  const supabase = ctx.db;

  try {
    assertPerm(ctx.role, "labs:view");
    const session = ctx;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: doc, error } = await (supabase.from("patient_documents") as any)
      .select("storage_path, original_filename, patient_id, report_date, patient:patients(full_name)")
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
        expiresInSeconds: VIEW_LINK_TTL_SECONDS, // R-29 (05-10a): a view, the 300 s cap
        // The readable name (R-45) is only the download name; the key holds ids only.
        downloadFilename: formatAmendedFilename(doc.patient?.full_name ?? "Patient", doc.original_filename, doc.report_date),
      },
      storageProvider
    );

    return { success: true, signedUrl };
  } catch (err: unknown) {
    log.error({ event: "labs.signed_url.failed", code: errorTag(err), requestId: await getRequestId(), tenantId: ctx.tenantId });
    return {
      success: false,
      error: clientErrorMessage(err, "Failed to generate download URL."),
    };
  }
}

/**
 * Generates a 64-hex cryptographically secure share token with 7-day TTL for zero-login patient viewing.
 */
export async function generateDocumentShareToken(ctx: ServiceContext, documentId: string): Promise<ShareTokenResult> {
  const supabase = ctx.db;

  try {
    assertPerm(ctx.role, "labs:view");
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
    log.error({ event: "labs.share_token.failed", code: errorTag(err), requestId: await getRequestId(), tenantId: ctx.tenantId });
    return {
      success: false,
      error: clientErrorMessage(err, "Failed to create share link."),
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
    assertPerm(ctx.role, "labs:view");
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

    const baseUrl = serverEnv().NEXT_PUBLIC_APP_URL;
    const shareUrl = `${baseUrl}/r/${token}`;

    // 3. Enqueue Event #7 (lab_report_uploaded)
    // V2-04 04-03a: queued through the enqueue RPC (tenant from the patient row, constrained to ctx.tenantId); the job
    // runner sends it. A user-initiated share keeps a per-row key (R-24) until V2-07 command ids.
    await enqueueMessage(
      ctx,
      {
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
    log.error({ event: "labs.whatsapp_share.failed", code: errorTag(err), requestId: await getRequestId(), tenantId: ctx.tenantId });
    return {
      success: false,
      error: clientErrorMessage(err, "Failed to share lab report."),
    };
  }
}
