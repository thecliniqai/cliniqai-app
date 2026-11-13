import { normaliseRequestPath } from "@/lib/api/enabled";

/**
 * V2-03 03-12b (OA-5, R-28): which page paths a signed-out request may reach. Default deny: every page path is
 * protected unless it sits under one of these prefixes, so a new page is protected without anyone remembering to list
 * it. `proxy.ts` sends a signed-out GET/HEAD for a protected page to `/login?next=…` before any page code runs.
 *
 * Each prefix matches itself and the paths below it, segment by segment (`/r` matches `/r/<token>`, never `/reports`).
 * tests/auth/public-paths.spec.ts enumerates every `page.tsx` and `route.ts` under `app/` and fails on a public prefix
 * that matches nothing (stale entry) and on a dashboard or onboarding page that comes out public.
 */
export const PUBLIC_PAGE_PREFIXES = [
  // (auth) pages: sign in, password reset, invitation acceptance.
  "/login",
  "/forgot-password",
  "/join",
  // Share-token links (P0-04, ADR-0005 D3): the token is the authentication.
  "/r",
  "/reports/view",
  "/reschedule",
  // Auth route handlers outside /api (`POST /auth/signout` must work with an expired or missing session).
  "/auth",
] as const;

/**
 * Next internals the matcher does not already exclude (`/_next/static` and `/_next/image` never reach the proxy;
 * `/__nextjs_*` are development-overlay endpoints). Matched on the raw AND the normalised path, so an encoded
 * `..` cannot ride an internal prefix onto a page.
 */
const NEXT_INTERNAL_PREFIXES = ["/_next/", "/__nextjs"] as const;

function underPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/** `/api` and everything below it (normalised path). Route handlers there authenticate themselves (R-28). */
export function isApiPath(normalised: string): boolean {
  return underPrefix(normalised, "/api");
}

/**
 * True when a signed-out request for `pathname` (the raw `request.nextUrl.pathname`) must be sent to the login page.
 * A path is public only when BOTH the raw path and its normalised form (fully decoded, separators and dot segments
 * resolved, lower case) sit under a public prefix: `/r/..%2Fpatients` (normalises to `/patients`) and
 * `/patients/..%2F..%2Flogin` (raw path routes to `/patients/[id]`) are both protected. A path that cannot be decoded
 * is protected (fail closed). `/api/**` (raw and normalised) is never redirected (R-28).
 */
export function pageNeedsSession(pathname: string): boolean {
  const normalised = normaliseRequestPath(pathname);
  if (normalised === null) return true;
  if (NEXT_INTERNAL_PREFIXES.some((p) => pathname.startsWith(p) && `${normalised}/`.startsWith(p))) return false;
  if (isApiPath(normalised) && isApiPath(pathname.toLowerCase())) return false;
  const isPublic = (path: string) => PUBLIC_PAGE_PREFIXES.some((p) => underPrefix(path, p));
  return !(isPublic(pathname) && isPublic(normalised));
}

/**
 * The `next` value for the login redirect: the requested path and query, without Next's internal `_rsc` parameter.
 * Null for anything that is not a plain same-origin path (`//host`, `/\host`), so the redirect never carries an
 * off-site target (the login page also validates it, T-03-04).
 */
export function loginNextValue(url: URL): string | null {
  const params = new URLSearchParams(url.search);
  params.delete("_rsc");
  const search = params.toString();
  const value = `${url.pathname}${search ? `?${search}` : ""}`;
  return /^\/(?![/\\])/.test(value) && !value.includes("\\") ? value : null;
}
