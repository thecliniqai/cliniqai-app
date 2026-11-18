import "server-only";

import { redirect } from "next/navigation";
import {
  getActiveMembership,
  getTenantAccessLevel,
  NoClinicMembershipError,
  type ActiveMembership,
  type TenantAccessLevel,
} from "@/lib/auth/tenant";
import { accessRedirect, type AccessDestination } from "@/lib/auth/access-redirect";
import { redirectIfUnauthenticated } from "@/lib/auth/page";

export interface AccessDestinationContext {
  membership: ActiveMembership;
  level: TenantAccessLevel;
}

/**
 * V2-05 05-10b: the loader of the three access pages (`/billing/locked`, `/billing/locked/staff`,
 * `/onboarding/billing`). They live outside the `(dashboard)` layout, so they resolve the session themselves:
 *
 * - no session → `/login` (the proxy already sends a signed-out request there; this covers a revoked session);
 * - no clinic → `/clinic/new` (as the dashboard layout does);
 * - the member's destination for the clinic's access level is another page → that page; a `full` clinic → `/`.
 *
 * So each page renders only for the members it is meant for, and the rule cannot loop: every destination maps to
 * itself. The access level is read from the database (`my_tenant_access`, fail closed).
 */
export async function requireAccessDestination(path: AccessDestination): Promise<AccessDestinationContext> {
  let membership: ActiveMembership;
  try {
    membership = await getActiveMembership();
  } catch (err) {
    redirectIfUnauthenticated(err);
    if (err instanceof NoClinicMembershipError) redirect("/clinic/new");
    throw err;
  }
  const level = await getTenantAccessLevel(membership.tenantId);
  const destination = accessRedirect(membership.role, level);
  if (destination !== path) redirect(destination ?? "/");
  return { membership, level };
}
