import { getAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/permissions/guards";
import { recordAuditLegacy } from "@/lib/audit/audit";
import type { Database } from "@/lib/db/types";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface ErasePatientActorSession {
  tenantId: string;
  userId: string;
  role?: string;
  actorType?: "user" | "api_key";
  apiKeyId?: string;
}

export interface ErasePatientResult {
  success: boolean;
  message: string;
  patientId: string;
  erasedAt: string;
  retentionPolicy: string;
}

/**
 * Executes statutory soft-deletion under DPDP Act 2023 Section 12 (Right to Erasure),
 * reconciling patient privacy rights with National Medical Commission (NMC) Regulation 1.3.1
 * mandatory 3-year medical record retention.
 *
 * Hard SQL DELETE is strictly prohibited. The patient status is set to 'erased',
 * is_deleted = true, and erased_at / erasure_reason are populated.
 * Historical visits, clinical notes, prescriptions, and billing records remain
 * immutably archived under restricted compliance retention.
 */
export async function erasePatientRecord(
  patientId: string,
  reason: string,
  actorSession?: ErasePatientActorSession,
  clientOverride?: SupabaseClient<Database>
): Promise<ErasePatientResult> {
  const supabase = clientOverride || (actorSession ? getAdminClient() : await createClient());

  let session: ErasePatientActorSession;
  if (actorSession?.actorType === "api_key") {
    session = actorSession;
  } else if (actorSession) {
    session = actorSession;
  } else {
    const guarded = await requirePermission("patients:edit");
    session = {
      tenantId: guarded.tenantId,
      userId: guarded.userId,
      role: guarded.role,
      actorType: "user",
    };
  }

  // 1. Verify patient exists in tenant
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing, error: fetchErr } = await (supabase.from("patients") as any)
    .select("id, full_name, is_deleted, status")
    .eq("id", patientId)
    .eq("tenant_id", session.tenantId)
    .maybeSingle();

  if (fetchErr || !existing) {
    throw new Error(`Patient not found or unauthorized: ${fetchErr?.message || "Not found"}`);
  }

  const erasedAt = new Date().toISOString();
  const cleanReason = reason.trim() || "DPDP Section 12 Right to Erasure request";

  // 2. Soft-delete patient record (NO HARD DELETE)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: updateErr } = await (supabase.from("patients") as any)
    .update({
      is_deleted: true,
      status: "erased",
      erased_at: erasedAt,
      erasure_reason: cleanReason,
      updated_at: erasedAt,
    })
    .eq("id", patientId)
    .eq("tenant_id", session.tenantId);

  if (updateErr) {
    throw new Error(`Failed to soft-delete patient: ${updateErr.message}`);
  }

  // 3. Record compliance audit entry in audit_logs
  const retentionPolicy = "NMC_REGULATION_1.3.1_3_YEAR_MANDATE";

  await recordAuditLegacy(
    {
      action: "dpdp.patient_erasure",
      entityType: "patient",
      entityId: patientId,
      actorType: session.actorType || "user",
      apiKeyId: session.apiKeyId || null,
      metadata: {
        retention_policy: retentionPolicy,
        erased_at: erasedAt,
        status: "erased",
        reason: cleanReason,
      },
    },
    supabase as any,
    {
      userId: session.userId,
      tenantId: session.tenantId,
      role: session.role || "owner",
    }
  );

  return {
    success: true,
    message: "Patient record erased and archived under NMC statutory retention policy.",
    patientId,
    erasedAt,
    retentionPolicy,
  };
}
