import { NextRequest } from "next/server";
import { z } from "zod";
import { authenticateApiKey, apiKeyServiceContext } from "@/lib/api/auth";
import { apiSuccess, apiError, apiDbError } from "@/lib/api/envelope";
import { checkRateLimit, getRateLimitHeaders } from "@/lib/api/rate-limiter";
import { getSystemDb } from "@/lib/supabase/system";
import { recordAudit } from "@/lib/audit/audit";
import { enqueueWebhookEventAsSystem } from "@/lib/jobs/enqueue";
import { isDateOnly } from "@/lib/utils/filter-values";
import { getTenantToday } from "@/lib/datetime/server";
import { isPatientStoragePath } from "@/lib/storage/tenant-path";
import { errorTag, log } from "@/lib/log";
import { getRequestId } from "@/lib/log/request-id";

const LAB_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"] as const;

/** P0-05: body of `POST /api/v1/lab-orders`. Unknown keys are ignored; tenant and uploader come from the key. */
const labOrderCreateSchema = z.object({
  patient_id: z.string().uuid(),
  visit_id: z.string().uuid().nullish(),
  title: z.string().trim().min(1).max(200),
  original_filename: z.string().trim().max(255).nullish(),
  storage_path: z.string().trim().min(1).max(512),
  file_size_bytes: z.number().int().min(0).nullish(),
  mime_type: z.enum(LAB_MIME_TYPES).nullish(),
  report_date: z.string().refine(isDateOnly, "Expected YYYY-MM-DD").nullish(),
  notes: z.string().max(2000).nullish(),
  is_abnormal: z.boolean().nullish(),
});

/**
 * GET /api/v1/lab-orders
 * List lab report documents mapped directly to public.patient_documents where document_type = 'lab_report'.
 * Filters: patient_id, visit_id. Standard page/limit pagination.
 */
export async function GET(req: NextRequest) {
  const auth = await authenticateApiKey(req, () => getSystemDb("api_v1"));
  if (!auth.success) {
    return auth.response;
  }
  const admin = auth.db;

  const { session } = auth;
  const rateLimit = checkRateLimit(session.apiKeyId);
  const rateHeaders = getRateLimitHeaders(rateLimit);

  if (!rateLimit.allowed) {
    return apiError(
      "RATE_LIMIT_EXCEEDED",
      "Rate limit of 120 requests per minute exceeded.",
      429,
      undefined,
      rateHeaders
    );
  }

  const searchParams = req.nextUrl.searchParams;
  const pageRaw = parseInt(searchParams.get("page") || "1", 10);
  const limitRaw = parseInt(searchParams.get("limit") || "20", 10);

  const page = Number.isInteger(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 100) : 20;
  const offset = (page - 1) * limit;

  const patientId = searchParams.get("patient_id");
  const visitId = searchParams.get("visit_id");

  try {
    let query = (admin.from("patient_documents") as any)
      .select(
        "id, tenant_id, patient_id, visit_id, title, document_type, original_filename, storage_path, file_size_bytes, mime_type, report_date, notes, is_abnormal, uploaded_by, created_at, updated_at",
        { count: "exact" }
      )
      .eq("tenant_id", session.tenantId)
      .eq("document_type", "lab_report");

    if (patientId) {
      query = query.eq("patient_id", patientId);
    }
    if (visitId) {
      query = query.eq("visit_id", visitId);
    }

    const { data: documents, count, error } = await query
      .order("report_date", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      return apiDbError(error, rateHeaders);
    }

    const total = count || 0;
    const totalPages = Math.ceil(total / limit);

    return apiSuccess(
      documents || [],
      {
        page,
        limit,
        total,
        total_pages: totalPages,
      },
      200,
      rateHeaders
    );
  } catch (err: unknown) {
    return apiDbError(err, rateHeaders);
  }
}

/**
 * POST /api/v1/lab-orders
 * Create a new lab order document record grounded in public.patient_documents.
 * Requires title, storage_path, patient_id; sets uploaded_by = session.userId.
 */
