import { NextRequest } from "next/server";
import { authenticateApiKey } from "@/lib/api/auth";
import { apiSuccess, apiError, apiDbError } from "@/lib/api/envelope";
import { checkRateLimit, getRateLimitHeaders } from "@/lib/api/rate-limiter";
import { getSystemDb } from "@/lib/supabase/system";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/v1/prescriptions/[id]
 * Retrieve detailed prescription record with nested medication items.
 * Strictly scoped to session.tenantId.
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
    return apiError("VALIDATION_ERROR", "Prescription ID is required.", 400, undefined, rateHeaders);
  }

  try {
    const { data: prescription, error } = await (admin.from("prescriptions") as any)
      .select("*, prescription_items(*)")
      .eq("id", id)
      .eq("tenant_id", session.tenantId)
      .maybeSingle();

    if (error) {
      return apiDbError(error, rateHeaders);
    }

    if (!prescription) {
      return apiError("NOT_FOUND", "Prescription not found in active clinic.", 404, undefined, rateHeaders);
    }

    return apiSuccess(prescription, undefined, 200, rateHeaders);
  } catch (err: unknown) {
    return apiDbError(err, rateHeaders);
  }
}
