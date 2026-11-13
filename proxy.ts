import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { apiRequestBlocked, isApiV1Path, normaliseRequestPath } from "@/lib/api/enabled";
import { REQUEST_ID_HEADER, newRequestId } from "@/lib/log/request-id";
import { publicEnv } from "@/lib/env";
import { loginNextValue, pageNeedsSession } from "@/lib/auth/public-paths";

/**
 * V2-03 03-09a (BACKEND H2, T-03-07): continue to the handler with `x-request-id` forced to this request's id (any
 * inbound value is overwritten, so a caller cannot pick the id its errors are filed under) and echo it on the response.
 * The request headers are cloned each time, so cookies a `setAll` wrote onto `request` before the call are forwarded.
 * `x-vercel-id` is left alone.
 */
function continueWithRequestId(request: NextRequest, requestId: string): NextResponse {
  const headers = new Headers(request.headers);
  headers.set(REQUEST_ID_HEADER, requestId);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}

/** Headers @supabase/ssr hands to `setAll` with refreshed or cleared cookies (never cache such a response). */
const SESSION_CACHE_HEADERS = ["cache-control", "expires", "pragma"] as const;

/**
 * V2-03 03-12b (OA-5, R-28): 307 to `/login?next=<path + query>` for a signed-out page request. Carries the request id
 * and whatever `setAll` put on `carry` (a failed refresh deletes the stale auth cookies; those deletions must reach
 * the browser) with its no-store headers.
 */
function redirectToLogin(request: NextRequest, requestId: string, carry: NextResponse): NextResponse {
  const target = new URL("/login", request.nextUrl.origin);
  const next = loginNextValue(request.nextUrl);
  if (next !== null) target.searchParams.set("next", next);
  const response = NextResponse.redirect(target, 307);
  response.headers.set(REQUEST_ID_HEADER, requestId);
  carry.cookies.getAll().forEach((cookie) => response.cookies.set(cookie));
  for (const name of SESSION_CACHE_HEADERS) {
    const value = carry.headers.get(name);
    if (value !== null) response.headers.set(name, value);
  }
  return response;
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  // Every path gets an id, the early returns included.
  const requestId = newRequestId();

  // PO-16: `/api/v1/**` (docs and openapi.json included) is a plain 404 unless API_V1_ENABLED is on. AR2-H2: the check
  // runs on the decoded, normalised path (Next decodes `/api/v%31/...` before matching the route), and any `/api` path
  // that is undecodable or still holds `%` or a backslash is refused outright.
  if (apiRequestBlocked(pathname)) {
    return new NextResponse(null, { status: 404, headers: { [REQUEST_ID_HEADER]: requestId } });
  }
  if (isApiV1Path(normaliseRequestPath(pathname) ?? pathname)) {
    return continueWithRequestId(request, requestId);
  }

  if (pathname === "/api/health" || pathname === "/api/ready") {
    return continueWithRequestId(request, requestId);
  }

  // @supabase/ssr 0.12 (AUTH_REDESIGN §4.2): `setAll` rebuilds the response with the refreshed cookies and the
  // no-store cache headers it is handed; the proxy returns exactly that response, never a fresh `NextResponse.next()`
  // built after the cookies were set (the cookies would be lost and the next request would refresh again).
  let response = continueWithRequestId(request, requestId);

  const supabase = createServerClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = continueWithRequestId(request, requestId);
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
          // Cache-Control/Expires/Pragma: a response carrying auth cookies must never be cached and served to another user.
          Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
        },
      },
    }
  );

  // Refresh the session (the only refresh point; refreshing in two places risks refresh-token reuse sign-outs).
  // getClaims() verifies the JWT and refreshes an expired session through the same cookie path.
  let signedIn = false;
  try {
    const { data } = await supabase.auth.getClaims();
    signedIn = Boolean(data?.claims?.sub);
  } catch {
    // Treated as signed out: a protected page goes to the login page, a public one renders as it would anyway.
  }

  // OA-5 default deny (R-28): a signed-out request for any page outside the public prefixes is sent to the login page
  // here, before any layout or page loader runs (they would only throw "Unauthenticated"). GET/HEAD only: other
  // methods on a page path are Server Action calls, which authenticate themselves (P0-13 guard manifest), and `/api`
  // handlers authenticate themselves.
  if (!signedIn && (request.method === "GET" || request.method === "HEAD") && pageNeedsSession(pathname)) {
    return redirectToLogin(request, requestId, response);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public assets
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
    // PO-16: the extension exclusion above must not let `/api/v1/<route>/<id>.png` reach a dynamic v1 handler
    // without the API_V1_ENABLED check.
    "/api/v1",
    "/api/v1/:path*",
    // AR2-H2: every /api path runs the proxy whatever its extension or encoding (`/api/v%31/x.png`), so the
    // normalised switch check cannot be skipped by the asset exclusion above. Static assets outside /api stay excluded.
    "/api",
    "/api/:path*",
  ],
};
