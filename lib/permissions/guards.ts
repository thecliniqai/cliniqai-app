import { UserRole } from "@/lib/db/types";
import type { RequiredAccess } from "@/lib/auth/tenant";
import { resolveGuardedMembership } from "@/lib/auth/context";
import type { GuardOptions } from "@/lib/auth/sensitive-actions";
import { Permission } from "./index";

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
  access: RequiredAccess = "full",
  /** 09D-01a (ruling R-S): `{ sensitive }` names an action of the closed list (`lib/auth/sensitive-actions.ts`). */
  options: GuardOptions = {}
): Promise<GuardedSession> {
  const perm = permission || (_supabase as Permission);
  // The membership, the role, then (SUB-02) the clinic's access level (TenantLockedError → SUBSCRIPTION_LOCKED); a
  // sensitive action reads them from the database and also checks the session is live.
  const membership = await resolveGuardedMembership(perm, access, options);

  return {
    tenantId: membership.tenantId,
    role: membership.role,
    userId: membership.userId,
  };
}
