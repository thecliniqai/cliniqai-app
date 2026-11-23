import "server-only";

import { createClient, ACTIVE_TENANT_COOKIE_MAX_AGE_SECONDS } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/db/types";
import { getSessionClaims, isClinicId, listActiveMemberships } from "@/lib/auth/tenant";
import { errorTag, log } from "@/lib/log";
import { getRequestId } from "@/lib/log/request-id";

/**
 * The clinic switcher's server side (V2-08 08-05, P1-12, R-17; the cookie contract is V2-06 06-09d's). A user with two or more
 * active memberships picks the clinic to work in; the pick is the HttpOnly `clinic_active_tenant` cookie that
 * `getActiveMembership` and the `x-clinicos-tenant` header read. The cookie is never trusted: the database re-checks the
 * membership on every read and write (M-REMOVED; the app's own context at least every 5 minutes, V2-09d), and this module writes it only for a clinic the caller holds an active membership of, read under the
 * caller's own RLS, so a forged or foreign id writes nothing.
 */
export interface UserClinic {
  id: string;
  name: string;
  role: UserRole;
  /** The clinic's `tenants.timezone` as stored (the shell resolves it; V2-09d). */
  timeZone: string | null;
}

/** The fixed texts of the switcher (never database text, 03-13d M-ERRMSG). */
export const CLINIC_SWITCH_MESSAGES = {
  REFUSED: "You can't switch to that clinic.",
  NOT_SIGNED_IN: "You must be signed in to switch clinic.",
  UNAVAILABLE: "Couldn't switch clinic. Please try again.",
  ALREADY_MEMBER: "Your account already belongs to a clinic. Use the clinic switcher to change clinics.",
} as const;

/** Cookie attributes of the active-clinic pin: HttpOnly, SameSite=Lax, Path=/, 400 days; Secure on https and in production. */
export function activeClinicCookieOptions(secure: boolean) {
  return { httpOnly: true, sameSite: "lax" as const, path: "/", secure, maxAge: ACTIVE_TENANT_COOKIE_MAX_AGE_SECONDS };
}

/**
 * Whether the active-clinic cookie carries `Secure` (V2-08 08-06a, S-9): on an https request, and in production on any host
 * but loopback (`lib/auth/cookie-secure.ts`, shared with the session-context cookie since V2-09d).
 */
export { isHttpsRequest, cookieSecureFor as activeClinicCookieSecure } from "@/lib/auth/cookie-secure";

/**
 * The caller's own active memberships with the clinic names (RLS: own rows, `memberships_select`; `tenants_select` admits every
 * clinic the caller belongs to), and each clinic's zone (the shell's clock). V2-09d: the session from the verified claims and
 * the one membership read of the request (`listActiveMemberships`). A failed read answers an empty list: the switcher is then
 * simply not offered.
 */
export async function listUserClinics(): Promise<UserClinic[]> {
  let userId: string;
  try {
    userId = (await getSessionClaims()).userId;
  } catch {
    return [];
  }
  let rows;
  try {
    rows = await listActiveMemberships(userId);
  } catch (error) {
    log.warn({ event: "clinics.list.failed", code: errorTag(error), requestId: await getRequestId() });
    return [];
  }
  return rows
    .map((m) => ({ id: m.tenantId, name: m.clinicName?.trim() || "Clinic", role: m.role, timeZone: m.timeZone }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export type ClinicSwitchTarget = { ok: true; tenantId: string } | { ok: false; reason: "refused" | "unavailable" | "unauthenticated" };

/**
 * Whether the signed-in caller may switch to `requested`: an active membership of that clinic, read under RLS. Anything else
 * (not a clinic id, not signed in, a clinic the caller is not in or was removed from) is refused and writes nothing; "unauthenticated"
 * is the one refusal that says why (there is no session to protect from the answer).
 */
export async function resolveClinicSwitch(requested: unknown): Promise<ClinicSwitchTarget> {
  if (typeof requested !== "string" || !isClinicId(requested)) return { ok: false, reason: "refused" };
  let userId: string;
  try {
    userId = (await getSessionClaims()).userId;
  } catch {
    return { ok: false, reason: "unauthenticated" };
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("memberships")
    .select("tenant_id")
    .eq("user_id", userId)
    .eq("status", "active")
    .eq("tenant_id", requested.toLowerCase())
    .maybeSingle<{ tenant_id: string }>();
  if (error) {
    log.warn({ event: "clinics.switch.lookup_failed", code: errorTag(error), requestId: await getRequestId() });
    return { ok: false, reason: "unavailable" };
  }
  return data ? { ok: true, tenantId: data.tenant_id } : { ok: false, reason: "refused" };
}

/** Whether the signed-in caller already has an active membership (a user with a clinic does not create another, R-17). */
export async function hasActiveMembership(): Promise<boolean> {
  let userId: string;
  try {
    userId = (await getSessionClaims()).userId;
  } catch {
    return false;
  }
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("memberships")
    .select("tenant_id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "active");
  return !error && (count ?? 0) > 0;
}
