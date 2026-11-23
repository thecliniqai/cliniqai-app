import { createHash } from "node:crypto";
import { cookies, headers } from "next/headers";
import { ACTIVE_TENANT_COOKIE, createClient } from "@/lib/supabase/server";
import { UserRole } from "@/lib/db/types";
import { DEFAULT_APP_ERROR_MESSAGES } from "@/lib/errors/app-error";
import { errorTag, log } from "@/lib/log";
import { getRequestId } from "@/lib/log/request-id";
import { isDefinitiveAuthRejection } from "@/lib/auth/auth-failure";
import { isSupabaseAuthCookie } from "@/lib/auth/session-age";
import { forgetRequestMemo, requestMemo } from "@/lib/auth/request-memo";
import {
  CONTEXT_COOKIE_NAMES,
  contextCookieName,
  contextCookieOptions,
  expiredContextCookie,
  normalisePin,
  signContext,
  verifyContext,
  type SessionContext,
} from "@/lib/auth/context-cookie";
import { cookieSecureFor } from "@/lib/auth/cookie-secure";
import { sessionLiveness } from "@/lib/auth/session-live";
import type { SensitiveAction } from "@/lib/auth/sensitive-actions";
import { serverEnv } from "@/lib/env-server";

export class NoClinicMembershipError extends Error {
  constructor(message = "Your account is not linked to a clinic yet") {
    super(message);
    this.name = "NoClinicMembershipError";
  }
}

/**
 * No signed-in user: the session is missing or its token does not verify; with a fresh check (`/api/session-status`) also a
 * session revoked elsewhere (sign-out, password reset or change) while its access token is still valid, which the local
 * JWT check admits and GoTrue then refuses. The message stays "Unauthenticated" (callers match it). Page loaders turn it into a redirect to sign-in (`lib/auth/page.ts`, V2-05
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
  options: { fresh?: boolean } = {},
): Promise<TenantAccessLevel> {
  const level = await getTenantAccessLevel(membership.tenantId, options);
  if (!accessAllows(level, required)) throw new TenantLockedError(level);
  return level;
}

/**
 * The active clinic's access level (V2-09d: from the session-context cookie when it is valid for this session and names
 * this clinic, else through `my_tenant_access`, the caller's own clinic only, once per request); fail closed.
 * `fresh: true` always asks the database, never the cookie (`/api/session-status`, the access pages, the sensitive
 * actions of `lib/auth/sensitive-actions.ts`). 09D-01a (A-3): reading the level never sets a cookie; only
 * `/api/session-status` issues the session-context cookie ({@link contextCookieFor}).
 */
export async function getTenantAccessLevel(tenantId: string, options: { fresh?: boolean } = {}): Promise<TenantAccessLevel> {
  if (!options.fresh) {
    const context = await contextFromCookie();
    if (context && context.tenantId === tenantId.toLowerCase()) return context.level;
  }
  return requestMemo(`level:${tenantId.toLowerCase()}`, () => readTenantAccessLevel(tenantId));
}

async function readTenantAccessLevel(tenantId: string): Promise<TenantAccessLevel> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_tenant_access", { p_tenant: tenantId });
  if (error) {
    log.error({ event: "auth.access_level_lookup.failed", code: errorTag(error), requestId: await getRequestId() });
    throw new Error("Failed to resolve clinic access.");
  }
  return (ACCESS_LEVELS as readonly string[]).includes(data as string) ? (data as TenantAccessLevel) : "none";
}

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
 * V2-09d: what the verified session says about the caller. Read once per request from the access token's claims
 * (`auth.getClaims()`: verified locally against the project's signing keys, JWKS cached for 10 minutes; no Auth round
 * trip while the token is valid; the proxy has already refreshed it). `getUser()` is kept only where a fresh answer from
 * Supabase Auth is required ({@link getActiveMembership} with `fresh`, i.e. `/api/session-status`, which detects a session
 * revoked elsewhere). The sensitive actions ask the database instead ({@link assertSessionLive}).
 */
export interface SessionClaims {
  userId: string;
  /** The JWT `session_id` (binds the session-context cookie to this session); null if the token has none. */
  sessionId: string | null;
  email: string | null;
  phone: string | null;
  userMetadata: Record<string, unknown>;
}

/** A short fingerprint of this request's Supabase auth cookies, so a memoised session never outlives a session change. */
async function sessionFingerprint(): Promise<string> {
  try {
    const auth = (await cookies())
      .getAll()
      .filter((c) => isSupabaseAuthCookie(c.name))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => `${c.name}=${c.value}`)
      .join(";");
    return createHash("sha256").update(auth).digest("base64url").slice(0, 22);
  } catch {
    return "none";
  }
}

/**
 * The verified session of this request (memoised per request). Throws {@link UnauthenticatedError} when there is no valid
 * session (no cookie, an expired or unverifiable token) and {@link AuthUnavailableError} when Supabase Auth could not
 * answer a call the check needed (a refresh, the JWKS fetch).
 */
export async function getSessionClaims(): Promise<SessionClaims> {
  return requestMemo(`claims:${await sessionFingerprint()}`, readSessionClaims);
}

