import { UserRole } from "@/lib/db/types";
import { getActiveMembership } from "@/lib/auth/tenant";
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
  permission?: Permission
): Promise<GuardedSession> {
  const perm = permission || (_supabase as Permission);
  const membership = await getActiveMembership();
  assertPerm(membership.role, perm);

  return {
    tenantId: membership.tenantId,
    role: membership.role,
    userId: membership.userId,
  };
}
