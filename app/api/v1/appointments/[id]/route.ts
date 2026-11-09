import { NextRequest } from "next/server";
import { authenticateApiKey } from "@/lib/api/auth";
import { apiSuccess, apiError } from "@/lib/api/envelope";
import { checkRateLimit, getRateLimitHeaders } from "@/lib/api/rate-limiter";
import { getAdminClient } from "@/lib/supabase/admin";
import { checkSlotAvailability } from "@/features/visits/scheduling";
import { recordAudit } from "@/lib/audit/audit";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/v1/appointments/[id]
 * Retrieve appointment details by ID. Scoped strictly to public.visits where
 * origin_type = 'scheduled' and tenant_id = session.tenantId.
 */
export async function GET(req: NextRequest, { params }: RouteContext) {
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
  const admin = getAdminClient();

  try {
    const { data: visit, error } = await (admin.from("visits") as any)
      .select("id, tenant_id, patient_id, doctor_id, origin_type, scheduled_at, estimated_duration_minutes, reason_for_visit, status, created_by, created_at, updated_at")
      .eq("id", id)
      .eq("tenant_id", session.tenantId)
      .eq("origin_type", "scheduled")
      .maybeSingle();

    if (error) {
      return apiError("DATABASE_ERROR", error.message, 500, undefined, rateHeaders);
    }

    if (!visit) {
      return apiError("NOT_FOUND", "Appointment not found.", 404, undefined, rateHeaders);
    }

    return apiSuccess(visit, undefined, 200, rateHeaders);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return apiError("DATABASE_ERROR", message, 500, undefined, rateHeaders);
  }
}

/**
 * PATCH /api/v1/appointments/[id]
 * Reschedule an appointment: updates scheduled_at (and optionally doctor_id / reason).
 * Enforces slot-conflict checking for the new time slot.
 */
export async function PATCH(req: NextRequest, { params }: RouteContext) {
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
  let body: any;
  try {
    body = await req.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON.", 400, undefined, rateHeaders);
  }

  const { scheduled_at, doctor_id, reason } = body || {};
  if (!scheduled_at && !doctor_id) {
    return apiError(
      "VALIDATION_ERROR",
      "Must provide at least 'scheduled_at' or 'doctor_id' to reschedule.",
      422,
      undefined,
      rateHeaders
    );
  }

  const admin = getAdminClient();

  try {
    // 1. Fetch existing appointment
    const { data: existing, error: fetchErr } = await (admin.from("visits") as any)
      .select("*")
      .eq("id", id)
      .eq("tenant_id", session.tenantId)
      .eq("origin_type", "scheduled")
      .maybeSingle();

    if (fetchErr) {
      return apiError("DATABASE_ERROR", fetchErr.message, 500, undefined, rateHeaders);
    }
    if (!existing) {
      return apiError("NOT_FOUND", "Appointment not found.", 404, undefined, rateHeaders);
    }

    if (existing.status === "cancelled") {
      return apiError("BAD_REQUEST", "Cannot reschedule a cancelled appointment.", 400, undefined, rateHeaders);
    }

    const targetDoctorId = doctor_id || existing.doctor_id;
    const targetScheduledAt = scheduled_at || existing.scheduled_at;
    const duration = existing.estimated_duration_minutes || 15;

    // 2. If scheduled_at or doctor_id changed, check slot conflicts
    if (scheduled_at !== existing.scheduled_at || doctor_id !== existing.doctor_id) {
      const slotCheck = await checkSlotAvailability(
        targetDoctorId,
        targetScheduledAt,
        duration,
        admin,
        { userId: session.userId, tenantId: session.tenantId }
      );

      // Ignore conflict if it conflicts with itself
      if (
        !slotCheck.available &&
        slotCheck.conflictingVisit &&
        slotCheck.conflictingVisit.id !== id
      ) {
        return apiError(
          "SLOT_CONFLICT",
          "The requested rescheduled time slot conflicts with an existing booking.",
          409,
          { conflicting_visit_id: slotCheck.conflictingVisit.id },
          rateHeaders
        );
      }
    }

    // 3. Update visit
    const updatePayload: Record<string, unknown> = {
      scheduled_at: targetScheduledAt,
      doctor_id: targetDoctorId,
      updated_at: new Date().toISOString(),
    };

    const { data: updated, error: updateErr } = await (admin.from("visits") as any)
      .update(updatePayload)
      .eq("id", id)
      .eq("tenant_id", session.tenantId)
      .select()
      .single();

    if (updateErr || !updated) {
      return apiError("DATABASE_ERROR", updateErr?.message || "Failed to update appointment", 500, undefined, rateHeaders);
    }

    // 4. Record audit log
    await recordAudit(
      {
        action: "appointment.reschedule",
        entityType: "appointment",
        entityId: id,
        actorType: "api_key",
        apiKeyId: session.apiKeyId,
        metadata: {
          old_status: existing.scheduled_at,
          new_status: targetScheduledAt,
          reason: reason || "API rescheduled",
          actor_type: "api_key",
          api_key_id: session.apiKeyId,
        },
      },
      admin,
      {
        userId: session.userId,
        tenantId: session.tenantId,
        role: session.role,
      }
    );

    return apiSuccess(updated, undefined, 200, rateHeaders);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return apiError("DATABASE_ERROR", message, 500, undefined, rateHeaders);
  }
}

/**
 * DELETE /api/v1/appointments/[id]
 * Cancels a scheduled appointment: updates status to 'cancelled'.
 */
export async function DELETE(req: NextRequest, { params }: RouteContext) {
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
  const admin = getAdminClient();

  try {
    const { data: existing, error: fetchErr } = await (admin.from("visits") as any)
      .select("id, status")
      .eq("id", id)
      .eq("tenant_id", session.tenantId)
      .eq("origin_type", "scheduled")
      .maybeSingle();

    if (fetchErr) {
      return apiError("DATABASE_ERROR", fetchErr.message, 500, undefined, rateHeaders);
    }
    if (!existing) {
      return apiError("NOT_FOUND", "Appointment not found.", 404, undefined, rateHeaders);
    }

    const { data: cancelled, error: cancelErr } = await (admin.from("visits") as any)
      .update({
        status: "cancelled",
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("tenant_id", session.tenantId)
      .select()
      .single();

    if (cancelErr || !cancelled) {
      return apiError("DATABASE_ERROR", cancelErr?.message || "Failed to cancel appointment", 500, undefined, rateHeaders);
    }

    // Record audit log
    await recordAudit(
      {
        action: "appointment.cancel",
        entityType: "appointment",
        entityId: id,
        actorType: "api_key",
        apiKeyId: session.apiKeyId,
        metadata: {
          old_status: existing.status,
          new_status: "cancelled",
          actor_type: "api_key",
          api_key_id: session.apiKeyId,
        },
      },
      admin,
      {
        userId: session.userId,
        tenantId: session.tenantId,
        role: session.role,
      }
    );

    return apiSuccess(
      {
        id,
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
      },
      undefined,
      200,
      rateHeaders
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return apiError("DATABASE_ERROR", message, 500, undefined, rateHeaders);
  }
}
