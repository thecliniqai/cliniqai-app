import { NextRequest } from "next/server";
import { authenticateApiKey } from "@/lib/api/auth";
import { apiSuccess, apiError } from "@/lib/api/envelope";
import { checkRateLimit, getRateLimitHeaders } from "@/lib/api/rate-limiter";
import { getAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";
import { INDIAN_MOBILE_REGEX, toE164, extractTenDigits } from "@/lib/utils/phone";
import { recordAudit } from "@/lib/audit/audit";
import { erasePatientRecord } from "@/features/dpdp/erasure";

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
  allergies: z.array(z.string()).optional(),
  chronic_conditions: z.array(z.string()).optional(),
  emergency_contact: z.record(z.unknown()).optional().nullable(),
  abha_id: z.string().optional().nullable(),
});

/**
 * GET /api/v1/patients/[id]
 * Retrieve single patient details scoped to authenticated tenant.
 * Returns 404 if patient does not exist or has been soft-deleted / erased.
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
    const { data: patient, error } = await (admin.from("patients") as any)
      .select("*")
      .eq("id", id)
      .eq("tenant_id", session.tenantId)
      .eq("is_deleted", false)
      .maybeSingle();

    if (error) {
      return apiError("DATABASE_ERROR", error.message, 500, undefined, rateHeaders);
    }

    if (!patient || patient.status === "erased") {
      return apiError("NOT_FOUND", "Patient not found.", 404, undefined, rateHeaders);
    }

    return apiSuccess(patient, undefined, 200, rateHeaders);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return apiError("DATABASE_ERROR", message, 500, undefined, rateHeaders);
  }
}

/**
 * PUT /api/v1/patients/[id]
 * Updates patient demographics scoped to active tenant.
 * Records audit trail with actor_type: 'api_key'.
 */
export async function PUT(req: NextRequest, { params }: RouteContext) {
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON.", 400, undefined, rateHeaders);
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
      return apiError("DATABASE_ERROR", fetchErr.message, 500, undefined, rateHeaders);
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
      return apiError("DATABASE_ERROR", updateErr?.message || "Failed to update patient", 500, undefined, rateHeaders);
    }

    // 3. Record audit log
    await recordAudit(
      {
        action: "patient.update",
        entityType: "patient",
        entityId: id,
        actorType: "api_key",
        apiKeyId: session.apiKeyId,
        metadata: {
          fields_changed: Object.keys(parseResult.data),
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

    return apiSuccess(updatedPatient, undefined, 200, rateHeaders);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return apiError("DATABASE_ERROR", message, 500, undefined, rateHeaders);
  }
}

/**
 * DELETE /api/v1/patients/[id]
 * DPDP Right to Erasure statutory soft-deletion endpoint.
 * Sets is_deleted = true, status = 'erased', erased_at = now().
 * Retains underlying clinical records for NMC mandatory 3-year medical record retention.
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
    const admin = getAdminClient();
    const result = await erasePatientRecord(
      id,
      reason,
      {
        tenantId: session.tenantId,
        userId: session.userId,
        role: session.role,
        actorType: "api_key",
        apiKeyId: session.apiKeyId,
      },
      admin
    );

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
    const message = err instanceof Error ? err.message : "Unknown error";
    if (message.includes("not found")) {
      return apiError("NOT_FOUND", "Patient not found or unauthorized.", 404, undefined, rateHeaders);
    }
    return apiError("DATABASE_ERROR", message, 500, undefined, rateHeaders);
  }
}

