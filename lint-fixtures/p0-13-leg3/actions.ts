"use server";
// P0-13 leg 3 canary fixtures (V2-02 02-06, IR-F2/AR-M2a). DELIBERATELY DEFECTIVE. Never imported by the app; used
// only by tests/security/guard-canary.spec.ts, in place.
import { requireServiceContext } from "@/lib/auth/context";
import { patientInTenant } from "@/lib/auth/tenant-refs";

/**
 * Checks its FIRST reference (the patient) and stores the second (the visit) unchecked: the OA-4 / IR-F1 defect shape.
 * Forging every id at once is refused at the patient check, so only one-reference-at-a-time forging reaches the write.
 */
export async function linkCanaryFollowUp(input: { patient_id: string; visit_id: string }) {
  const ctx = await requireServiceContext("patients:edit");
  if (!(await patientInTenant(ctx, input.patient_id))) return { success: false, error: "Not found in this clinic." };
  const { error } = await ctx.db.from("follow_ups").insert({
    tenant_id: ctx.tenantId,
    patient_id: input.patient_id,
    visit_id: input.visit_id,
    doctor_id: ctx.userId,
    follow_up_date: new Date().toISOString().slice(0, 10),
  });
  return error ? { success: false, error: "Failed." } : { success: true };
}

/**
 * Rejects every input without a field the generic forger never fills, before reaching any reference: every forged
 * variant "passes" vacuously, which only the positive control exposes.
 */
export async function strictCanaryWrite(input: { patient_id: string; code?: string }) {
  await requireServiceContext("patients:edit");
  if (input.code !== "synthetic-code") return { success: false, error: "Validation failed." };
  return { success: true };
}
