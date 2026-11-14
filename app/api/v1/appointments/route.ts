import { NextRequest } from "next/server";
import { authenticateApiKey, apiKeyServiceContext } from "@/lib/api/auth";
import { apiSuccess, apiError } from "@/lib/api/envelope";
import { checkRateLimit, getRateLimitHeaders } from "@/lib/api/rate-limiter";
import { getSystemDb } from "@/lib/supabase/system";
import { checkSlotAvailability } from "@/features/visits/scheduling-service";
import { isSlotTakenError } from "@/features/visits/service";
import { retryOnDeadlock } from "@/lib/db/retry";
import { recordAudit } from "@/lib/audit/audit";

/**
 * GET /api/v1/appointments
 * List scheduled appointments grounded in public.visits where origin_type = 'scheduled'.
 * Filters: doctor_id, status, start_date, end_date. Standard page/limit pagination.
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

  const doctorId = searchParams.get("doctor_id");
  const status = searchParams.get("status");
  const startDate = searchParams.get("start_date");
  const endDate = searchParams.get("end_date");

  try {
    let query = (admin.from("visits") as any)
      .select("id, tenant_id, patient_id, doctor_id, origin_type, scheduled_at, estimated_duration_minutes, reason_for_visit, status, created_by, created_at, updated_at", {
        count: "exact",
      })
      .eq("tenant_id", session.tenantId)
      .eq("origin_type", "scheduled");

    if (doctorId) {
      query = query.eq("doctor_id", doctorId);
    }
    if (status) {
      query = query.eq("status", status);
    }
    if (startDate) {
      query = query.gte("scheduled_at", startDate);
    }
    if (endDate) {
      query = query.lte("scheduled_at", endDate);
    }

    const { data: visits, count, error } = await query
      .order("scheduled_at", { ascending: true })
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
 * POST /api/v1/appointments
 * Create a new scheduled appointment persisted in public.visits.
 * Validates doctor belongs to tenant, runs slot-conflict checks, and audits creation.
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

  const { patient_id, doctor_id, scheduled_at, estimated_duration_minutes, reason_for_visit } = body || {};

  if (!patient_id || typeof patient_id !== "string") {
    return apiError("VALIDATION_ERROR", "Field 'patient_id' is required.", 422, undefined, rateHeaders);
  }
  if (!doctor_id || typeof doctor_id !== "string") {
    return apiError("VALIDATION_ERROR", "Field 'doctor_id' is required.", 422, undefined, rateHeaders);
  }
  if (!scheduled_at || isNaN(new Date(scheduled_at).getTime())) {
    return apiError("VALIDATION_ERROR", "Field 'scheduled_at' must be a valid ISO 8601 date timestamp.", 422, undefined, rateHeaders);
  }

  const duration = typeof estimated_duration_minutes === "number" && estimated_duration_minutes > 0
    ? estimated_duration_minutes
    : 15;

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

    // 2. Verify doctor belongs to active tenant with doctor or owner role (D-05)
    const { data: doctor, error: doctorErr } = await (admin.from("memberships") as any)
      .select("id, role")
      .eq("user_id", doctor_id)
      .eq("tenant_id", session.tenantId)
      .maybeSingle();

    if (doctorErr || !doctor || !["doctor", "owner"].includes(doctor.role)) {
      return apiError(
        "FORBIDDEN",
        "Assigned doctor is not a registered doctor or owner in this clinic.",
        403,
        undefined,
        rateHeaders
      );
    }

    // 3. Slot conflict verification
    const slotCheck = await checkSlotAvailability(
      apiKeyServiceContext(session, admin),
      doctor_id,
      scheduled_at,
      duration
    );

    if (slotCheck.checkFailed) {
      // Fail closed (V2-01 F8): availability could not be verified, so nothing is booked
      return apiError(
        "SLOT_CHECK_FAILED",
        "Slot availability could not be verified. Please retry.",
        503,
        undefined,
        rateHeaders
      );
    }

    if (!slotCheck.available) {
      if (slotCheck.conflictingVisit) {
        return apiError(
          "SLOT_CONFLICT",
          "The requested appointment slot conflicts with an existing booking for this doctor.",
          409,
          {
            conflicting_visit_id: slotCheck.conflictingVisit.id,
            scheduled_at: slotCheck.conflictingVisit.scheduled_at,
          },
          rateHeaders
        );
      }
      if (slotCheck.isBlocked) {
        return apiError(
          "SLOT_CONFLICT",
          `Doctor is unavailable or blocked: ${slotCheck.blockReason || "Time blocked"}`,
          409,
          undefined,
          rateHeaders
        );
      }
      if (slotCheck.isOffDuty) {
        return apiError(
          "SLOT_CONFLICT",
          "Selected time is outside doctor working hours.",
          409,
          undefined,
          rateHeaders
        );
      }
    }

    // 4. Insert into public.visits with origin_type = 'scheduled'. A deadlock victim of a concurrent overlapping slot
    // write is retried once (`retryOnDeadlock`, V2-05 05-11c); a residual deadlock counts as the taken slot.
    const { data: visit, error: insertErr } = await retryOnDeadlock<{ data: any; error: any }>(() => (admin.from("visits") as any)
      .insert({
        tenant_id: session.tenantId,
        patient_id,
        doctor_id,
        origin_type: "scheduled",
        scheduled_at,
        estimated_duration_minutes: duration,
        reason_for_visit: reason_for_visit || null,
        status: "booked",
        created_by: session.userId,
      })
      .select()
      .single());

    if (isSlotTakenError(insertErr)) {
      // Booked by someone else after the slot check above (V2-05 05-08: the visits_no_double_booking constraint).
      return apiError(
        "SLOT_CONFLICT",
        "The requested appointment slot conflicts with an existing booking for this doctor.",
        409,
        undefined,
        rateHeaders
      );
    }
    if (insertErr || !visit) {
      return apiError("DATABASE_ERROR", insertErr?.message || "Failed to create appointment", 500, undefined, rateHeaders);
    }

    // 5. Record audit log
    await recordAudit(apiKeyServiceContext(session, admin), {
        action: "appointment.create",
        entityType: "appointment",
        entityId: visit.id,
        metadata: {
          doctor_id,
          patient_id,
          scheduled_at,
          actor_type: "api_key",
          api_key_id: session.apiKeyId,
        },
    });

    return apiSuccess(visit, undefined, 201, rateHeaders);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return apiError("DATABASE_ERROR", message, 500, undefined, rateHeaders);
  }
}
