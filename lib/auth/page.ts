import "server-only";

import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getActiveMembership, TenantLockedError, UnauthenticatedError } from "@/lib/auth/tenant";
import { accessRedirect, LOCKED_STAFF_PATH } from "@/lib/auth/access-redirect";
import type { UserRole } from "@/lib/db/types";

/**
 * Dashboard page loaders and a session that is gone (V2-05 05-11c; root cause in the 05-02a record, "Open items").
 *
 * A session revoked elsewhere (sign-out on another device, password reset or change) still carries a valid access
 * token, so `proxy.ts` (local JWT verification) lets the page request through. The dashboard layout asks GoTrue, gets
 * no user and redirects to /login, but Next renders the page concurrently: its loader's `getActiveMembership()` threw
 * "Unauthenticated", which `onRequestError` logged as `request.error` and sent to the error sink, one false event per
 * such page load. A page wrapped in {@link withPageAuth} answers the same condition with the same redirect instead.
 */
export function isUnauthenticated(err: unknown): boolean {
  return err instanceof UnauthenticatedError || (err instanceof Error && err.message === "Unauthenticated");
}

/** Redirects to sign-in when `err` is the missing-session error (`redirect` throws Next's control-flow error). */
export function redirectIfUnauthenticated(err: unknown): void {
  if (isUnauthenticated(err)) redirect("/login");
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
 * Wraps a dashboard page (an async server component): a missing or revoked session anywhere in its loader becomes a
 * redirect to /login; a clinic that is not `full` (05-10b) a redirect to the member's locked or onboarding page;
 * every other error (and Next's own redirect/notFound) passes through unchanged.
 */
export function withPageAuth<P>(page: (props: P) => Promise<ReactNode>): (props: P) => Promise<ReactNode> {
  return async function AuthenticatedPage(props: P): Promise<ReactNode> {
    try {
      return await page(props);
    } catch (err) {
      redirectIfUnauthenticated(err);
      await redirectIfTenantLocked(err);
      throw err;
    }
  };
}
