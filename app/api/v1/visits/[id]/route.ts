import { NextRequest } from "next/server";
import { authenticateApiKey } from "@/lib/api/auth";
import { apiSuccess, apiError } from "@/lib/api/envelope";
import { checkRateLimit, getRateLimitHeaders } from "@/lib/api/rate-limiter";
import { getAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/audit/audit";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/v1/visits/[id]
 * Retrieve detailed clinical visit record scoped strictly to active tenant.
 */
export async function GET(req: NextRequest, { params }: RouteParams) {
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

  const { id } = await params;
  if (!id) {
    return apiError("VALIDATION_ERROR", "Visit ID is required.", 400, undefined, rateHeaders);
  }

  const admin = getAdminClient();

  try {
    const { data: visit, error } = await (admin.from("visits") as any)
      .select("*")
      .eq("id", id)
      .eq("tenant_id", session.tenantId)
      .maybeSingle();

    if (error) {
      return apiError("DATABASE_ERROR", error.message, 500, undefined, rateHeaders);
    }

    if (!visit) {
      return apiError("NOT_FOUND", "Visit not found in active clinic.", 404, undefined, rateHeaders);
    }

    return apiSuccess(visit, undefined, 200, rateHeaders);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return apiError("DATABASE_ERROR", message, 500, undefined, rateHeaders);
  }
}

/**
 * PATCH /api/v1/visits/[id]
 * Update visit status, notes, chief complaints, or vitals.
 * Enforces clinical safety check (AGENTS.md §18, T-06-07): If transition to 'completed'
 * is requested, at least one diagnosis or clinical note must exist.
 */
export async function PATCH(req: NextRequest, { params }: RouteParams) {
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

  const { id } = await params;
  if (!id) {
    return apiError("VALIDATION_ERROR", "Visit ID is required.", 400, undefined, rateHeaders);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON.", 400, undefined, rateHeaders);
  }

  const { status, clinical_notes, chief_complaints, vitals, advice, investigations_advised } = body || {};

  const admin = getAdminClient();

  try {
    // 1. Fetch existing encounter
    const { data: existingVisit, error: fetchErr } = await (admin.from("visits") as any)
      .select("*")
      .eq("id", id)
      .eq("tenant_id", session.tenantId)
      .maybeSingle();

    if (fetchErr) {
      return apiError("DATABASE_ERROR", fetchErr.message, 500, undefined, rateHeaders);
    }

    if (!existingVisit) {
      return apiError("NOT_FOUND", "Visit not found in active clinic.", 404, undefined, rateHeaders);
    }

    // 2. Clinical safety check if transitioning status to 'completed'
    if (status === "completed") {
      const hasNotes = Boolean(
        (typeof clinical_notes === "string" && clinical_notes.trim().length > 0) ||
        (existingVisit.clinical_notes && existingVisit.clinical_notes.trim().length > 0)
      );

      const { data: diagnoses } = await (admin.from("consultation_diagnoses") as any)
        .select("id")
        .eq("visit_id", id)
        .eq("tenant_id", session.tenantId)
        .limit(1);

      const hasDiagnosis = diagnoses && diagnoses.length > 0;

      if (!hasNotes && !hasDiagnosis) {
        return apiError(
          "CLINICAL_SAFETY_VIOLATION",
          "Cannot complete encounter without recording at least one diagnosis or clinical note.",
          422,
          undefined,
          rateHeaders
        );
      }
    }

    // 3. Construct update object
    const updateData: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    if (status) {
      updateData.status = status;
      if (status === "completed") {
        updateData.signed_at = new Date().toISOString();
        updateData.signed_by = session.userId;
      }
    }

    if (clinical_notes !== undefined) {
      updateData.clinical_notes = clinical_notes;
    }

    if (chief_complaints !== undefined) {
      updateData.chief_complaints = Array.isArray(chief_complaints)
        ? chief_complaints
        : typeof chief_complaints === "string" && chief_complaints.trim()
        ? [{ complaint: chief_complaints.trim() }]
        : [];
    }

    if (vitals !== undefined) {
      updateData.vitals = vitals;
    }

    if (advice !== undefined) {
      updateData.advice = advice;
    }

    if (investigations_advised !== undefined) {
      updateData.investigations_advised = investigations_advised;
    }

    const { data: updatedVisit, error: updateErr } = await (admin.from("visits") as any)
      .update(updateData)
      .eq("id", id)
      .eq("tenant_id", session.tenantId)
      .select()
      .single();

    if (updateErr || !updatedVisit) {
      return apiError("DATABASE_ERROR", updateErr?.message || "Failed to update visit.", 500, undefined, rateHeaders);
    }

    // 4. Audit log update (D-08)
    try {
      await recordAudit(
        {
          action: "visit.status_update",
          entityType: "visit",
          entityId: id,
          actorType: "api_key",
          apiKeyId: session.apiKeyId,
          metadata: {
            old_status: existingVisit.status,
            new_status: status || existingVisit.status,
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
      console.error("[api/v1/visits/[id]] Audit logging failed:", auditErr);
    }

    return apiSuccess(updatedVisit, undefined, 200, rateHeaders);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return apiError("DATABASE_ERROR", message, 500, undefined, rateHeaders);
  }
}
