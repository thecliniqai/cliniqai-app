import { UserRole } from "@/lib/db/types";
import { assertTenantAccess, getActiveMembership, type RequiredAccess } from "@/lib/auth/tenant";
import { Permission, assertPerm } from "./index";

export interface GuardedSession {
  tenantId: string;
  role: UserRole;
  userId: string;
}

/**
 * Server guard that resolves the caller's active tenant membership
 * and verifies that the role possesses the required permission.
 * Returns the tenantId, role, and userId so downstream code does not re-query.
 */
export async function requirePermission(
  _supabase?: unknown,
  permission?: Permission,
  /**
   * V2-05 05-10a (SUB-02): the access the path needs. Default `full`; `billing` only for the billing, subscription and
   * export paths a locked or onboarding owner must still reach (SUB §6.2).
   */
  access: RequiredAccess = "full"
): Promise<GuardedSession> {
  const perm = permission || (_supabase as Permission);
  const membership = await getActiveMembership();
  assertPerm(membership.role, perm);
  // SUB-02: after the membership and the role, the clinic's access level (TenantLockedError → SUBSCRIPTION_LOCKED).
  await assertTenantAccess(membership, access);

  return {
    tenantId: membership.tenantId,
    role: membership.role,
    userId: membership.userId,
  };
}
