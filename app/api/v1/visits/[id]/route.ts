import { NextRequest } from "next/server";
import { z } from "zod";
import { authenticateApiKey, apiKeyServiceContext } from "@/lib/api/auth";
import { apiSuccess, apiError } from "@/lib/api/envelope";
import { checkRateLimit, getRateLimitHeaders } from "@/lib/api/rate-limiter";
import { getSystemDb } from "@/lib/supabase/system";
import { recordAudit } from "@/lib/audit/audit";
import { errorTag, log } from "@/lib/log";
import { getRequestId } from "@/lib/log/request-id";
import { CLINICAL_ACCESS_DENIED, hasClinicalField, V1_VISIT_COLUMNS } from "@/lib/api/visit-dto";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * Statuses an API key may set. "completed" is not one: completing signs the visit, a clinical act, and the key principal
 * has no clinical access (V2-05 05-11c, R-9; IND M4: it signed as the key's creator).
 */
const VISIT_STATUSES = ["booked", "confirmed", "waiting", "in_consultation", "cancelled", "no_show"] as const;

/** Body of `PATCH /api/v1/visits/[id]`; `status` must be a settable visit status (unknown keys are ignored). */
const visitPatchSchema = z.object({
  status: z.enum(VISIT_STATUSES).optional(),
});

function isVisitLocked(visit: { status?: string | null; signed_at?: string | null }): boolean {
  return visit.status === "completed" || Boolean(visit.signed_at);
}

function visitLocked(rateHeaders: Record<string, string>) {
  return apiError("VISIT_LOCKED", "Signed visits cannot be modified.", 409, undefined, rateHeaders);
}

/**
 * GET /api/v1/visits/[id]
 * Retrieve a visit scoped strictly to the active tenant, without clinical content (V2-05 05-11c, R-9:
 * `V1_VISIT_COLUMNS` only).
 */
export async function GET(req: NextRequest, { params }: RouteParams) {
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

  const { id } = await params;
  if (!id) {
    return apiError("VALIDATION_ERROR", "Visit ID is required.", 400, undefined, rateHeaders);
  }

  try {
    const { data: visit, error } = await (admin.from("visits") as any)
      .select(V1_VISIT_COLUMNS)
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
 * Update a visit's status. Clinical content (notes, complaints, vitals, advice, investigations, specialty data) and
 * completing (signing) the visit are refused with 403 CLINICAL_ACCESS_DENIED: API keys have no clinical access
 * (V2-05 05-11c, R-9). A completed or signed visit is read-only (409 VISIT_LOCKED).
 */
export async function PATCH(req: NextRequest, { params }: RouteParams) {
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

  // API keys have no clinical access (R-9; IND M5, IND M4): clinical content and the sign-off are refused, never
  // silently dropped, before anything is read.
  if (hasClinicalField(body) || (body && typeof body === "object" && (body as { status?: unknown }).status === "completed")) {
    return apiError(CLINICAL_ACCESS_DENIED.code, CLINICAL_ACCESS_DENIED.message, 403, undefined, rateHeaders);
  }

  const parsed = visitPatchSchema.safeParse(body ?? {});
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path.join(".") || "body";
    return apiError("VALIDATION_ERROR", `Field '${field}' is invalid.`, 422, undefined, rateHeaders);
  }

  const { status } = parsed.data;

  try {
    // 1. Fetch existing encounter
    const { data: existingVisit, error: fetchErr } = await (admin.from("visits") as any)
      .select("id, status, signed_at")
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

    // 2. Construct update object
    const updateData: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };
    if (status) {
      updateData.status = status;
    }

    // The lock is part of the filter, so a visit signed between the read above and this write matches 0 rows.
    const { data: updatedRows, error: updateErr } = await (admin.from("visits") as any)
      .update(updateData)
      .eq("id", id)
      .eq("tenant_id", session.tenantId)
      .neq("status", "completed")
      .is("signed_at", null)
      .select(V1_VISIT_COLUMNS);

    if (updateErr) {
      // AR2-Info (I2): a fixed message; the database text is neither returned nor logged (only its code).
      log.error({ event: "api.visit_update.failed", code: errorTag(updateErr), requestId: await getRequestId() });
      return apiError("DATABASE_ERROR", "Failed to update visit.", 500, undefined, rateHeaders);
    }

    const updatedVisit = Array.isArray(updatedRows) ? updatedRows[0] : null;
    if (!updatedVisit) {
      return visitLocked(rateHeaders);
    }

    // 3. Audit log update (D-08)
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
