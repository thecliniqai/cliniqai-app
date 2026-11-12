import { NextRequest } from "next/server";
import { authenticateApiKey } from "@/lib/api/auth";
import { apiSuccess, apiError } from "@/lib/api/envelope";
import { checkRateLimit, getRateLimitHeaders } from "@/lib/api/rate-limiter";
import { getAdminClient } from "@/lib/supabase/admin";
import { recordAuditLegacy } from "@/lib/audit/audit";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/v1/referrals/[id]
 * Retrieve detailed referral record scoped strictly to active clinic tenant.
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
    return apiError("VALIDATION_ERROR", "Referral ID is required.", 400, undefined, rateHeaders);
  }

  const admin = getAdminClient();

  try {
    const { data: referral, error } = await (admin.from("referrals") as any)
      .select("*")
      .eq("id", id)
      .eq("tenant_id", session.tenantId)
      .maybeSingle();

    if (error) {
      return apiError("DATABASE_ERROR", error.message, 500, undefined, rateHeaders);
    }

    if (!referral) {
      return apiError("NOT_FOUND", "Referral not found in active clinic.", 404, undefined, rateHeaders);
    }

    return apiSuccess(referral, undefined, 200, rateHeaders);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return apiError("DATABASE_ERROR", message, 500, undefined, rateHeaders);
  }
}

/**
 * PATCH /api/v1/referrals/[id]
 * Update referral status (acknowledged, completed, cancelled) and closure notes.
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

  const admin = getAdminClient();

  try {
    const { data: existingReferral, error: fetchErr } = await (admin.from("referrals") as any)
      .select("*")
      .eq("id", id)
      .eq("tenant_id", session.tenantId)
      .maybeSingle();

    if (fetchErr) {
      return apiError("DATABASE_ERROR", fetchErr.message, 500, undefined, rateHeaders);
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
      return apiError("DATABASE_ERROR", updateErr?.message || "Failed to update referral.", 500, undefined, rateHeaders);
    }

    // Audit log
    try {
      const auditAction =
        status === "acknowledged" ? "referral.acknowledge" : "referral.close_loop";
      await recordAuditLegacy(
        {
          action: auditAction,
          entityType: "referral",
          entityId: id,
          actorType: "api_key",
          apiKeyId: session.apiKeyId,
          metadata: {
            status: status || existingReferral.status,
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
      console.error("[api/v1/referrals/[id]] Audit logging failed:", auditErr);
    }

    return apiSuccess(updatedReferral, undefined, 200, rateHeaders);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return apiError("DATABASE_ERROR", message, 500, undefined, rateHeaders);
  }
}
