import { NextResponse, type NextRequest } from "next/server";
import {
  ActiveClinicMembershipEndedError,
  AuthUnavailableError,
  contextCookieFor,
  getActiveMembership,
  getTenantAccessLevel,
  isClinicId,
  MultipleClinicsSelectionRequiredError,
  NoClinicMembershipError,
  readActiveClinicCookie,
  UnauthenticatedError,
} from "@/lib/auth/tenant";
import { accessRedirect } from "@/lib/auth/access-redirect";
import { ACTIVE_TENANT_COOKIE, ACTIVE_TENANT_COOKIE_MAX_AGE_SECONDS } from "@/lib/supabase/server";
import { SHELL_CLINIC_HEADER } from "@/lib/pwa/session-status";
import { deploymentInfo } from "@/lib/env-server";
import { errorTag, log } from "@/lib/log";
import { getRequestId } from "@/lib/log/request-id";

/**
 * `GET /api/session-status` (V2-06 06-06; PWA_STRATEGY §3.7 step 2, §6.6; R-16, R-21). The installed app's version and
 * access poll: `PwaRuntime` calls it on load, on resume, on `online`, every 5 min while visible and after any client
 * error, and reacts (`lib/pwa/session-status.ts`).
 *
 * - V2-09d: the one fresh check of the shell. The session is confirmed with `auth.getUser()` and the membership and access
 *   level are read from the database (`fresh`), never from the session-context cookie; the 200 answer then (re)issues that
 *   cookie. Page loads, Server Actions and route handlers read the verified JWT claims and the cookie instead.
 * - The session is read with `auth.getUser()` (inside `getActiveMembership`), so a session revoked elsewhere fails
 *   here even while its access token is unexpired: 401 `{ error: "unauthenticated" }` → the client signs out
 *   (`hardSignOut("expired")`). Only a definitive answer is a 401 (no session, or GoTrue refused this session with a
 *   4xx other than 408/429). 06-09c (H-AUTHOUT): when Auth cannot answer (network failure, timeout, 5xx, 429, an
 *   unreadable answer: `AuthUnavailableError`) the answer is 503 `{ error: "unavailable" }`, never a sign-out.
 * - No active membership (never had one, removed, or the active-clinic cookie names a clinic that is not an active
 *   membership — 06-09c M-REMOVED: whatever the number of clinics left): 403 `{ error: "no_membership" }` →
 *   `hardSignOut("removed")`.
 * - Several clinics and none chosen: 409 `{ error: "clinic_selection_required" }` (not a sign-out; the client ignores it).
 * - 06-09d (M-REMOVED-R1): the device is pinned to the clinic it shows. With no active-clinic cookie, the answer that
 *   resolves a clinic sets `clinic_active_tenant` to it (HttpOnly, SameSite=Lax, path /), so a later removal from that
 *   clinic answers 403 on every device, never a silent switch to a clinic the user was added to meanwhile. The shell
 *   sends the clinic its layout resolved ({@link SHELL_CLINIC_HEADER}, read only while no cookie is set): it is
 *   resolved like the cookie (a clinic that is not an active membership answers 403), so it can only confirm the
 *   clinic on screen or end the session, never select a clinic the user does not belong to. The sign-out route
 *   expires the cookie.
 * - A lookup failure: 503 `{ error: "unavailable" }` (never a sign-out: the client ignores it and checks again later;
 *   the database stop, not this answer, is the access control).
 * - Otherwise 200 with exactly `deploymentId` (this build's, `deploymentInfo()`), `accessLevel` (05-10a's level of the
 *   session's active clinic) and `redirect` (`accessRedirect`, 05-10b: `null` for `full`).
 *
 * The tenant comes from the session (a `?tenant=` is ignored), narrowed only by the device's pinned clinic. `Cache-Control: private,
 * no-store` on every answer. No PHI: no ids, names or addresses. One `log.info` per non-200 with its code only.
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" } as const;

async function refuse(status: 401 | 403 | 409 | 503, error: string, code: string) {
  log.info({ event: "pwa.session_status.refused", status, code, requestId: await getRequestId() });
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

export async function GET(request?: NextRequest) {
  const pinned = isClinicId(await readActiveClinicCookie());
  const shellClinic = pinned ? null : (request?.headers.get(SHELL_CLINIC_HEADER) ?? null);
  let membership;
  try {
    membership = await getActiveMembership(isClinicId(shellClinic) ? shellClinic : undefined, { fresh: true });
  } catch (err) {
    if (err instanceof AuthUnavailableError) return refuse(503, "unavailable", "auth_unavailable");
    if (err instanceof UnauthenticatedError) return refuse(401, "unauthenticated", "unauthenticated");
    if (err instanceof ActiveClinicMembershipEndedError) return refuse(403, "no_membership", "not_member_of_active");
    if (err instanceof NoClinicMembershipError) return refuse(403, "no_membership", "no_membership");
    if (err instanceof MultipleClinicsSelectionRequiredError) {
      return refuse(409, "clinic_selection_required", "clinic_selection_required");
    }
    if (err instanceof Error && err.message.startsWith("Unauthorized: user is not a member")) {
      return refuse(403, "no_membership", "not_member_of_active");
    }
    return refuse(503, "unavailable", errorTag(err));
  }

  let accessLevel;
  try {
    accessLevel = await getTenantAccessLevel(membership.tenantId, { fresh: true });
  } catch (err) {
    return refuse(503, "unavailable", errorTag(err));
  }

  const response = NextResponse.json(
    {
      deploymentId: deploymentInfo().deploymentId,
      accessLevel,
      redirect: accessRedirect(membership.role, accessLevel),
    },
    { status: 200, headers: NO_STORE },
  );
  if (!pinned) {
    response.cookies.set(ACTIVE_TENANT_COOKIE, membership.tenantId, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: request?.nextUrl.protocol === "https:",
      maxAge: ACTIVE_TENANT_COOKIE_MAX_AGE_SECONDS,
    });
  }
  // V2-09d: the context this answer just confirmed with Supabase Auth and the database is the device's session-context
  // cookie for the next 5 minutes (bound to the pin this response leaves in place). The poll every 5 min renews it.
  try {
    const context = await contextCookieFor(membership, accessLevel, pinned ? await readActiveClinicCookie() : membership.tenantId);
    if (context) response.cookies.set(context.name, context.value, context.options);
  } catch (err) {
    log.warn({ event: "pwa.session_status.context_cookie_failed", code: errorTag(err), requestId: await getRequestId() });
  }
  return response;
}
