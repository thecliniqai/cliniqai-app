import { ACTIVE_TENANT_COOKIE, createClient } from "@/lib/supabase/server";
import { UserRole } from "@/lib/db/types";
import { DEFAULT_APP_ERROR_MESSAGES } from "@/lib/errors/app-error";
import { errorTag, log } from "@/lib/log";
import { getRequestId } from "@/lib/log/request-id";
import { isDefinitiveAuthRejection } from "@/lib/auth/auth-failure";

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

/**
 * V2-06 06-09c (H-AUTHOUT): Supabase Auth could not say whether the session is valid: a network failure, a timeout,
 * a 5xx, a 429 or an answer it could not read. This is NOT a missing session: `/api/session-status` answers it 503
 * (never 401, so no device signs itself out during an Auth incident), page loaders show the error boundary (Retry)
 * instead of sending the user to sign-in, and server actions answer their generic failure (never `UNAUTHENTICATED`,
 * which signs the client out). The message never matches "Unauthenticated".
 */
export class AuthUnavailableError extends Error {
  constructor() {
    super("Authentication is temporarily unavailable");
    this.name = "AuthUnavailableError";
  }
}

/**
 * Whether an error from `auth.getUser()` is a definitive "no valid session" (401) rather than a failure to check.
 * 06-09d (L-R1): classified by GoTrue's error codes, never by an HTTP 4xx alone (`lib/auth/auth-failure.ts`).
 */
export { isDefinitiveAuthRejection };

/**
 * V2-06 06-09c (M-REMOVED, adversarial B M-1): the active-clinic cookie names a clinic that is not one of the user's
 * active memberships (removed or suspended there, or never a member). This is the removal of the active clinic,
 * whatever the number of clinics left: never a silent switch to another clinic. `/api/session-status` answers 403
 * (`hardSignOut("removed")`: conceal, purge, sign-in); the dashboard layout signs the device out on a full load. The
 * message is the one callers already match.
 */
export class ActiveClinicMembershipEndedError extends Error {
  constructor() {
    super("Unauthorized: user is not a member of the requested tenant");
    this.name = "ActiveClinicMembershipEndedError";
  }
}

const TENANT_ID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

/** The active-clinic cookie as sent, or null (absent, or outside a request scope). */
export async function readActiveClinicCookie(): Promise<string | null> {
  try {
    return (await cookies()).get(ACTIVE_TENANT_COOKIE)?.value ?? null;
  } catch {
    // In tests or outside Next.js request context
    return null;
  }
}

/** Whether `value` is a clinic id (UUID shape), as the active-clinic cookie must hold. */
export function isClinicId(value: string | null | undefined): value is string {
  return typeof value === "string" && TENANT_ID_SHAPE.test(value);
}

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

  // 06-09c (H-AUTHOUT): only a definitive answer is "unauthenticated"; a failure to check is retryable.
  if (authError && !isDefinitiveAuthRejection(authError)) {
    log.warn({ event: "auth.get_user.unavailable", code: errorTag(authError), requestId: await getRequestId() });
    throw new AuthUnavailableError();
  }
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

  // The clinic the user picked (multi-clinic switcher), or the one this device was pinned to (06-09d): an explicit id,
  // else the active-clinic cookie. A value that is not a UUID is ignored (as `activeTenantHeaders` ignores it).
  let targetTenantId = explicitTenantId;
  if (!targetTenantId) targetTenantId = (await readActiveClinicCookie()) ?? undefined;
  if (targetTenantId && !TENANT_ID_SHAPE.test(targetTenantId)) targetTenantId = undefined;

  if (!memberships || memberships.length === 0) {
    // 06-09d (L-R4): this device had a clinic (pinned or picked) and the user is no longer a member of any clinic:
    // that is a removal (sign-out and purge), not a new account without a clinic (`/clinic/new`).
    if (targetTenantId) throw new ActiveClinicMembershipEndedError();
    throw new NoClinicMembershipError();
  }

  if (targetTenantId) {
    // 06-09c (M-REMOVED): a picked clinic that is no longer an active membership is a removal, however many clinics
    // remain; never fall back to the remaining one (stale screen of the old clinic, wrong-clinic writes).
    const match = memberships.find((m) => m.tenant_id.toLowerCase() === targetTenantId!.toLowerCase());
    if (!match) {
      throw new ActiveClinicMembershipEndedError();
    }
    return { tenantId: match.tenant_id, role: match.role, userId: user.id };
  }

  if (memberships.length === 1) {
    return {
      tenantId: memberships[0].tenant_id,
      role: memberships[0].role,
      userId: user.id,
    };
  }

  // Multiple memberships: require explicit tenant selection rather than guessing (Plan 02 / Plan 05)
  throw new MultipleClinicsSelectionRequiredError();
}
