import { NextRequest } from "next/server";
import { authenticateApiKey, apiKeyServiceContext } from "@/lib/api/auth";
import { apiSuccess, apiError } from "@/lib/api/envelope";
import { checkRateLimit, getRateLimitHeaders } from "@/lib/api/rate-limiter";
import { getSystemDb } from "@/lib/supabase/system";
import { validateDoctorAssignment } from "@/lib/api/doctor-guard";
import { recordAudit } from "@/lib/audit/audit";

/**
 * GET /api/v1/visits
 * List visits (walk-in and scheduled encounters) grounded in public.visits.
 * Filters: patient_id, doctor_id, status, start_date, end_date. Standard page/limit pagination.
 */
export async function GET(req: NextRequest) {
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
      .select(
        "id, tenant_id, patient_id, doctor_id, origin_type, status, scheduled_at, estimated_duration_minutes, reason_for_visit, is_overbooked, vitals, chief_complaints, clinical_notes, specialty, created_by, created_at, updated_at",
        { count: "exact" }
      )
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
 */
export async function POST(req: NextRequest) {
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

  let body: any;
  try {
    body = await req.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON.", 400, undefined, rateHeaders);
  }

  const {
    patient_id,
    doctor_id,
    origin_type,
    reason_for_visit,
    chief_complaints,
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

    // 3. Format chief complaints as JSONB
    let formattedComplaints: any[] = [];
    if (Array.isArray(chief_complaints)) {
      formattedComplaints = chief_complaints;
    } else if (typeof chief_complaints === "string" && chief_complaints.trim()) {
      formattedComplaints = [{ complaint: chief_complaints.trim() }];
    }

    // 4. Insert into public.visits
    const { data: newVisit, error: insertErr } = await (admin.from("visits") as any)
      .insert({
        tenant_id: session.tenantId,
        patient_id,
        doctor_id,
        origin_type: originType,
        reason_for_visit: reason_for_visit || null,
        chief_complaints: formattedComplaints,
        status: visitStatus,
        scheduled_at: scheduled_at || null,
        estimated_duration_minutes:
          typeof estimated_duration_minutes === "number" && estimated_duration_minutes > 0
            ? estimated_duration_minutes
            : 15,
        created_by: session.userId,
      })
      .select()
      .single();

    if (insertErr || !newVisit) {
      return apiError("DATABASE_ERROR", insertErr?.message || "Failed to create visit.", 500, undefined, rateHeaders);
    }

    // 5. Audit log mutation (D-08)
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
      console.error("[api/v1/visits] Audit logging failed:", auditErr);
    }

    return apiSuccess(newVisit, undefined, 201, rateHeaders);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return apiError("DATABASE_ERROR", message, 500, undefined, rateHeaders);
  }
}
