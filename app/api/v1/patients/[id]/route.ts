import { NextRequest } from "next/server";
import { authenticateApiKey, apiKeyServiceContext } from "@/lib/api/auth";
import { apiSuccess, apiError, apiDbError } from "@/lib/api/envelope";
import { checkRateLimit, getRateLimitHeaders } from "@/lib/api/rate-limiter";
import { getSystemDb } from "@/lib/supabase/system";
import { z } from "zod";
import { INDIAN_MOBILE_REGEX, toE164, extractTenDigits } from "@/lib/utils/phone";
import { recordAudit } from "@/lib/audit/audit";
import { erasePatientRecord } from "@/features/dpdp/erasure";
import { hasPatientClinicalField, PATIENT_CLINICAL_ACCESS_DENIED } from "@/lib/api/patient-dto";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const patientUpdateSchema = z.object({
  full_name: z
    .string()
    .trim()
    .min(1, "Patient full name is required.")
    .max(120, "Name must be under 120 characters.")
    .optional(),
  phone: z
    .string()
    .trim()
    .transform((val) => extractTenDigits(val))
    .refine((val) => INDIAN_MOBILE_REGEX.test(val), {
      message: "Please enter a valid 10-digit Indian mobile number starting with 6, 7, 8, or 9.",
    })
    .transform((val) => toE164(val))
    .optional(),
  date_of_birth: z.string().optional().nullable(),
  age: z.number().int().min(0).max(130).optional().nullable(),
  sex: z.enum(["male", "female", "other"]).optional().nullable(),
  address: z.record(z.unknown()).optional().nullable(),
  // allergies / chronic_conditions are clinical: refused before parsing (05-11d, N-6).
  emergency_contact: z.record(z.unknown()).optional().nullable(),
  abha_id: z.string().optional().nullable(),
});

/**
 * GET /api/v1/patients/[id]
 * Retrieve single patient details scoped to authenticated tenant.
 * Returns 404 if patient does not exist or has been soft-deleted / erased.
 */
export async function GET(req: NextRequest, { params }: RouteContext) {
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

  try {
    const { data: patient, error } = await (admin.from("patients") as any)
      .select("*")
      .eq("id", id)
      .eq("tenant_id", session.tenantId)
      .eq("is_deleted", false)
      .maybeSingle();

    if (error) {
      return apiDbError(error, rateHeaders);
    }

    if (!patient || patient.status === "erased") {
      return apiError("NOT_FOUND", "Patient not found.", 404, undefined, rateHeaders);
    }

    return apiSuccess(patient, undefined, 200, rateHeaders);
  } catch (err: unknown) {
    return apiDbError(err, rateHeaders);
  }
}

/**
 * PUT /api/v1/patients/[id]
 * Updates patient demographics scoped to active tenant.
 * Records audit trail with actor_type: 'api_key'.
 * A body with `allergies` or `chronic_conditions` → 403 CLINICAL_ACCESS_DENIED, nothing written (V2-05 05-11d, N-6:
 * API keys hold no clinical access, R-9; in the app these fields need consultations:view, R-8).
 */
export async function PUT(req: NextRequest, { params }: RouteContext) {
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON.", 400, undefined, rateHeaders);
  }

  // Clinical fields are refused, never silently dropped, before anything is read (N-6).
  if (hasPatientClinicalField(body)) {
    return apiError(PATIENT_CLINICAL_ACCESS_DENIED.code, PATIENT_CLINICAL_ACCESS_DENIED.message, 403, undefined, rateHeaders);
  }

  const parseResult = patientUpdateSchema.safeParse(body);
  if (!parseResult.success) {
    return apiError(
      "VALIDATION_ERROR",
      parseResult.error.issues[0]?.message || "Validation failed.",
      422,
      parseResult.error.flatten(),
      rateHeaders
    );
  }

  try {
    // 1. Verify patient exists and belongs to tenant
    const { data: existing, error: fetchErr } = await (admin.from("patients") as any)
      .select("id")
      .eq("id", id)
      .eq("tenant_id", session.tenantId)
      .eq("is_deleted", false)
      .maybeSingle();

    if (fetchErr) {
      return apiDbError(fetchErr, rateHeaders);
    }

    if (!existing) {
      return apiError("NOT_FOUND", "Patient not found.", 404, undefined, rateHeaders);
    }

    // 2. Perform update
    const updatePayload: Record<string, unknown> = {
      ...parseResult.data,
      updated_at: new Date().toISOString(),
    };

    const { data: updatedPatient, error: updateErr } = await (admin.from("patients") as any)
      .update(updatePayload)
      .eq("id", id)
      .eq("tenant_id", session.tenantId)
      .select()
      .single();

    if (updateErr || !updatedPatient) {
      return apiDbError(updateErr, rateHeaders);
    }

    // 3. Record audit log
    await recordAudit(apiKeyServiceContext(session, admin), {
        action: "patient.update",
        entityType: "patient",
        entityId: id,
        metadata: {
          fields_changed: Object.keys(parseResult.data),
          actor_type: "api_key",
          api_key_id: session.apiKeyId,
        },
    });

    return apiSuccess(updatedPatient, undefined, 200, rateHeaders);
  } catch (err: unknown) {
    return apiDbError(err, rateHeaders);
  }
}

/**
 * DELETE /api/v1/patients/[id]
 * DPDP Right to Erasure statutory soft-deletion endpoint.
 * Sets is_deleted = true, status = 'erased', erased_at = now().
 * Retains underlying clinical records for NMC mandatory 3-year medical record retention.
 */
export async function DELETE(req: NextRequest, { params }: RouteContext) {
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
  let reason = "DPDP Section 12 Right to Erasure request";
  try {
    const body = await req.json();
    if (body?.reason && typeof body.reason === "string") {
      reason = body.reason.trim();
    }
  } catch {
    // Body is optional on DELETE
  }

  try {
    const result = await erasePatientRecord(apiKeyServiceContext(session, admin), id, reason);

    return apiSuccess(
      {
        success: true,
        message: "Patient record erased and archived under NMC statutory retention policy.",
        erased_at: result.erasedAt,
        retention_policy: result.retentionPolicy,
      },
      undefined,
      200,
      rateHeaders
    );
  } catch (err: unknown) {
    // A failed read or write carries the database error as its cause: mapped to a fixed text (05-11c, INT L-4).
    const cause = err instanceof Error ? err.cause : undefined;
    if (cause && typeof cause === "object") {
      return apiDbError(cause, rateHeaders, { event: "api.patient_erase.failed" });
    }
    const message = err instanceof Error ? err.message : "";
    if (message.startsWith("Patient not found")) {
      return apiError("NOT_FOUND", "Patient not found or unauthorized.", 404, undefined, rateHeaders);
    }
    return apiDbError(err, rateHeaders, { event: "api.patient_erase.failed" });
  }
}

