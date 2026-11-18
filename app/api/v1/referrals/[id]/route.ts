import { NextRequest } from "next/server";
import { authenticateApiKey, apiKeyServiceContext } from "@/lib/api/auth";
import { apiSuccess, apiError, apiDbError } from "@/lib/api/envelope";
import { checkRateLimit, getRateLimitHeaders } from "@/lib/api/rate-limiter";
import { getSystemDb } from "@/lib/supabase/system";
import { recordAudit } from "@/lib/audit/audit";
import { errorTag, log } from "@/lib/log";
import { getRequestId } from "@/lib/log/request-id";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/v1/referrals/[id]
 * Retrieve detailed referral record scoped strictly to active clinic tenant.
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
    return apiError("VALIDATION_ERROR", "Referral ID is required.", 400, undefined, rateHeaders);
  }

  try {
    const { data: referral, error } = await (admin.from("referrals") as any)
      .select("*")
      .eq("id", id)
      .eq("tenant_id", session.tenantId)
      .maybeSingle();

    if (error) {
      return apiDbError(error, rateHeaders);
    }

    if (!referral) {
      return apiError("NOT_FOUND", "Referral not found in active clinic.", 404, undefined, rateHeaders);
    }

    return apiSuccess(referral, undefined, 200, rateHeaders);
  } catch (err: unknown) {
    return apiDbError(err, rateHeaders);
  }
}

/**
 * PATCH /api/v1/referrals/[id]
 * Update referral status (acknowledged, completed, cancelled) and closure notes.
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
    return apiError("VALIDATION_ERROR", "Referral ID is required.", 400, undefined, rateHeaders);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON.", 400, undefined, rateHeaders);
  }

  const { status, closure_notes } = body || {};

  const allowedStatuses = ["sent", "acknowledged", "completed", "cancelled"];
  if (status && !allowedStatuses.includes(status)) {
    return apiError(
      "VALIDATION_ERROR",
      `Invalid status '${status}'. Must be one of: ${allowedStatuses.join(", ")}`,
      422,
      undefined,
      rateHeaders
    );
  }

  try {
    const { data: existingReferral, error: fetchErr } = await (admin.from("referrals") as any)
      .select("*")
      .eq("id", id)
      .eq("tenant_id", session.tenantId)
      .maybeSingle();

    if (fetchErr) {
      return apiDbError(fetchErr, rateHeaders);
    }

    if (!existingReferral) {
      return apiError("NOT_FOUND", "Referral not found in active clinic.", 404, undefined, rateHeaders);
    }

    const nowIso = new Date().toISOString();
    const updateData: Record<string, any> = {
      updated_at: nowIso,
    };

    if (status) {
      updateData.status = status;
      if (status === "acknowledged" && !existingReferral.acknowledged_at) {
        updateData.acknowledged_at = nowIso;
      }
      if (status === "completed") {
        updateData.completed_at = nowIso;
        updateData.closed_by = session.userId;
      }
    }

    if (closure_notes !== undefined) {
      updateData.closure_notes = closure_notes;
    }

    const { data: updatedReferral, error: updateErr } = await (admin.from("referrals") as any)
      .update(updateData)
      .eq("id", id)
      .eq("tenant_id", session.tenantId)
      .select()
      .single();

    if (updateErr || !updatedReferral) {
      return apiDbError(updateErr, rateHeaders);
    }

    // Audit log
    try {
      const auditAction =
        status === "acknowledged" ? "referral.acknowledge" : "referral.close_loop";
      await recordAudit(apiKeyServiceContext(session, admin), {
          action: auditAction,
          entityType: "referral",
          entityId: id,
          metadata: {
            status: status || existingReferral.status,
          },
      });
    } catch (auditErr) {
      log.error({ event: "api.referral_update_audit.failed", code: errorTag(auditErr), requestId: await getRequestId() });
    }

    return apiSuccess(updatedReferral, undefined, 200, rateHeaders);
  } catch (err: unknown) {
    return apiDbError(err, rateHeaders);
  }
}
