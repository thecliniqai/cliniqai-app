import type { UserRole } from "@/lib/db/types";
import type { TenantAccessLevel } from "@/lib/auth/tenant";

/**
 * V2-05 05-10b (SUB-02 UX, SUB §7.2 item 3): where a signed-in member goes when the active clinic is not `full`.
 *
 * This is the single role × access level → destination rule. The `(dashboard)` layout applies it on every full page
 * load, `withPageAuth` applies it when a page loader meets `TenantLockedError` (a client navigation, where the layout
 * does not re-render), and each destination page applies it to itself (a member on the wrong destination is sent to
 * the right one; a member of a `full` clinic is sent to `/`). V2-06 06-06's `/api/session-status` returns the same
 * value as `redirect` and the installed PWA hard-navigates to it (D-8, session kept).
 *
 * - `full` → `null` (no redirect).
 * - `onboarding` (status `incomplete`, not comped) → `/onboarding/billing`, every role (the AUTH track's resume rule).
 * - `locked` → `/billing/locked` for owner/admin (renewal and export live there), `/billing/locked/staff` for every
 *   other role.
 * - `none` (purged, or a level the app could not read) → treated as `locked` (fail closed).
 *
 * Pure and isomorphic (no server import): the destinations are plain paths, safe to send to the client.
 */
export const LOCKED_OWNER_PATH = "/billing/locked";
export const LOCKED_STAFF_PATH = "/billing/locked/staff";
export const ONBOARDING_BILLING_PATH = "/onboarding/billing";

/** Every destination of {@link accessRedirect}. None of them is under the `(dashboard)` layout (no redirect loop). */
export const ACCESS_DESTINATIONS = [LOCKED_OWNER_PATH, LOCKED_STAFF_PATH, ONBOARDING_BILLING_PATH] as const;
export type AccessDestination = (typeof ACCESS_DESTINATIONS)[number];

/** Roles that manage the clinic's subscription (the billing helper admits exactly these, `authz.billing_tenant_ids`). */
const BILLING_ROLES: ReadonlySet<UserRole> = new Set<UserRole>(["owner", "admin"]);

export function accessRedirect(role: UserRole, level: TenantAccessLevel): AccessDestination | null {
  if (level === "full") return null;
  if (level === "onboarding") return ONBOARDING_BILLING_PATH;
  return BILLING_ROLES.has(role) ? LOCKED_OWNER_PATH : LOCKED_STAFF_PATH;
}
