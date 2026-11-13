import { NextRequest } from "next/server";
import { authenticateApiKey, apiKeyServiceContext } from "@/lib/api/auth";
import { apiSuccess, apiError } from "@/lib/api/envelope";
import { checkRateLimit, getRateLimitHeaders } from "@/lib/api/rate-limiter";
import { getSystemDb } from "@/lib/supabase/system";
import { buildPatientSearchFilter } from "@/features/patients/service";
import { patientSchema } from "@/features/patients/schema";
import { recordAudit } from "@/lib/audit/audit";

/**
 * GET /api/v1/patients
 * List patients for the authenticated tenant with pagination and search.
 * Filters out soft-deleted / erased patients (is_deleted = false).
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
  const search = searchParams.get("search") || "";

  try {
    let query = (admin.from("patients") as any)
      .select("*", { count: "exact" })
      .eq("tenant_id", session.tenantId)
      .eq("is_deleted", false);

    if (search.trim()) {
      const searchFilter = buildPatientSearchFilter(search);
      if (searchFilter) {
        query = query.or(searchFilter);
      }
    }

    const { data: patients, count, error } = await query
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      return apiError("DATABASE_ERROR", error.message, 500, undefined, rateHeaders);
    }

    const total = count || 0;
    const totalPages = Math.ceil(total / limit);

    return apiSuccess(
      patients || [],
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
 * POST /api/v1/patients
 * Create a new patient under the authenticated clinic tenant.
 * Uses creator's auth.users UUID for created_by FK compliance.
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

  const parseResult = patientSchema.safeParse(body);
  if (!parseResult.success) {
    return apiError(
      "VALIDATION_ERROR",
      parseResult.error.issues[0]?.message || "Validation failed.",
      422,
      parseResult.error.flatten(),
      rateHeaders
    );
  }

  const input = parseResult.data;

  try {
    const { data: patient, error } = await (admin.from("patients") as any)
      .insert({
        tenant_id: session.tenantId,
        full_name: input.full_name,
        phone: input.phone,
        date_of_birth: input.date_of_birth || null,
        age: input.age ?? null,
        sex: input.sex ?? null,
        address: input.address ? (input.address as Record<string, unknown>) : null,
        allergies: input.allergies || [],
        chronic_conditions: input.chronic_conditions || [],
        emergency_contact: input.emergency_contact
          ? (input.emergency_contact as Record<string, unknown>)
          : null,
        abha_id: input.abha_id || null,
        created_by: session.userId,
        is_deleted: false,
        status: "active",
      })
      .select()
      .single();

    if (error || !patient) {
      return apiError("DATABASE_ERROR", error?.message || "Failed to create patient", 500, undefined, rateHeaders);
    }

    // Record audit log entry
    await recordAudit(apiKeyServiceContext(session, admin), {
        action: "patient.create",
        entityType: "patient",
        entityId: patient.id,
        metadata: {
          fields_changed: Object.keys(input),
          actor_type: "api_key",
          api_key_id: session.apiKeyId,
        },
    });

    return apiSuccess(patient, undefined, 201, rateHeaders);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return apiError("DATABASE_ERROR", message, 500, undefined, rateHeaders);
  }
}