async function readSessionClaims(): Promise<SessionClaims> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  // 06-09c (H-AUTHOUT): only a definitive answer is "unauthenticated"; a failure to check is retryable.
  if (error && !isDefinitiveAuthRejection(error)) {
    log.warn({ event: "auth.get_claims.unavailable", code: errorTag(error), requestId: await getRequestId() });
    throw new AuthUnavailableError();
  }
  const claims = data?.claims as Record<string, unknown> | undefined;
  if (error || !claims || typeof claims.sub !== "string" || claims.sub === "") throw new UnauthenticatedError();
  const text = (value: unknown) => (typeof value === "string" && value !== "" ? value : null);
  const metadata = claims.user_metadata;
  return {
    userId: claims.sub,
    sessionId: text(claims.session_id),
    email: text(claims.email),
    phone: text(claims.phone),
    userMetadata: typeof metadata === "object" && metadata !== null ? (metadata as Record<string, unknown>) : {},
  };
}

/** `getUser()`: Supabase Auth confirms the session is still live (not revoked elsewhere). Once per request. */
async function confirmSessionAtAuth(claims: SessionClaims): Promise<void> {
  await requestMemo(`auth-user:${await sessionFingerprint()}`, async () => {
    const supabase = await createClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();
    if (error && !isDefinitiveAuthRejection(error)) {
      log.warn({ event: "auth.get_user.unavailable", code: errorTag(error), requestId: await getRequestId() });
      throw new AuthUnavailableError();
    }
    if (error || !user || user.id !== claims.userId) throw new UnauthenticatedError();
  });
}

/**
 * 09D-01a (ruling R-S, AUTH_REDESIGN §3.5 step 3): the sensitive actions' liveness check (`session_is_live()`, one RPC,
 * once per request and session). Throws {@link UnauthenticatedError} for a session revoked elsewhere whose access token is
 * still unexpired, and {@link AuthUnavailableError} when the database could not answer (never a sign-out).
 */
export async function assertSessionLive(action: SensitiveAction): Promise<void> {
  const verdict = await requestMemo(`session-live:${await sessionFingerprint()}`, async () =>
    sessionLiveness(await createClient(), action),
  );
  if (verdict === "unavailable") throw new AuthUnavailableError();
  if (verdict !== "live") throw new UnauthenticatedError();
}

/** One active membership of the caller, with its clinic's name and zone (RLS: own rows; the caller's clinics). */
export interface ActiveMembershipRow {
  tenantId: string;
  role: UserRole;
  clinicName: string | null;
  timeZone: string | null;
}

type MembershipQueryRow = {
  tenant_id: string;
  role: UserRole;
  tenants: { name: string | null; timezone: string | null } | { name: string | null; timezone: string | null }[] | null;
};

/**
 * The caller's active memberships (V2-05 05-05, AUTH-05: a removed or suspended membership is not a clinic of the user;
 * RLS hides it as well), with each clinic's name and zone, in one query per request: the membership resolution, the
 * clinic switcher and the shell's clinic name and zone share it. Throws on a database error.
 */
export async function listActiveMemberships(userId: string): Promise<ActiveMembershipRow[]> {
  return requestMemo(`memberships:${userId}`, async () => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("memberships")
      .select("tenant_id, role, tenants(name, timezone)")
      .eq("user_id", userId)
      .eq("status", "active")
      .returns<MembershipQueryRow[]>();
    if (error) {
      // Database text never leaves the server (IR-L1); only the error code is logged.
      log.error({ event: "auth.membership_lookup.failed", code: errorTag(error), requestId: await getRequestId(), userId });
      throw new Error("Failed to resolve clinic membership.");
    }
    return (data ?? []).map((m) => {
      const t = Array.isArray(m.tenants) ? m.tenants[0] : m.tenants;
      return { tenantId: m.tenant_id, role: m.role, clinicName: t?.name ?? null, timeZone: t?.timezone ?? null };
    });
  });
}

/** The session-context cookie key, or null (unset or an environment the schema refuses: no cookie, never an error). */
function contextSecret(): string | null {
  try {
    return serverEnv().SESSION_CONTEXT_SECRET ?? null;
  } catch {
    return null;
  }
}

/**
 * V2-09d: the session-context cookie of this request when it is valid for this session (signature, expiry, user and
 * session id of the verified claims, the active-clinic pin; `lib/auth/context-cookie.ts`), else null.
 */
async function contextFromCookie(): Promise<SessionContext | null> {
  const secret = contextSecret();
  if (!secret) return null;
  let raw: string | undefined;
  try {
    // 09D-01a (S-5): only the name this request's cookie would carry (`__Host-` when Secure), never the other one.
    raw = (await cookies()).get(contextCookieName(cookieSecureFor(await headers())))?.value;
  } catch {
    return null;
  }
  if (!raw) return null;
  let claims: SessionClaims;
  try {
    claims = await getSessionClaims();
  } catch {
    return null;
  }
  const verdict = verifyContext(raw, secret, { userId: claims.userId, sessionId: claims.sessionId, pin: await readActiveClinicCookie() });
  return verdict.ok ? verdict.context : null;
}

