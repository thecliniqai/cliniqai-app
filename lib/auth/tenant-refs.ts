import "server-only";

import type { ServiceContext } from "@/lib/auth/context";

/**
 * Cross-tenant reference checks (P0-13 finding, V2-02 02-02).
 *
 * The foreign keys on `patient_id`, `visit_id` and the user columns reference the id alone, and the RLS insert
 * policies check only the row's own `tenant_id`. So a service that copies a caller-supplied id into a new row can write
 * a tenant-A row that points at tenant B's patient, visit or user (found by tests/security/guard-actions.spec.ts:
 * createVisit, addToWaitlist and the consent writes did). Every service that stores a caller-supplied reference
 * checks it here first, against `ctx.tenantId`, on the caller's own client (RLS applies on top).
 *
 * Each check answers false for a missing id, an id in another tenant and a lookup error alike, so a caller cannot tell
 * them apart.
 */

/** Fixed, id-free message for a reference that is not in the caller's clinic. */
export const FOREIGN_REFERENCE_MESSAGE = "Not found in this clinic.";

/**
 * True when `patientId` is an active patient of the caller's clinic. A soft-deleted or erased (DPDP) patient is
 * refused like a foreign one: no new visit, waitlist entry or consent may point at them (AR-L6).
 */
export async function patientInTenant(ctx: ServiceContext, patientId: string): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (ctx.db.from("patients") as any)
    .select("id")
    .eq("id", patientId)
    .eq("tenant_id", ctx.tenantId)
    .eq("is_deleted", false)
    .is("erased_at", null)
    .maybeSingle();
  return !error && !!data;
}

/** True when `visitId` is a visit of the caller's clinic and, if `patientId` is given, belongs to that patient. */
export async function visitInTenant(ctx: ServiceContext, visitId: string, patientId?: string): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (ctx.db.from("visits") as any)
    .select("id, patient_id")
    .eq("id", visitId)
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();
  if (error || !data) return false;
  return patientId === undefined || (data as { patient_id: string }).patient_id === patientId;
}

/** True when `userId` holds a membership in the caller's clinic (a doctor or staff reference). */
export async function memberOfTenant(ctx: ServiceContext, userId: string): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (ctx.db.from("memberships") as any)
    .select("user_id")
    .eq("tenant_id", ctx.tenantId)
    .eq("user_id", userId)
    .maybeSingle();
  return !error && !!data;
}
