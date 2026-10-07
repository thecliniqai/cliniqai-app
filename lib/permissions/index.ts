import { UserRole } from "@/lib/db/types";
import { Permission, ROLE_PERMISSIONS } from "./matrix";

export * from "./matrix";

export class PermissionDeniedError extends Error {
  constructor(message = "You do not have permission to perform this action.") {
    super(message);
    this.name = "PermissionDeniedError";
  }
}

/**
 * Checks whether a given role has a specific permission.
 * Wildcard ('*') grants all permissions.
 * Otherwise, exact match is required.
 */
export function hasPerm(role: UserRole, perm: Permission): boolean {
  const perms = ROLE_PERMISSIONS[role];
  if (!perms) return false;
  if (perms.includes("*")) return true;
  return perms.includes(perm);
}

/**
 * Asserts that a role has a permission, throwing PermissionDeniedError if not.
 */
export function assertPerm(role: UserRole, perm: Permission): void {
  if (!hasPerm(role, perm)) {
    throw new PermissionDeniedError();
  }
}