/**
 * The session-context cookie for a context this request resolved fresh from Supabase Auth and the database. 09D-01a (A-3):
 * `/api/session-status` is the only issuer (on load, resume, `online` and every 5 min), on its own `no-store` response,
 * with the pin that response leaves in place. A Server Action never sets it: any `cookies().set` there makes Next treat
 * the action as a revalidation (a full re-render of the route). Null when the cookie is off or the session has no id.
 */
export async function contextCookieFor(
  membership: ActiveMembership,
  level: TenantAccessLevel,
  pin: string | null,
): Promise<{ name: string; value: string; options: ReturnType<typeof contextCookieOptions> } | null> {
  const secret = contextSecret();
  if (!secret) return null;
  const claims = await getSessionClaims();
  if (!claims.sessionId || claims.userId !== membership.userId) return null;
  const value = signContext(
    { userId: membership.userId, sessionId: claims.sessionId, tenantId: membership.tenantId, role: membership.role, level, pin: normalisePin(pin) },
    secret,
  );
  const secure = cookieSecureFor(await headers());
  return { name: contextCookieName(secure), value, options: contextCookieOptions(secure) };
}

/**
 * V2-09d: forgets this device's clinic context after an action that changed it (clinic switch, clinic creation, an
 * invitation accepted, a membership or role change by the caller, a subscription change in the app): the cookie is
 * expired and this request's memoised lookups are dropped, so the render that follows and the next request read the
 * database again (and the next status poll reissues the cookie).
 */
export async function forgetSessionContext(): Promise<void> {
  await forgetRequestMemo();
  try {
    const store = await cookies();
    for (const name of CONTEXT_COOKIE_NAMES) {
      if (!store.has(name)) continue;
      const expired = expiredContextCookie(name);
      store.set(expired.name, expired.value, expired.options);
    }
  } catch {
    // Read-only cookies or no request scope: nothing to expire here.
  }
}

/**
 * Derives the active tenant membership strictly on the server from session and database.
 * Never trust browser-supplied tenant IDs (AGENTS.md §7).
 *
 * V2-09d: the session comes from the verified JWT claims (no Auth round trip); the membership from the session-context
 * cookie when it is valid for this session and pin (at most 300 s old; RLS and the commands re-check membership in the
 * database on every read and write), else from the database, once per request.
 * `fresh: true` (`/api/session-status`) asks Supabase Auth (`getUser()`) and the database every time.
 * `fromDatabase: true` (09D-01a, the sensitive actions) skips the cookie and reads the membership and role from the
 * database (the request memo holds only database answers); liveness is the caller's {@link assertSessionLive}.
 */
export async function getActiveMembership(
  explicitTenantId?: string,
  options: { fresh?: boolean; fromDatabase?: boolean } = {},
): Promise<ActiveMembership> {
  const claims = await getSessionClaims();
  if (options.fresh) await confirmSessionAtAuth(claims);

  // The clinic the user picked (multi-clinic switcher), or the one this device was pinned to (06-09d): an explicit id,
  // else the active-clinic cookie. A value that is not a UUID is ignored (as `activeTenantHeaders` ignores it).
  const pin = await readActiveClinicCookie();
  let targetTenantId = explicitTenantId;
  if (!targetTenantId) targetTenantId = pin ?? undefined;
  if (targetTenantId && !TENANT_ID_SHAPE.test(targetTenantId)) targetTenantId = undefined;

  if (!options.fresh && !options.fromDatabase) {
    const context = await contextFromCookie();
    if (context && (!targetTenantId || context.tenantId === targetTenantId.toLowerCase())) {
      return { tenantId: context.tenantId, role: context.role, userId: claims.userId };
    }
  }

  const memberships = await listActiveMemberships(claims.userId);
  return selectMembership(memberships, targetTenantId, claims.userId);
}

function selectMembership(memberships: ActiveMembershipRow[], targetTenantId: string | undefined, userId: string): ActiveMembership {
  if (memberships.length === 0) {
    // 06-09d (L-R4): this device had a clinic (pinned or picked) and the user is no longer a member of any clinic:
    // that is a removal (sign-out and purge), not a new account without a clinic (`/clinic/new`).
    if (targetTenantId) throw new ActiveClinicMembershipEndedError();
    throw new NoClinicMembershipError();
  }

  if (targetTenantId) {
    // 06-09c (M-REMOVED): a picked clinic that is no longer an active membership is a removal, however many clinics
    // remain; never fall back to the remaining one (stale screen of the old clinic, wrong-clinic writes).
    const match = memberships.find((m) => m.tenantId.toLowerCase() === targetTenantId.toLowerCase());
    if (!match) {
      throw new ActiveClinicMembershipEndedError();
    }
    return { tenantId: match.tenantId, role: match.role, userId };
  }

  if (memberships.length === 1) {
    return { tenantId: memberships[0].tenantId, role: memberships[0].role, userId };
  }

  // Multiple memberships: require explicit tenant selection rather than guessing (Plan 02 / Plan 05)
  throw new MultipleClinicsSelectionRequiredError();
}
