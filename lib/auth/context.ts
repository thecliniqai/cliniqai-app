import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, UserRole } from "@/lib/db/types";
import { createClient } from "@/lib/supabase/server";
import {
  ActiveClinicMembershipEndedError,
  assertTenantAccess,
  getActiveMembership,
  MultipleClinicsSelectionRequiredError,
  NoClinicMembershipError,
  TenantLockedError,
  type RequiredAccess,
} from "@/lib/auth/tenant";
import { assertPerm, PermissionDeniedError, type Permission } from "@/lib/permissions";
import { errorTag, log } from "@/lib/log";
import { getRequestId } from "@/lib/log/request-id";

/** Fixed answer for a context failure that is not one of the known, safe-to-show cases (IR-L1). */
export const CONTEXT_FAILURE_MESSAGE = "We could not verify your clinic access. Please try again.";

/**
 * The explicit context every domain service receives (ADR-0005 Decision 1, R12).
 *
 * The acting tenant, user and role are derived from the authenticated session by `requireServiceContext()`
 * (server actions, RSC pages, route handlers) — never from caller input. `db` is the user-JWT client, so RLS
 * applies to every query a service makes. Only the `/api/v1` register routes (ADR-0005 Phasing) build a
 * context with `actorType: "api_key"`.
 */
export interface ServiceContext {
  userId: string;
  tenantId: string;
  role: UserRole;
  actorType: "user" | "api_key";
  apiKeyId?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<Database, any, any>;
}

/**
 * Resolves the caller's active membership from the session, checks `permission` (if given) and returns a context
 * bound to the user-JWT client. Throws "Unauthenticated", a membership error, or `PermissionDeniedError`.
 */
export async function requireServiceContext(permission?: Permission, access: RequiredAccess = "full"): Promise<ServiceContext> {
  const membership = await getActiveMembership();
  if (permission) {
    assertPerm(membership.role, permission);
  }
  // V2-05 05-10a (SUB-02): a locked or onboarding clinic reaches only the billing paths (`access: "billing"`).
  await assertTenantAccess(membership, access);
  const db = await createClient();
  return {
    userId: membership.userId,
    tenantId: membership.tenantId,
    role: membership.role,
    actorType: "user",
    db,
  };
}

export type ServiceContextResult =
  | { ok: true; ctx: ServiceContext }
  | { ok: false; error: string; reason: "unauthenticated" | "forbidden" | "no_membership" | "locked" };

/**
 * Non-throwing variant for server actions: they authenticate before parsing any input and map a failure to their
 * existing return shape. The message is safe to show to the caller (no ids, no PHI).
 */
export async function resolveServiceContext(permission?: Permission, access: RequiredAccess = "full"): Promise<ServiceContextResult> {
  try {
    return { ok: true, ctx: await requireServiceContext(permission, access) };
  } catch (err) {
    if (err instanceof PermissionDeniedError) {
      return { ok: false, error: err.message, reason: "forbidden" };
    }
    // SUB-02 (05-10a): the fixed SUBSCRIPTION_LOCKED text.
    if (err instanceof TenantLockedError) {
      return { ok: false, error: err.message, reason: "locked" };
    }
    const message = err instanceof Error ? err.message : "";
    if (message === "Unauthenticated") {
      return { ok: false, error: "Unauthenticated", reason: "unauthenticated" };
    }
    // Only the fixed messages of the known membership errors reach the caller (IR-L1); anything else (a database or
    // network failure) is logged by name and answered with a fixed string.
    // 06-09c (M-REMOVED): the active clinic is no longer one of the user's clinics (its fixed message, no log line:
    // the session-status poll signs the device out).
    if (
      err instanceof NoClinicMembershipError ||
      err instanceof MultipleClinicsSelectionRequiredError ||
      err instanceof ActiveClinicMembershipEndedError
    ) {
      return { ok: false, error: err.message, reason: "no_membership" };
    }
    log.error({ event: "auth.context_resolve.failed", code: errorTag(err), requestId: await getRequestId() });
    return { ok: false, error: CONTEXT_FAILURE_MESSAGE, reason: "no_membership" };
  }
}
