import { NextRequest } from "next/server";
import { authenticateApiKey } from "@/lib/api/auth";
import { apiSuccess, apiError } from "@/lib/api/envelope";
import { checkRateLimit, getRateLimitHeaders } from "@/lib/api/rate-limiter";
import { getAdminClient } from "@/lib/supabase/admin";
import { validateDoctorAssignment } from "@/lib/api/doctor-guard";
import { recordAuditLegacy } from "@/lib/audit/audit";

/**
 * GET /api/v1/referrals
 * List outbound referrals created by the active clinic.
 * Filters: patient_id, status, referral_type. Standard page/limit pagination.
 */
export async function GET(req: NextRequest) {
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

  const searchParams = req.nextUrl.searchParams;
  const pageRaw = parseInt(searchParams.get("page") || "1", 10);
  const limitRaw = parseInt(searchParams.get("limit") || "20", 10);

  const page = Number.isInteger(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 100) : 20;
  const offset = (page - 1) * limit;

  const patientId = searchParams.get("patient_id");
  const status = searchParams.get("status");
  const referralType = searchParams.get("referral_type");

  const admin = getAdminClient();

  try {
    let query = (admin.from("referrals") as any)
      .select("*", { count: "exact" })
      .eq("tenant_id", session.tenantId);

    if (patientId) {
      query = query.eq("patient_id", patientId);
    }
    if (status) {
      query = query.eq("status", status);
    }
    if (referralType) {
      query = query.eq("referral_type", referralType);
    }

    const { data: referrals, count, error } = await query
      .order("sent_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      return apiError("DATABASE_ERROR", error.message, 500, undefined, rateHeaders);
    }

    const total = count || 0;
    const totalPages = Math.ceil(total / limit);

    return apiSuccess(
      referrals || [],
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
 * POST /api/v1/referrals
 * Create a new clinical referral grounded in public.referrals.
 * Enforces Doctor Guard on referring_doctor_id (D-05, T-06-05).
 * Enforces patient_consents_history_sharing for in-network referrals (T-06-08).
 */
export async function POST(req: NextRequest) {
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

  let body: any;
  try {
    body = await req.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON.", 400, undefined, rateHeaders);
  }

  const {
    patient_id,
    visit_id,
    referring_doctor_id,
    referral_type,
    referred_to_name,
    referred_to_facility,
    referred_to_specialty,
    referred_to_contact,
    target_tenant_id,
    target_doctor_id,
    reason_for_referral,
    provisional_diagnosis,
    urgency,
    clinical_summary,
    patient_consents_history_sharing,
    consented_history_snapshot,
  } = body || {};

  if (!patient_id || typeof patient_id !== "string") {
    return apiError("VALIDATION_ERROR", "Field 'patient_id' is required.", 422, undefined, rateHeaders);
  }
  if (!referring_doctor_id || typeof referring_doctor_id !== "string") {
    return apiError("VALIDATION_ERROR", "Field 'referring_doctor_id' is required.", 400, undefined, rateHeaders);
  }
  if (!referred_to_name || typeof referred_to_name !== "string" || !referred_to_name.trim()) {
    return apiError("VALIDATION_ERROR", "Field 'referred_to_name' is required.", 422, undefined, rateHeaders);
  }
  if (!reason_for_referral || typeof reason_for_referral !== "string" || !reason_for_referral.trim()) {
    return apiError("VALIDATION_ERROR", "Field 'reason_for_referral' is required.", 422, undefined, rateHeaders);
  }

  const type = referral_type === "in_network" ? "in_network" : "out_of_network";
  const priority = ["routine", "priority", "urgent"].includes(urgency) ? urgency : "routine";

  // In-network referrals require explicit patient consent for history sharing (T-06-08)
  if (type === "in_network" && !patient_consents_history_sharing) {
    return apiError(
      "CONSENT_REQUIRED",
      "In-network referrals require explicit patient consent for clinical history sharing.",
      422,
      undefined,
      rateHeaders
    );
  }

  const admin = getAdminClient();

  try {
    // 1. Verify patient belongs to active tenant
    const { data: patient, error: patientErr } = await (admin.from("patients") as any)
      .select("id")
      .eq("id", patient_id)
      .eq("tenant_id", session.tenantId)
      .eq("is_deleted", false)
      .maybeSingle();

    if (patientErr || !patient) {
      return apiError("NOT_FOUND", "Patient not found in active clinic.", 404, undefined, rateHeaders);
    }

    // 2. Verify visit if provided
    if (visit_id) {
      const { data: visit, error: visitErr } = await (admin.from("visits") as any)
        .select("id")
        .eq("id", visit_id)
        .eq("tenant_id", session.tenantId)
        .maybeSingle();

      if (visitErr || !visit) {
        return apiError("NOT_FOUND", "Referenced visit not found in active clinic.", 404, undefined, rateHeaders);
      }
    }

    // 3. Enforce Doctor Guard on referring clinician (D-05, T-06-05)
    const doctorCheck = await validateDoctorAssignment(session.tenantId, referring_doctor_id, admin);
    if (!doctorCheck.valid) {
      return apiError(
        "FORBIDDEN_CLINICIAN",
        doctorCheck.error || "Referring clinician is not a registered doctor or owner in this clinic.",
        403,
        undefined,
        rateHeaders
      );
    }

    // 4. Insert into public.referrals
    const { data: newReferral, error: insertErr } = await (admin.from("referrals") as any)
      .insert({
        tenant_id: session.tenantId,
        patient_id,
        visit_id: visit_id || null,
        referral_type: type,
        referring_doctor_id,
        referred_to_name: referred_to_name.trim(),
        referred_to_facility: referred_to_facility?.trim() || null,
        referred_to_specialty: referred_to_specialty?.trim() || null,
        referred_to_contact: referred_to_contact?.trim() || null,
        target_tenant_id: target_tenant_id || null,
        target_doctor_id: target_doctor_id || null,
        reason_for_referral: reason_for_referral.trim(),
        provisional_diagnosis: provisional_diagnosis?.trim() || null,
        urgency: priority,
        clinical_summary: clinical_summary?.trim() || null,
        patient_consents_history_sharing: Boolean(patient_consents_history_sharing),
        consented_history_snapshot: consented_history_snapshot || null,
        status: "sent",
      })
      .select()
      .single();

    if (insertErr || !newReferral) {
      return apiError("DATABASE_ERROR", insertErr?.message || "Failed to create referral.", 500, undefined, rateHeaders);
    }

    // 5. Record audit log (D-08)
    try {
      await recordAuditLegacy(
        {
          action: "referral.create",
          entityType: "referral",
          entityId: newReferral.id,
          actorType: "api_key",
          apiKeyId: session.apiKeyId,
          metadata: {
            referral_type: type,
            urgency: priority,
            patient_consents_history_sharing: newReferral.patient_consents_history_sharing,
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
      console.error("[api/v1/referrals] Audit logging failed:", auditErr);
    }

    return apiSuccess(newReferral, undefined, 201, rateHeaders);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return apiError("DATABASE_ERROR", message, 500, undefined, rateHeaders);
  }
}