export async function POST(req: NextRequest) {
  const auth = await authenticateApiKey(req, () => getSystemDb("api_v1"));
  if (!auth.success) {
    return auth.response;
  }
  const admin = auth.db;

  const { session } = auth;
  const rateLimit = checkRateLimit(session.apiKeyId);
  const rateHeaders = getRateLimitHeaders(rateLimit);

  if (!rateLimit.allowed) {
    return apiError(
      "RATE_LIMIT_EXCEEDED",
      "Rate limit of 120 requests per minute exceeded.",
      429,
      undefined,
      rateHeaders
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON.", 400, undefined, rateHeaders);
  }

  const parsed = labOrderCreateSchema.safeParse(body ?? {});
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const field = first?.path.join(".") || "body";
    return apiError("VALIDATION_ERROR", `Field '${field}' is invalid.`, 422, undefined, rateHeaders);
  }

  const {
    patient_id,
    visit_id,
    title,
    original_filename,
    storage_path,
    file_size_bytes,
    mime_type,
    report_date,
    notes,
    is_abnormal,
  } = parsed.data;

  // P0-05 (ARC-06): the object key must sit under this key's tenant and this patient, with no traversal. The tenant
  // comes only from the verified API key, never from the body.
  if (!isPatientStoragePath(session.tenantId, patient_id, storage_path)) {
    return apiError(
      "VALIDATION_ERROR",
      "Field 'storage_path' must be under tenants/<tenant_id>/patients/<patient_id>/.",
      422,
      undefined,
      rateHeaders
    );
  }

  try {
    // 1. Verify patient exists and belongs to active tenant
    const { data: patient, error: patientErr } = await (admin.from("patients") as any)
      .select("id")
      .eq("id", patient_id)
      .eq("tenant_id", session.tenantId)
      .eq("is_deleted", false)
      .maybeSingle();

    if (patientErr) {

      return apiDbError(patientErr, rateHeaders);

    }

    if (!patient) {
      return apiError("NOT_FOUND", "Patient not found in active clinic.", 404, undefined, rateHeaders);
    }

    // 2. Verify visit if provided
    if (visit_id) {
      const { data: visit, error: visitErr } = await (admin.from("visits") as any)
        .select("id")
        .eq("id", visit_id)
        .eq("tenant_id", session.tenantId)
        .maybeSingle();

      if (visitErr) {

        return apiDbError(visitErr, rateHeaders);

      }

      if (!visit) {
        return apiError("NOT_FOUND", "Referenced visit not found in active clinic.", 404, undefined, rateHeaders);
      }
    }

    // 3. Insert into public.patient_documents
    const { data: doc, error: insertErr } = await (admin.from("patient_documents") as any)
      .insert({
        tenant_id: session.tenantId,
        patient_id,
        visit_id: visit_id || null,
        document_type: "lab_report",
        title,
        original_filename: original_filename || title,
        storage_path,
        file_size_bytes: file_size_bytes ?? 0,
        mime_type: mime_type ?? "application/pdf",
        // The clinic date in the tenant's zone when the caller sends none (V2-03 03-05; R-33).
        report_date: report_date ?? (await getTenantToday(admin, session.tenantId)).today,
        notes: notes || null,
        is_abnormal: Boolean(is_abnormal),
        uploaded_by: session.userId,
      })
      .select()
      .single();

    if (insertErr || !doc) {
      return apiDbError(insertErr, rateHeaders);
    }

    // 4. Record audit log (D-08)
    try {
      await recordAudit(apiKeyServiceContext(session, admin), {
          action: "lab_order.create",
          entityType: "lab_order",
          entityId: doc.id,
          // The object key embeds the patient id and the uploaded file name; it is not copied into audit metadata.
          metadata: {
            document_type: "lab_report",
          },
      });
    } catch (auditErr) {
      log.error({ event: "api.lab_orders_audit.failed", code: errorTag(auditErr), requestId: await getRequestId() });
    }

    // 5. Webhook event lab_result.ready (04-03b): queued through the system RPC; tenant and data from the document row.
    try {
      await enqueueWebhookEventAsSystem(admin, "lab_result.ready", doc.id, "system:api_v1");
    } catch (webhookErr) {
      log.warn({ event: "api.lab_orders_webhook.failed", code: errorTag(webhookErr), requestId: await getRequestId() });
    }

    return apiSuccess(doc, undefined, 201, rateHeaders);
  } catch (err: unknown) {
    return apiDbError(err, rateHeaders);
  }
}
