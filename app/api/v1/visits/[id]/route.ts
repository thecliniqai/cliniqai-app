import { NextRequest } from "next/server";
import { z } from "zod";
import { authenticateApiKey, apiKeyServiceContext } from "@/lib/api/auth";
import { apiSuccess, apiError } from "@/lib/api/envelope";
import { checkRateLimit, getRateLimitHeaders } from "@/lib/api/rate-limiter";
import { getSystemDb } from "@/lib/supabase/system";
import { recordAudit } from "@/lib/audit/audit";
import { errorTag, log } from "@/lib/log";
import { getRequestId } from "@/lib/log/request-id";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const VISIT_STATUSES = [
  "booked",
  "confirmed",
  "waiting",
  "in_consultation",
  "completed",
  "cancelled",
  "no_show",
] as const;

/** Body of `PATCH /api/v1/visits/[id]`; `status` must be a real visit status (unknown keys are ignored). */
const visitPatchSchema = z.object({
  status: z.enum(VISIT_STATUSES).optional(),
  clinical_notes: z.string().nullable().optional(),
  chief_complaints: z.union([z.string(), z.array(z.unknown())]).nullable().optional(),
  vitals: z.record(z.unknown()).nullable().optional(),
  advice: z.unknown().optional(),
  investigations_advised: z.unknown().optional(),
});

function isVisitLocked(visit: { status?: string | null; signed_at?: string | null }): boolean {
  return visit.status === "completed" || Boolean(visit.signed_at);
}

function visitLocked(rateHeaders: Record<string, string>) {
  return apiError("VISIT_LOCKED", "Signed visits cannot be modified.", 409, undefined, rateHeaders);
}

/**
 * GET /api/v1/visits/[id]
 * Retrieve detailed clinical visit record scoped strictly to active tenant.
 */
export async function GET(req: NextRequest, { params }: RouteParams) {
  const admin = getSystemDb("api_v1");
  const auth = await authenticateApiKey(admin, req);
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
  const admin = getSystemDb("api_v1");
  const auth = await authenticateApiKey(admin, req);
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON.", 400, undefined, rateHeaders);
  }

  const parsed = visitPatchSchema.safeParse(body ?? {});
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path.join(".") || "body";
    return apiError("VALIDATION_ERROR", `Field '${field}' is invalid.`, 422, undefined, rateHeaders);
  }

  const { status, clinical_notes, chief_complaints, vitals, advice, investigations_advised } = parsed.data;

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

    // DB-13/API-04 interim guard (V2-01 R10): a completed or signed visit is read-only through the API, for any body.
    // Amendments go through the in-app reopen/finalize flow. The same lock is repeated in the UPDATE filter below.
    if (isVisitLocked(existingVisit)) {
      return visitLocked(rateHeaders);
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

    // The lock is part of the filter, so a visit signed between the read above and this write matches 0 rows.
    const { data: updatedRows, error: updateErr } = await (admin.from("visits") as any)
      .update(updateData)
      .eq("id", id)
      .eq("tenant_id", session.tenantId)
      .neq("status", "completed")
      .is("signed_at", null)
      .select();

    if (updateErr) {
      // AR2-Info (I2): a fixed message; the database text is neither returned nor logged (only its code).
      log.error({ event: "api.visit_update.failed", code: errorTag(updateErr), requestId: await getRequestId() });
      return apiError("DATABASE_ERROR", "Failed to update visit.", 500, undefined, rateHeaders);
    }

    const updatedVisit = Array.isArray(updatedRows) ? updatedRows[0] : null;
    if (!updatedVisit) {
      return visitLocked(rateHeaders);
    }

    // 4. Audit log update (D-08)
    try {
      await recordAudit(apiKeyServiceContext(session, admin), {
          action: "visit.status_update",
          entityType: "visit",
          entityId: id,
          metadata: {
            old_status: existingVisit.status,
            new_status: status || existingVisit.status,
          },
      });
    } catch (auditErr) {
      log.error({ event: "api.visit_update_audit.failed", code: errorTag(auditErr), requestId: await getRequestId() });
    }

    return apiSuccess(updatedVisit, undefined, 200, rateHeaders);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return apiError("DATABASE_ERROR", message, 500, undefined, rateHeaders);
  }
}
