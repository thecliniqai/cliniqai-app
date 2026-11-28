import "server-only";

import { createElement, Fragment, type ReactNode } from "react";
import { redirect } from "next/navigation";
import {
  ActiveClinicMembershipEndedError,
  assertTenantAccess,
  AuthUnavailableError,
  getActiveMembership,
  TenantLockedError,
  UnauthenticatedError,
} from "@/lib/auth/tenant";
import { MembershipEnded } from "@/components/shell/membership-ended";
import { DataReady } from "@/components/shell/data-ready";
import { accessRedirect, LOCKED_STAFF_PATH } from "@/lib/auth/access-redirect";
import type { UserRole } from "@/lib/db/types";

/**
 * Dashboard page loaders and a session that is gone (V2-05 05-11c; root cause in the 05-02a record, "Open items").
 *
 * A request without a valid session reaching a page loader (the layout redirects to /login, but Next renders the page
 * concurrently) made its loader's `getActiveMembership()` throw "Unauthenticated", which `onRequestError` logged as
 * `request.error` and sent to the error sink, one false event per such page load. A page wrapped in {@link withPageAuth}
 * answers the same condition with the same redirect instead. V2-09d: the session is read from the verified JWT claims
 * (no Auth round trip), so a session revoked elsewhere whose token is unexpired is ended by the shell's
 * `/api/session-status` check (fresh, 401 → sign-out), not by the page.
 */
export function isUnauthenticated(err: unknown): boolean {
  return err instanceof UnauthenticatedError || (err instanceof Error && err.message === "Unauthenticated");
}

/** Redirects to sign-in when `err` is the missing-session error (`redirect` throws Next's control-flow error). */
export function redirectIfUnauthenticated(err: unknown): void {
  if (isUnauthenticated(err)) redirect("/login");
}

/** A record id as the record layouts accept it (a UUID); anything else is "not found" without a lookup (06-09c). */
export const RECORD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * V2-06 06-09c (IND L-2): a record layout's lookup failed (database or network error). Not "not found": the route
 * error boundary handles it. Carries no database text (IR-L1).
 */
export class RecordLookupError extends Error {
  constructor() {
    super("The record could not be loaded.");
    this.name = "RecordLookupError";
  }
}

export function isTenantLocked(err: unknown): err is TenantLockedError {
  return err instanceof TenantLockedError || (err instanceof Error && err.name === "TenantLockedError");
}

/**
 * V2-05 05-10b (SUB-02): redirects to the member's locked or onboarding page when `err` is the access refusal of the
 * guards (`TenantLockedError`, 05-10a). The `(dashboard)` layout redirects on every full page load; this covers a
 * client navigation, where Next renders only the page segment (the layout does not run again), and keeps the
 * refusal from being reported as a `request.error`. The role is read again for the destination
 * (`lib/auth/access-redirect.ts`); if it cannot be read, the staff page is used, which sends an owner or admin on to
 * `/billing/locked` itself.
 */
export async function redirectIfTenantLocked(err: unknown): Promise<void> {
  if (!isTenantLocked(err)) return;
  let role: UserRole | null = null;
  try {
    role = (await getActiveMembership()).role;
  } catch {
    // The destination page resolves the membership again.
  }
  redirect((role && accessRedirect(role, err.accessLevel)) || LOCKED_STAFF_PATH);
}

/**
 * V2-05 05-12 (ACC L-4, IND I-7): the access check every wrapped page runs BEFORE its loader. Loaders that read through
 * `getActiveMembership()` and RLS (not a guard) would otherwise render an empty page for a locked clinic on a client
 * navigation (the layout's redirect runs only on a full load). A membership that cannot be resolved is left to the
 * page's own handling (no clinic, several clinics); only a resolved clinic whose level is not `full` throws
 * `TenantLockedError`, which the wrapper turns into the member's locked or onboarding page.
 */
async function assertPageClinicFull(): Promise<void> {
  let membership: Awaited<ReturnType<typeof getActiveMembership>>;
  try {
    membership = await getActiveMembership();
  } catch (err) {
    redirectIfUnauthenticated(err);
    // 06-09d (L-R2): Auth could not answer. Never left to the page, whose own session read would take the failure for
    // "signed out" and redirect to /login: the route error boundary shows the unavailable state (Retry) instead.
    if (err instanceof AuthUnavailableError) throw err;
    return;
  }
  await assertTenantAccess(membership, "full");
}

/**
 * Wraps a dashboard page (an async server component): a missing or revoked session anywhere in its loader becomes a
 * redirect to /login; a clinic that is not `full` (05-10b; checked before the loader runs since 05-12) a redirect to
 * the member's locked or onboarding page; 06-09c (M-REMOVED) the active clinic no longer being one of the user's
 * clinics renders `MembershipEnded` (sign-out and purge; on a client navigation the layout does not run again, and on a
 * full load the page's output is discarded by the layout's own `MembershipEnded`, without a false request error);
 * every other error (and Next's own redirect/notFound) passes through unchanged.
 */
export function withPageAuth<P>(page: (props: P) => Promise<ReactNode>): (props: P) => Promise<ReactNode> {
  return async function AuthenticatedPage(props: P): Promise<ReactNode> {
    try {
      await assertPageClinicFull();
      const content = await page(props);
      // V2-09e 09E-02 (R-20): the screen's first-data marker, after its content (every page this wraps is a main screen).
      return createElement(Fragment, null, content, createElement(DataReady));
    } catch (err) {
      redirectIfUnauthenticated(err);
      await redirectIfTenantLocked(err);
      if (err instanceof ActiveClinicMembershipEndedError) return createElement(MembershipEnded);
      throw err;
    }
  };
}
