import "server-only";

import { assertPerm } from "@/lib/permissions";
import type { ServiceContext } from "@/lib/auth/context";
import { recordAudit } from "@/lib/audit/audit";

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
 *
 * Tenant and actor come only from `ctx` (ADR-0005 D1): a staff session (`requireServiceContext`) or a verified API
 * key (`apiKeyServiceContext`, `/api/v1` register). Requires patients:edit, as before.
 */
export async function erasePatientRecord(
  ctx: ServiceContext,
  patientId: string,
  reason: string
): Promise<ErasePatientResult> {
  assertPerm(ctx.role, "patients:edit");
  const supabase = ctx.db;

  // 1. Verify patient exists in the acting tenant
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing, error: fetchErr } = await (supabase.from("patients") as any)
    .select("id, is_deleted, status")
    .eq("id", patientId)
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();

  if (fetchErr || !existing) {
    throw new Error("Patient not found or unauthorized.", { cause: fetchErr });
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
    .eq("tenant_id", ctx.tenantId);

  if (updateErr) {
    throw new Error("Failed to soft-delete patient.", { cause: updateErr });
  }

  // 3. Record compliance audit entry (the free-text reason stays on the patient row, not in the audit trail)
  const retentionPolicy = "NMC_REGULATION_1.3.1_3_YEAR_MANDATE";

  await recordAudit(ctx, {
    action: "dpdp.patient_erasure",
    entityType: "patient",
    entityId: patientId,
    metadata: {
      retention_policy: retentionPolicy,
      erased_at: erasedAt,
      status: "erased",
      reason: "dpdp_section_12_erasure",
    },
  });

  return {
    success: true,
    message: "Patient record erased and archived under NMC statutory retention policy.",
    patientId,
    erasedAt,
    retentionPolicy,
  };
}
