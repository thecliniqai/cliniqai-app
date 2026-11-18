import { NextRequest } from "next/server";
import { authenticateApiKey, apiKeyServiceContext } from "@/lib/api/auth";
import { apiSuccess, apiError, apiDbError } from "@/lib/api/envelope";
import { checkRateLimit, getRateLimitHeaders } from "@/lib/api/rate-limiter";
import { getSystemDb } from "@/lib/supabase/system";
import { validateDoctorAssignment } from "@/lib/api/doctor-guard";
import { recordAudit } from "@/lib/audit/audit";
import { enqueueWebhookEventAsSystem } from "@/lib/jobs/enqueue";
import { errorTag, log } from "@/lib/log";
import { getRequestId } from "@/lib/log/request-id";

/**
 * GET /api/v1/prescriptions
 * List prescriptions with nested medication items.
 * Filters: patient_id, doctor_id, visit_id. Standard page/limit pagination.
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
  const visitId = searchParams.get("visit_id");

  try {
    let query = (admin.from("prescriptions") as any)
      .select(
        "id, tenant_id, visit_id, patient_id, doctor_id, version, status, letterhead_mode, pdf_storage_path, signed_at, amendment_reason, created_at, updated_at, prescription_items(*)",
        { count: "exact" }
      )
      .eq("tenant_id", session.tenantId);

    if (patientId) {
      query = query.eq("patient_id", patientId);
    }
    if (doctorId) {
      query = query.eq("doctor_id", doctorId);
    }
    if (visitId) {
      query = query.eq("visit_id", visitId);
    }

    const { data: prescriptions, count, error } = await query
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      return apiDbError(error, rateHeaders);
    }

    const total = count || 0;
    const totalPages = Math.ceil(total / limit);

    return apiSuccess(
      prescriptions || [],
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
    return apiDbError(err, rateHeaders);
  }
}

/**
 * POST /api/v1/prescriptions
 * Create a new prescription header and nested prescription_items.
 * Validates doctor assignment via Doctor Guard (D-05).
 * Determines next version number per (tenant_id, visit_id) to respect uq_prescriptions_visit_version constraint.
 * Accurately inserts timing and special_instructions (no nonexistent frequency/instructions or tenant_id on items).
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

  const { patient_id, doctor_id, visit_id, items, letterhead_mode } = body || {};

  if (!patient_id || typeof patient_id !== "string") {
    return apiError("VALIDATION_ERROR", "Field 'patient_id' is required.", 422, undefined, rateHeaders);
  }
  if (!doctor_id || typeof doctor_id !== "string") {
    return apiError("VALIDATION_ERROR", "Field 'doctor_id' is required.", 400, undefined, rateHeaders);
  }
  if (!visit_id || typeof visit_id !== "string") {
    return apiError("VALIDATION_ERROR", "Field 'visit_id' is required.", 422, undefined, rateHeaders);
  }
  if (!Array.isArray(items) || items.length === 0) {
    return apiError("VALIDATION_ERROR", "Prescription must contain at least one medication item in 'items'.", 422, undefined, rateHeaders);
  }

  // Validate item format
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item.medicine_name || typeof item.medicine_name !== "string" || !item.medicine_name.trim()) {
      return apiError("VALIDATION_ERROR", `Item at index ${i} is missing required 'medicine_name'.`, 422, undefined, rateHeaders);
    }
    if (!item.dosage || typeof item.dosage !== "string" || !item.dosage.trim()) {
      return apiError("VALIDATION_ERROR", `Item at index ${i} is missing required 'dosage'.`, 422, undefined, rateHeaders);
    }
    if (!item.duration || typeof item.duration !== "string" || !item.duration.trim()) {
      return apiError("VALIDATION_ERROR", `Item at index ${i} is missing required 'duration'.`, 422, undefined, rateHeaders);
    }
  }

  try {
    // 1. Verify patient exists and belongs to active tenant
    const { data: patient, error: patientErr } = await (admin.from("patients") as any)
      .select("id")
      .eq("id", patient_id)
      .eq("tenant_id", session.tenantId)
      .eq("is_deleted", false)
      .maybeSingle();

    if (patientErr) {

      return apiDbError(patientErr, rateHeaders);

    }

    if (!patient) {
      return apiError("NOT_FOUND", "Patient not found in active clinic.", 404, undefined, rateHeaders);
    }

    // 2. Verify visit exists and belongs to active tenant
    const { data: visit, error: visitErr } = await (admin.from("visits") as any)
      .select("id, patient_id, status, signed_at")
      .eq("id", visit_id)
      .eq("tenant_id", session.tenantId)
      .maybeSingle();

    if (visitErr) {

      return apiDbError(visitErr, rateHeaders);

    }

    if (!visit) {
      return apiError("NOT_FOUND", "Visit not found in active clinic.", 404, undefined, rateHeaders);
    }

    // A signed visit gets no new prescription unless it is reopened for amendment: the rule the database applies to
    // signed-in callers (V2-05 05-11e, NF-2: prescriptions_actor_guard). This route writes with the system client, so
    // it applies the rule itself.
    if (visit.signed_at && visit.status !== "in_consultation") {
      return apiError("VISIT_LOCKED", "Signed visits cannot be modified.", 409, undefined, rateHeaders);
    }

    // 3. Enforce Doctor Guard (D-05, T-06-05)
    const doctorCheck = await validateDoctorAssignment(admin, session.tenantId, doctor_id);
    if (doctorCheck.dbError) {
      return apiDbError(doctorCheck.dbError, rateHeaders);
    }
    if (!doctorCheck.valid) {
      return apiError(
        "FORBIDDEN_CLINICIAN",
        doctorCheck.error || "Assigned doctor is not a registered doctor or owner in this clinic.",
        403,
        undefined,
        rateHeaders
      );
    }

    // 4. Calculate next version number for this (tenant_id, visit_id)
    const { data: latestPrescription } = await (admin.from("prescriptions") as any)
      .select("version")
      .eq("tenant_id", session.tenantId)
      .eq("visit_id", visit_id)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    const nextVersion = latestPrescription && typeof latestPrescription.version === "number"
      ? latestPrescription.version + 1
      : 1;

    // 5. Insert prescription header
    const { data: newPrescription, error: presErr } = await (admin.from("prescriptions") as any)
      .insert({
        tenant_id: session.tenantId,
        visit_id,
        patient_id,
        doctor_id,
        version: nextVersion,
        status: "active",
        letterhead_mode: letterhead_mode === "preprinted_letterhead" ? "preprinted_letterhead" : "blank_paper",
      })
      .select()
      .single();

    if (presErr || !newPrescription) {
      return apiDbError(presErr, rateHeaders);
    }

    // 6. Insert items into public.prescription_items (using timing and special_instructions, NO tenant_id)
    const itemsToInsert = items.map((item: any, index: number) => ({
      prescription_id: newPrescription.id,
      medicine_name: item.medicine_name.trim(),
      generic_name: item.generic_name?.trim() || null,
      dose_form: item.dose_form || null,
      dosage: item.dosage.trim(),
      timing: item.timing || null,
      duration: item.duration.trim(),
      special_instructions: item.special_instructions || null,
      cdci_brand_id: item.cdci_brand_id || null,
      cdci_generic_id: item.cdci_generic_id || null,
      sort_order: typeof item.sort_order === "number" ? item.sort_order : index,
    }));

    const { data: createdItems, error: itemsErr } = await (admin.from("prescription_items") as any)
      .insert(itemsToInsert)
      .select();

    if (itemsErr) {
      // Clean up header if items failed
      await (admin.from("prescriptions") as any).delete().eq("id", newPrescription.id);
      return apiDbError(itemsErr, rateHeaders);
    }

    // 7. Audit log (D-08)
    try {
      await recordAudit(apiKeyServiceContext(session, admin), {
          action: "prescription.create",
          entityType: "prescription",
          entityId: newPrescription.id,
          metadata: {
            version: nextVersion,
            items_count: items.length,
          },
      });
    } catch (auditErr) {
      log.error({ event: "api.prescriptions_audit.failed", code: errorTag(auditErr), requestId: await getRequestId() });
    }

    // 8. Webhook event prescription.issued (04-03b): queued through the system RPC; tenant and data from the row.
    try {
      await enqueueWebhookEventAsSystem(admin, "prescription.issued", newPrescription.id, "system:api_v1");
    } catch (webhookErr) {
      log.warn({ event: "api.prescriptions_webhook.failed", code: errorTag(webhookErr), requestId: await getRequestId() });
    }

    return apiSuccess(
      {
        ...newPrescription,
        prescription_items: createdItems || [],
      },
      undefined,
      201,
      rateHeaders
    );
  } catch (err: unknown) {
    return apiDbError(err, rateHeaders);
  }
}
