import "server-only";

import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { UnauthenticatedError } from "@/lib/auth/tenant";

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

/**
 * Wraps a dashboard page (an async server component): a missing or revoked session anywhere in its loader becomes a
 * redirect to /login; every other error (and Next's own redirect/notFound) passes through unchanged.
 */
export function withPageAuth<P>(page: (props: P) => Promise<ReactNode>): (props: P) => Promise<ReactNode> {
  return async function AuthenticatedPage(props: P): Promise<ReactNode> {
    try {
      return await page(props);
    } catch (err) {
      redirectIfUnauthenticated(err);
      throw err;
    }
  };
}
