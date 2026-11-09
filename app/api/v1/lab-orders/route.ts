import { NextRequest } from "next/server";
import { authenticateApiKey } from "@/lib/api/auth";
import { apiSuccess, apiError } from "@/lib/api/envelope";
import { checkRateLimit, getRateLimitHeaders } from "@/lib/api/rate-limiter";
import { getAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/audit/audit";
import { enqueueWebhookEvent } from "@/lib/webhooks/outbox";

/**
 * GET /api/v1/lab-orders
 * List lab report documents mapped directly to public.patient_documents where document_type = 'lab_report'.
 * Filters: patient_id, visit_id. Standard page/limit pagination.
 */
export async function GET(req: NextRequest) {
  const auth = await authenticateApiKey(req);
  if (!auth.success) {
    return auth.response;
  }

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

  const admin = getAdminClient();

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
      return apiError("DATABASE_ERROR", error.message, 500, undefined, rateHeaders);
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
    const message = err instanceof Error ? err.message : "Unknown error";
    return apiError("DATABASE_ERROR", message, 500, undefined, rateHeaders);
  }
}

/**
 * POST /api/v1/lab-orders
 * Create a new lab order document record grounded in public.patient_documents.
 * Requires title, storage_path, patient_id; sets uploaded_by = session.userId.
 */
export async function POST(req: NextRequest) {
  const auth = await authenticateApiKey(req);
  if (!auth.success) {
    return auth.response;
  }

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

  let body: any;
  try {
    body = await req.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON.", 400, undefined, rateHeaders);
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
  } = body || {};

  if (!patient_id || typeof patient_id !== "string") {
    return apiError("VALIDATION_ERROR", "Field 'patient_id' is required.", 422, undefined, rateHeaders);
  }
  if (!title || typeof title !== "string" || !title.trim()) {
    return apiError("VALIDATION_ERROR", "Field 'title' is required.", 422, undefined, rateHeaders);
  }
  if (!storage_path || typeof storage_path !== "string" || !storage_path.trim()) {
    return apiError("VALIDATION_ERROR", "Field 'storage_path' is required.", 422, undefined, rateHeaders);
  }

  const admin = getAdminClient();

  try {
    // 1. Verify patient exists and belongs to active tenant
    const { data: patient, error: patientErr } = await (admin.from("patients") as any)
      .select("id")
      .eq("id", patient_id)
      .eq("tenant_id", session.tenantId)
      .eq("is_deleted", false)
      .maybeSingle();

    if (patientErr || !patient) {
      return apiError("NOT_FOUND", "Patient not found in active clinic.", 404, undefined, rateHeaders);
    }

    // 2. Verify visit if provided
    if (visit_id) {
      const { data: visit, error: visitErr } = await (admin.from("visits") as any)
        .select("id")
        .eq("id", visit_id)
        .eq("tenant_id", session.tenantId)
        .maybeSingle();

      if (visitErr || !visit) {
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
        title: title.trim(),
        original_filename: original_filename?.trim() || title.trim(),
        storage_path: storage_path.trim(),
        file_size_bytes: typeof file_size_bytes === "number" && file_size_bytes >= 0 ? file_size_bytes : 0,
        mime_type: mime_type?.trim() || "application/pdf",
        report_date: report_date || new Date().toISOString().slice(0, 10),
        notes: notes || null,
        is_abnormal: Boolean(is_abnormal),
        uploaded_by: session.userId,
      })
      .select()
      .single();

    if (insertErr || !doc) {
      return apiError("DATABASE_ERROR", insertErr?.message || "Failed to create lab document.", 500, undefined, rateHeaders);
    }

    // 4. Record audit log (D-08)
    try {
      await recordAudit(
        {
          action: "lab_order.create",
          entityType: "lab_order",
          entityId: doc.id,
          actorType: "api_key",
          apiKeyId: session.apiKeyId,
          metadata: {
            storage_path: doc.storage_path,
          },
        },
        admin,
        {
          userId: session.userId,
          tenantId: session.tenantId,
          role: "owner",
        }
      );
    } catch (auditErr) {
      console.error("[api/v1/lab-orders] Audit logging failed:", auditErr);
    }

    // 5. Enqueue webhook event: lab_result.ready
    try {
      await enqueueWebhookEvent(
        session.tenantId,
        "lab_result.ready",
        {
          document_id: doc.id,
          patient_id: doc.patient_id,
          title: doc.title,
        },
        admin
      );
    } catch (webhookErr) {
      console.warn("[api/v1/lab-orders] Webhook enqueue error:", webhookErr);
    }

    return apiSuccess(doc, undefined, 201, rateHeaders);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return apiError("DATABASE_ERROR", message, 500, undefined, rateHeaders);
  }
}
