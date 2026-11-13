import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { apiRequestBlocked, isApiV1Path, normaliseRequestPath } from "@/lib/api/enabled";
import { REQUEST_ID_HEADER, newRequestId } from "@/lib/log/request-id";
import { publicEnv } from "@/lib/env";
import { loginNextValue, pageNeedsSession } from "@/lib/auth/public-paths";
import { isSupabaseAuthCookie, sessionMustEnd } from "@/lib/auth/session-age";

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

/** The no-store headers for a response that deletes the session cookies (it must never be cached). */
const ENDED_SESSION_CACHE_HEADERS: Record<(typeof SESSION_CACHE_HEADERS)[number], string> = {
  "cache-control": "private, no-cache, no-store, must-revalidate, max-age=0",
  expires: "0",
  pragma: "no-cache",
};

/**
 * V2-03 03-13a (H-AUTH): the request continues as a signed-out request. Every Supabase auth cookie is removed from the
 * request (so no layout, page, Server Action or route handler on this request sees the session) and deleted in the
 * browser, whether or not GoTrue confirmed the revocation (fail closed).
 */
function continueSignedOut(request: NextRequest, requestId: string, previous: NextResponse): NextResponse {
  const names = new Set<string>();
  for (const { name } of request.cookies.getAll()) if (isSupabaseAuthCookie(name)) names.add(name);
  for (const { name } of previous.cookies.getAll()) if (isSupabaseAuthCookie(name)) names.add(name);
  for (const name of names) request.cookies.delete(name);
  const response = continueWithRequestId(request, requestId);
  for (const name of names) response.cookies.set(name, "", { path: "/", maxAge: 0 });
  for (const [key, value] of Object.entries(ENDED_SESSION_CACHE_HEADERS)) response.headers.set(key, value);
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
  let amr: unknown;
  try {
    const { data } = await supabase.auth.getClaims();
    signedIn = Boolean(data?.claims?.sub);
    amr = data?.claims?.amr;
  } catch {
    // Treated as signed out: a protected page goes to the login page, a public one renders as it would anyway.
  }

  // H-AUTH (03-13a; A00-5, ruling R-35): a session established with an emailed code (recovery, invite, OTP, signup,
  // magic link; any `amr` method not known to be a password or MFA factor counts as one, and an unreadable `amr`
  // fails closed) lives at most FRESH_MAILBOX_SESSION_SECONDS after the code was used, unless a later password
  // sign-in superseded it. Such a session is exempt from hosted "require current password" (AUTH-00 E5), so left alive
  // it could change the password straight through GoTrue `PUT /auth/v1/user`, skipping the app's checks. Here it is
  // revoked at GoTrue (`signOut({ scope: "local" })` ends this session and its refresh token) and the request goes on
  // signed out, before any page, Server Action or route handler runs.
  if (signedIn && sessionMustEnd(amr)) {
    try {
      await supabase.auth.signOut({ scope: "local" });
    } catch {
      // Fail closed: the cookies are deleted below whatever GoTrue answered.
    }
    response = continueSignedOut(request, requestId, response);
    signedIn = false;
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
