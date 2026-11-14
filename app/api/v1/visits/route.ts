import { NextRequest } from "next/server";
import { authenticateApiKey, apiKeyServiceContext } from "@/lib/api/auth";
import { apiSuccess, apiError } from "@/lib/api/envelope";
import { checkRateLimit, getRateLimitHeaders } from "@/lib/api/rate-limiter";
import { getSystemDb } from "@/lib/supabase/system";
import { validateDoctorAssignment } from "@/lib/api/doctor-guard";
import { recordAudit } from "@/lib/audit/audit";
import { isSlotTakenError } from "@/features/visits/service";
import { retryOnDeadlock } from "@/lib/db/retry";
import { apiVisitDuration, VISIT_DURATION_API_MESSAGE } from "@/features/visits/duration";
import { errorTag, log } from "@/lib/log";
import { getRequestId } from "@/lib/log/request-id";
import { CLINICAL_ACCESS_DENIED, hasClinicalField, V1_VISIT_COLUMNS } from "@/lib/api/visit-dto";

/**
 * GET /api/v1/visits
 * List visits (walk-in and scheduled encounters) grounded in public.visits.
 * Filters: patient_id, doctor_id, status, start_date, end_date. Standard page/limit pagination.
 * No clinical content (V2-05 05-11c, R-9): only `V1_VISIT_COLUMNS` (lib/api/visit-dto.ts).
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
  const doctorId = searchParams.get("doctor_id");
  const status = searchParams.get("status");
  const startDate = searchParams.get("start_date");
  const endDate = searchParams.get("end_date");

  try {
    let query = (admin.from("visits") as any)
      .select(V1_VISIT_COLUMNS, { count: "exact" })
      .eq("tenant_id", session.tenantId);

    if (patientId) {
      query = query.eq("patient_id", patientId);
    }
    if (doctorId) {
      query = query.eq("doctor_id", doctorId);
    }
    if (status) {
      query = query.eq("status", status);
    }
    if (startDate && endDate) {
      query = query.or(
        `and(scheduled_at.gte.${startDate},scheduled_at.lte.${endDate}),and(scheduled_at.is.null,created_at.gte.${startDate},created_at.lte.${endDate})`
      );
    } else if (startDate) {
      query = query.or(
        `scheduled_at.gte.${startDate},and(scheduled_at.is.null,created_at.gte.${startDate})`
      );
    } else if (endDate) {
      query = query.or(
        `scheduled_at.lte.${endDate},and(scheduled_at.is.null,created_at.lte.${endDate})`
      );
    }

    const { data: visits, count, error } = await query
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      return apiError("DATABASE_ERROR", error.message, 500, undefined, rateHeaders);
    }

    const total = count || 0;
    const totalPages = Math.ceil(total / limit);

    return apiSuccess(
      visits || [],
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
 * POST /api/v1/visits
 * Create a new clinical visit (walk-in or consultation).
 * Enforces Doctor Guard (D-05) ensuring doctor_id belongs to active clinic and holds 'doctor' or 'owner' role.
 * Grounded in public.visits with created_by = session.userId.
 * A body with clinical content (e.g. `chief_complaints`) → 403 CLINICAL_ACCESS_DENIED (V2-05 05-11c, R-9).
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

  let body: any;
  try {
    body = await req.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON.", 400, undefined, rateHeaders);
  }

  // API keys have no clinical access (R-9; IND M5): clinical content is refused, never silently dropped.
  if (hasClinicalField(body)) {
    return apiError(CLINICAL_ACCESS_DENIED.code, CLINICAL_ACCESS_DENIED.message, 403, undefined, rateHeaders);
  }

  const {
    patient_id,
    doctor_id,
    origin_type,
    reason_for_visit,
    status,
    scheduled_at,
    estimated_duration_minutes,
  } = body || {};

  if (!patient_id || typeof patient_id !== "string") {
    return apiError("VALIDATION_ERROR", "Field 'patient_id' is required.", 422, undefined, rateHeaders);
  }
  if (!doctor_id || typeof doctor_id !== "string") {
    return apiError("VALIDATION_ERROR", "Field 'doctor_id' is required.", 400, undefined, rateHeaders);
  }

  // The same bounds as the app and the database (`visits_duration_range`, V2-05 05-11a/05-11c M-DURATION).
  const duration = apiVisitDuration(estimated_duration_minutes);
  if (duration === null) {
    return apiError("VALIDATION_ERROR", VISIT_DURATION_API_MESSAGE, 422, undefined, rateHeaders);
  }

  const originType = origin_type === "scheduled" ? "scheduled" : "walk_in";
  const visitStatus = status === "in_consultation" ? "in_consultation" : "waiting";

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

    // 2. Enforce Doctor Guard (D-05, T-06-05)
    const doctorCheck = await validateDoctorAssignment(admin, session.tenantId, doctor_id);
    if (!doctorCheck.valid) {
      return apiError(
        "FORBIDDEN_CLINICIAN",
        doctorCheck.error || "Assigned doctor is not a registered doctor or owner in this clinic.",
        403,
        undefined,
        rateHeaders
      );
    }

    // 3. Insert into public.visits. A deadlock victim of a concurrent overlapping slot write is retried once
    // (`retryOnDeadlock`, V2-05 05-11c); a residual deadlock counts as the taken slot (`isSlotTakenError`).
    const { data: newVisitRow, error: insertErr } = await retryOnDeadlock<{ data: any; error: any }>(() => (admin.from("visits") as any)
      .insert({
        tenant_id: session.tenantId,
        patient_id,
        doctor_id,
        origin_type: originType,
        reason_for_visit: reason_for_visit || null,
        status: visitStatus,
        scheduled_at: scheduled_at || null,
        estimated_duration_minutes: duration,
        created_by: session.userId,
      })
      .select(V1_VISIT_COLUMNS)
      .single());

    if (isSlotTakenError(insertErr)) {
      // A scheduled visit overlapping another non-overbooked one of the doctor (V2-05 05-08: visits_no_double_booking).
      return apiError(
        "SLOT_CONFLICT",
        "The requested visit time conflicts with an existing booking for this doctor.",
        409,
        undefined,
        rateHeaders
      );
    }
    if (insertErr || !newVisitRow) {
      return apiError("DATABASE_ERROR", insertErr?.message || "Failed to create visit.", 500, undefined, rateHeaders);
    }
    const newVisit = newVisitRow;

    // 4. Audit log mutation (D-08)
    try {
      await recordAudit(apiKeyServiceContext(session, admin), {
          action: "visit.create",
          entityType: "visit",
          entityId: newVisit.id,
          metadata: {
            origin_type: originType,
            new_status: visitStatus,
          },
      });
    } catch (auditErr) {
      log.error({ event: "api.visits_audit.failed", code: errorTag(auditErr), requestId: await getRequestId() });
    }

    return apiSuccess(newVisit, undefined, 201, rateHeaders);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return apiError("DATABASE_ERROR", message, 500, undefined, rateHeaders);
  }
}
