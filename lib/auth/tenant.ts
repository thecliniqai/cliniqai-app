import { createClient } from "@/lib/supabase/server";
import { UserRole } from "@/lib/db/types";
import { DEFAULT_APP_ERROR_MESSAGES } from "@/lib/errors/app-error";
import { errorTag, log } from "@/lib/log";
import { getRequestId } from "@/lib/log/request-id";

export class NoClinicMembershipError extends Error {
  constructor(message = "Your account is not linked to a clinic yet") {
    super(message);
    this.name = "NoClinicMembershipError";
  }
}

/**
 * No signed-in user: the session is missing, or it was revoked elsewhere (sign-out, password reset or change) while its
 * access token is still valid, which `proxy.ts` (local JWT check) admits and GoTrue then refuses. The message stays
 * "Unauthenticated" (callers match it). Page loaders turn it into a redirect to sign-in (`lib/auth/page.ts`, V2-05
 * 05-11c), never a server error.
 */
export class UnauthenticatedError extends Error {
  constructor() {
    super("Unauthenticated");
    this.name = "UnauthenticatedError";
  }
}

export class MultipleClinicsSelectionRequiredError extends Error {
  constructor(message = "Multiple clinics found. Please select an active clinic.") {
    super(message);
    this.name = "MultipleClinicsSelectionRequiredError";
  }
}

/**
 * V2-05 05-10a (SUB-02, SUB §6.2): the active clinic's access level, as `my_tenant_access` reports it
 * (`billing_internal.tenant_access_level` at `now()`): `full` (trialing, active, past_due in grace, comp), `locked`
 * (expired, archived, or a status past `access_ends_at`), `onboarding` (incomplete, not comped), `none` (purged).
 * Anything unreadable is treated as `none` (fail closed).
 */
export type TenantAccessLevel = "full" | "locked" | "onboarding" | "none";
const ACCESS_LEVELS: readonly TenantAccessLevel[] = ["full", "locked", "onboarding", "none"];

export interface ActiveMembership {
  tenantId: string;
  role: UserRole;
  userId: string;
}

/**
 * The active clinic is not `full` (SUB-02): the typed refusal of `assertTenantAccess`. Server actions answer it with
 * the fixed `SUBSCRIPTION_LOCKED` text (`clientErrorMessage`, `resolveServiceContext`); the PWA client reacts to it
 * (V2-06 D-8). Carries no tenant data.
 */
export class TenantLockedError extends Error {
  readonly code = "SUBSCRIPTION_LOCKED" as const;
  readonly accessLevel: TenantAccessLevel;
  constructor(accessLevel: TenantAccessLevel) {
    super(DEFAULT_APP_ERROR_MESSAGES.SUBSCRIPTION_LOCKED);
    this.name = "TenantLockedError";
    this.accessLevel = accessLevel;
  }
}

/** What a path needs: `full` (every clinical and operational path), or `billing` (full, locked or onboarding). */
export type RequiredAccess = "full" | "billing";

/** Whether a level gives the access a path needs. */
export function accessAllows(level: TenantAccessLevel, required: RequiredAccess): boolean {
  return required === "full" ? level === "full" : level === "full" || level === "locked" || level === "onboarding";
}

/**
 * Throws {@link TenantLockedError} unless the membership's clinic has the access the path needs (SUB §7.2). Called by
 * the guards AFTER the membership and the role check, so a refused role never reaches this lookup (the guard suite's
 * "no data access before the refusal"). The database enforces the same stop (RLS, storage, definer RPCs; 000090).
 */
export async function assertTenantAccess(
  membership: Pick<ActiveMembership, "tenantId">,
  required: RequiredAccess = "full",
): Promise<TenantAccessLevel> {
  const level = await getTenantAccessLevel(membership.tenantId);
  if (!accessAllows(level, required)) throw new TenantLockedError(level);
  return level;
}

/** The active clinic's access level through `my_tenant_access` (the caller's own clinic only); fail closed. */
export async function getTenantAccessLevel(tenantId: string): Promise<TenantAccessLevel> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_tenant_access", { p_tenant: tenantId });
  if (error) {
    log.error({ event: "auth.access_level_lookup.failed", code: errorTag(error), requestId: await getRequestId() });
    throw new Error("Failed to resolve clinic access.");
  }
  return (ACCESS_LEVELS as readonly string[]).includes(data as string) ? (data as TenantAccessLevel) : "none";
}

import { cookies } from "next/headers";

/**
 * Derives the active tenant membership strictly on the server from session and database.
 * Never trust browser-supplied tenant IDs (AGENTS.md §7).
 */
export async function getActiveMembership(explicitTenantId?: string): Promise<ActiveMembership> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    throw new UnauthenticatedError();
  }

  const { data: memberships, error: memError } = await supabase
    .from("memberships")
    .select("tenant_id, role")
    .eq("user_id", user.id)
    // V2-05 05-05 (AUTH-05): a removed or suspended membership is not a clinic of the user (RLS hides it as well).
    .eq("status", "active")
    .returns<Array<{ tenant_id: string; role: UserRole }>>();

  if (memError) {
    // Database text never leaves the server (IR-L1); only the error code is logged.
    log.error({ event: "auth.membership_lookup.failed", code: errorTag(memError), requestId: await getRequestId(), userId: user.id });
    throw new Error("Failed to resolve clinic membership.");
  }

  if (!memberships || memberships.length === 0) {
    throw new NoClinicMembershipError();
  }

  if (memberships.length === 1) {
    return {
      tenantId: memberships[0].tenant_id,
      role: memberships[0].role,
      userId: user.id,
    };
  }

  // Multiple memberships: require explicit tenant selection rather than guessing (Plan 02 / Plan 05)
  let targetTenantId = explicitTenantId;
  if (!targetTenantId) {
    try {
      const cookieStore = await cookies();
      targetTenantId = cookieStore.get("clinic_active_tenant")?.value;
    } catch {
      // In tests or outside Next.js request context
    }
  }

  if (!targetTenantId) {
    throw new MultipleClinicsSelectionRequiredError();
  }

  const match = memberships.find((m) => m.tenant_id === targetTenantId);
  if (!match) {
    throw new Error("Unauthorized: user is not a member of the requested tenant");
  }

  return {
    tenantId: match.tenant_id,
    role: match.role,
    userId: user.id,
  };
}

