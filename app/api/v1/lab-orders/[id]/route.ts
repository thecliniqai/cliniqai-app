import { NextRequest } from "next/server";
import { authenticateApiKey } from "@/lib/api/auth";
import { apiSuccess, apiError } from "@/lib/api/envelope";
import { checkRateLimit, getRateLimitHeaders } from "@/lib/api/rate-limiter";
import { getSystemDb } from "@/lib/supabase/system";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/v1/lab-orders/[id]
 * Retrieve detailed lab report document record scoped strictly to active tenant.
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
    return apiError("VALIDATION_ERROR", "Lab order ID is required.", 400, undefined, rateHeaders);
  }

  try {
    const { data: doc, error } = await (admin.from("patient_documents") as any)
      .select("*")
      .eq("id", id)
      .eq("tenant_id", session.tenantId)
      .eq("document_type", "lab_report")
      .maybeSingle();

    if (error) {
      return apiError("DATABASE_ERROR", error.message, 500, undefined, rateHeaders);
    }

    if (!doc) {
      return apiError("NOT_FOUND", "Lab order document not found in active clinic.", 404, undefined, rateHeaders);
    }

    return apiSuccess(doc, undefined, 200, rateHeaders);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return apiError("DATABASE_ERROR", message, 500, undefined, rateHeaders);
  }
}
