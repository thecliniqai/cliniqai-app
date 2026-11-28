import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { apiRequestBlocked, isApiV1Path, normaliseRequestPath } from "@/lib/api/enabled";
import { REQUEST_ID_HEADER, newRequestId } from "@/lib/log/request-id";
import { isNextDev, publicEnv } from "@/lib/env";
import { isApiPath, loginNextValue, pageNeedsSession } from "@/lib/auth/public-paths";
import { isSupabaseAuthCookie, sessionMustEnd } from "@/lib/auth/session-age";
import { isDefinitiveAuthRejection } from "@/lib/auth/auth-failure";
import { log } from "@/lib/log";
import { routePatternOfPath } from "@/lib/observability/route-patterns";
import { ROUTE_HEADER, START_HEADER } from "@/lib/observability/timing-headers";
import { CSP_HEADER, isPagePath, NONCE_HEADER, newNonce, pageSecurityHeaders } from "@/lib/security/headers";
import {
  AUTH_STATE_HEADER,
  AUTH_STATE_UNAVAILABLE,
  createAuthTransport,
  keepSessionCookies,
  PROXY_AUTH_DEADLINE_MS,
  PROXY_AUTH_REQUEST_BUDGET_MS,
} from "@/lib/supabase/auth-transport";

/**
 * The active-clinic pin `/api/session-status` sets (same value as `lib/supabase/server.ts` `ACTIVE_TENANT_COOKIE`,
 * restated so the proxy does not load the request client; tests/auth/session-auth-close-db.spec.ts asserts they match).
 */
export const PROXY_ACTIVE_TENANT_COOKIE = "clinic_active_tenant";
/**
 * V2-09d: the signed session-context cookie (same value as `lib/auth/context-cookie.ts` `CONTEXT_COOKIE`, restated so the
 * proxy loads no server-only module; tests/auth/context-cookie.spec.ts asserts they match). 09D-01a (S-5): on a Secure
 * request it is named `__Host-clinic_ctx` (`CONTEXT_COOKIE_SECURE`), which can only be expired with Secure and Path=/.
 */
export const PROXY_CONTEXT_COOKIE = "clinic_ctx";
export const PROXY_CONTEXT_COOKIE_SECURE = "__Host-clinic_ctx";

/**
 * V2-06 06-09d close (re-check L-N4): a request the proxy found definitively signed out (no session, or GoTrue refused
 * it: a revoked or expired refresh token, a deleted or banned user, an emailed-code session past its 10 minutes) also
 * forgets the clinic the ended session had pinned. Otherwise the next sign-in on this device (the same user after a
 * removal, or another user of a shared front-desk device) would resolve the old pin: one spurious "You no longer have
 * access to this clinic" sign-out, or a new account sent there instead of to `/clinic/new`. HttpOnly cookie, so only a
 * server answer can expire it (`/auth/signout` does on an explicit sign-out). Not on "Auth unavailable": that keeps
 * the session, and so the pin.
 */
function forgetActiveClinic(request: NextRequest, response: NextResponse): NextResponse {
  // V2-09d: the session-context cookie goes with it (useless without a session: it is bound to the session it names).
  let expired = false;
  for (const name of [PROXY_ACTIVE_TENANT_COOKIE, PROXY_CONTEXT_COOKIE, PROXY_CONTEXT_COOKIE_SECURE]) {
    if (request.cookies.has(name)) {
      const secure = name === PROXY_CONTEXT_COOKIE_SECURE;
      response.cookies.set(name, "", { path: "/", maxAge: 0, httpOnly: true, sameSite: "lax", ...(secure ? { secure } : {}) });
      expired = true;
    }
  }
  // 09D-01a (S-7): a response that sets (here: expires) the context cookie is never stored by a cache.
  if (expired) response.headers.set("cache-control", "private, no-store");
  return response;
}

/**
 * V2-03 03-09a (BACKEND H2, T-03-07): continue to the handler with `x-request-id` forced to this request's id (any
 * inbound value is overwritten, so a caller cannot pick the id its errors are filed under) and echo it on the response.
 * The request headers are cloned each time, so cookies a `setAll` wrote onto `request` before the call are forwarded.
 * `x-vercel-id` is left alone. V2-06 06-09d: the auth-state header is the proxy's alone: an inbound one is always
 * removed, and it is set only when this proxy found Supabase Auth unavailable (`authUnavailable`).
 */
/** When `proxy()` first saw each request (read back when the request is forwarded, so the timing line counts the proxy's own work). */
const proxyStartedAt = new WeakMap<NextRequest, number>();

/**
 * V2-14 14-01 (P1-18): each page request's security headers (`lib/security/headers.ts`), built once with a fresh nonce
 * when the proxy first sees the request. The CSP also goes on the forwarded request, where Next.js reads the nonce
 * and puts it on its scripts; an inbound `Content-Security-Policy` or nonce request header is always dropped, so a
 * caller can never choose the nonce.
 */
const pageHeaders = new WeakMap<NextRequest, Record<string, string>>();

function securityHeadersFor(request: NextRequest): Record<string, string> | null {
  const pathname = request.nextUrl.pathname;
  if (!isPagePath(pathname)) return null;
  let headers = pageHeaders.get(request);
  if (!headers) {
    headers = pageSecurityHeaders({
      nonce: newNonce(),
      pathname,
      supabaseUrl: publicEnv.NEXT_PUBLIC_SUPABASE_URL,
      // `next dev` only (React's dev tooling evaluates code).
      dev: isNextDev(),
    });
    pageHeaders.set(request, headers);
  }
  return headers;
}

function applySecurityHeaders(request: NextRequest, response: NextResponse): NextResponse {
  const headers = securityHeadersFor(request);
  if (headers) for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
  return response;
}

function continueWithRequestId(request: NextRequest, requestId: string, authUnavailable = false): NextResponse {
  const headers = new Headers(request.headers);
  headers.set(REQUEST_ID_HEADER, requestId);
  // V2-09e 09E-02 (R-20): the route pattern and the proxy's start time for the `request.timing` line. Both are overwritten on
  // every request (an inbound value is never trusted) and the reader checks them again.
  headers.set(ROUTE_HEADER, routePatternOfPath(request.nextUrl.pathname));
  headers.set(START_HEADER, String(proxyStartedAt.get(request) ?? Date.now()));
  headers.delete(AUTH_STATE_HEADER);
  if (authUnavailable) headers.set(AUTH_STATE_HEADER, AUTH_STATE_UNAVAILABLE);
  headers.delete(CSP_HEADER);
  headers.delete("content-security-policy-report-only");
  headers.delete(NONCE_HEADER);
  const security = securityHeadersFor(request);
  if (security) {
    headers.set(CSP_HEADER, security[CSP_HEADER]);
    headers.set(NONCE_HEADER, /'nonce-([^']+)'/.exec(security[CSP_HEADER])?.[1] ?? "");
  }
  const response = NextResponse.next({ request: { headers } });
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return applySecurityHeaders(request, response);
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
  const response = applySecurityHeaders(request, NextResponse.redirect(target, 307));
  response.headers.set(REQUEST_ID_HEADER, requestId);
  carry.cookies.getAll().forEach((cookie) => response.cookies.set(cookie));
  for (const name of SESSION_CACHE_HEADERS) {
    const value = carry.headers.get(name);
    if (value !== null) response.headers.set(name, value);
  }
  return response;
}

/**
 * The no-store headers for a response that must never be cached: one that deletes the session cookies, and (V2-06
 * 06-05, PWA D-4) every signed-in page and RSC response.
 */
const NO_STORE_HEADERS: Record<(typeof SESSION_CACHE_HEADERS)[number], string> = {
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
  for (const [key, value] of Object.entries(NO_STORE_HEADERS)) response.headers.set(key, value);
  return response;
}

/**
 * V2-09b 09B-06a (ruling R-U; review S-1 / A-5): the request-body gate. The server-action body limit is 4 MB for every action (next.config.ts) and Next
 * reads the body before any action authenticates, so a request that may carry more than 1 MB is answered 413 here, before anything reads it, unless the
 * caller is signed in and posts to a page that hosts the report upload (`/consultation/…`, `/patients/…`). "May carry": a `content-length` over 1 MB or
 * not a plain number, or a body with no `content-length` (a `transfer-encoding`, or a body stream), since its size is then unknown. A request with
 * neither a length nor a body (a bodiless POST or DELETE) carries nothing and passes.
 */
export const PROXY_MAX_BODY_BYTES = 1024 * 1024;

export function bodyMayExceedProxyLimit(request: NextRequest): boolean {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD") return false;
  const length = request.headers.get("content-length");
  if (length === null) return request.headers.has("transfer-encoding") || request.body !== null;
  const trimmed = length.trim();
  return !/^\d+$/.test(trimmed) || Number(trimmed) > PROXY_MAX_BODY_BYTES;
}

/**
 * V2-14 14-02 (P2-06, plan D-8): the most an upload page's action may receive: the 4 MB file (features/labs/utils.ts
 * `LAB_MAX_FILE_BYTES`) plus the multipart and action framing, at Vercel's own 4.5 MB request cap. A declared length
 * above it is refused before any session work, signed in or not, so nothing is ever buffered towards Next's 4 MB
 * action limit for a request that cannot succeed.
 */
export const PROXY_MAX_UPLOAD_BODY_BYTES = 4.5 * 1024 * 1024;

export function declaredBodyExceedsUploadLimit(request: NextRequest): boolean {
  const length = request.headers.get("content-length")?.trim();
  return length !== undefined && /^\d+$/.test(length) && Number(length) > PROXY_MAX_UPLOAD_BODY_BYTES;
}

/** The pages whose server action takes a report upload (09B-06a, R-U): the consult and the patient record. */
export function isUploadPagePath(pathname: string): boolean {
  return pathname.startsWith("/consultation/") || pathname.startsWith("/patients/");
}

function payloadTooLarge(requestId: string): NextResponse {
  return new NextResponse(null, { status: 413, headers: { [REQUEST_ID_HEADER]: requestId } });
}

/** Exact paths that never carry a user session: no cookie refresh, no default-deny redirect (they are `/api`). */
const SESSIONLESS_PATHS: ReadonlySet<string> = new Set(["/api/health", "/api/ready", "/api/jobs/run"]);

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  proxyStartedAt.set(request, Date.now());
  // Every path gets an id, the early returns included.
  const requestId = newRequestId();

  // R-U: a large or unsized body is refused before any session work unless it is bound for an upload page (decided below, once the session is known).
  const largeBody = bodyMayExceedProxyLimit(request);
  if (largeBody && (!isUploadPagePath(pathname) || declaredBodyExceedsUploadLimit(request))) return payloadTooLarge(requestId);

  // PO-16: `/api/v1/**` (docs and openapi.json included) is a plain 404 unless API_V1_ENABLED is on. AR2-H2: the check
  // runs on the decoded, normalised path (Next decodes `/api/v%31/...` before matching the route), and any `/api` path
  // that is undecodable or still holds `%` or a backslash is refused outright.
  if (apiRequestBlocked(pathname)) {
    return new NextResponse(null, { status: 404, headers: { [REQUEST_ID_HEADER]: requestId } });
  }
  if (isApiV1Path(normaliseRequestPath(pathname) ?? pathname)) {
    return continueWithRequestId(request, requestId);
  }

  // Probes and the job runner (04-02: pg_cron calls it every minute with a bearer, never a session) skip the session
  // refresh, so they cost no Supabase Auth round trip; they still get a request id.
  if (SESSIONLESS_PATHS.has(pathname)) {
    return continueWithRequestId(request, requestId);
  }

  // @supabase/ssr 0.12 (AUTH_REDESIGN §4.2): `setAll` rebuilds the response with the refreshed cookies and the
  // no-store cache headers it is handed; the proxy returns exactly that response, never a fresh `NextResponse.next()`
  // built after the cookies were set (the cookies would be lost and the next request would refresh again).
  // V2-06 06-09d (H-AUTHOUT-R1): `setAll` only records the writes; they are applied once the outcome is known
  // (`applyCookieWrites`), and never after an Auth answer that was not definitive: auth-js deletes the session for a
  // 429 or an uncoded 4xx on the token refresh, and that deletion must not reach the browser or this request.
  let response = continueWithRequestId(request, requestId);
  const transport = createAuthTransport({ supabaseUrl: publicEnv.NEXT_PUBLIC_SUPABASE_URL, budgetMs: PROXY_AUTH_REQUEST_BUDGET_MS });
  type CookieWrites = { cookies: { name: string; value: string; options: Parameters<typeof response.cookies.set>[2] }[]; headers: Record<string, string> };
  let pending: CookieWrites[] = [];
  const applyCookieWrites = () => {
    for (const { cookies: cookiesToSet, headers } of pending) {
      cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
      response = continueWithRequestId(request, requestId);
      cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      // Cache-Control/Expires/Pragma: a response carrying auth cookies must never be cached and served to another user.
      Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
    }
    pending = [];
  };

  const supabase = createServerClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      global: { fetch: transport.fetch },
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          const kept = keepSessionCookies(transport, cookiesToSet);
          if (kept.length > 0) pending.push({ cookies: kept, headers });
        },
      },
    }
  );

  // Refresh the session (the only refresh point; refreshing in two places risks refresh-token reuse sign-outs).
  // getClaims() verifies the JWT and refreshes an expired session through the same cookie path.
  // 06-09d: three outcomes. Signed in; signed out (no session, or a definitive GoTrue refusal: the refresh token is
  // gone, the session revoked, the user deleted or banned, a token that fails verification); or Auth unavailable (a
  // network error, a timeout, 5xx, 429, 408, an uncoded or non-GoTrue answer, or no answer within the budget). The
  // call is bounded: `PROXY_AUTH_REQUEST_BUDGET_MS` (5.5 s; the transport also ends auth-js's own refresh back-off by
  // then), hard-stopped at `PROXY_AUTH_DEADLINE_MS`, so proxy + route handler stay inside the client's 10 s.
  let signedIn = false;
  let authUnavailable = false;
  let amr: unknown;
  let failure = "none";
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      supabase.auth.getClaims(),
      new Promise<null>((resolve) => {
        deadline = setTimeout(() => resolve(null), PROXY_AUTH_DEADLINE_MS);
      }),
    ]);
    if (result === null) {
      authUnavailable = true;
      failure = "deadline";
    } else if (result.data?.claims?.sub) {
      signedIn = true;
      amr = result.data.claims.amr;
    } else if (result.error && !isDefinitiveAuthRejection(result.error)) {
      authUnavailable = true;
      failure = result.error.name;
    }
  } catch (err) {
    // Not an answer from Auth (auth-js rethrows only non-auth errors): unavailable, never a sign-out.
    authUnavailable = true;
    failure = err instanceof Error ? err.name : "unknown";
  } finally {
    clearTimeout(deadline);
  }

  if (authUnavailable) {
    // The session cookies stay as they are (no write of this request reaches the browser), the request continues
    // marked so that no page, action or handler refreshes again, and no page is sent to /login: pages show their
    // unavailable state, `/api/session-status` answers 503, actions their generic failure.
    pending = [];
    log.warn({ event: "auth.proxy.unavailable", code: failure, requestId });
    // R-U: whether the caller has a session is unknown, so a large upload body is not let through.
    if (largeBody) return payloadTooLarge(requestId);
    response = continueWithRequestId(request, requestId, true);
    if (request.method === "GET" || request.method === "HEAD") {
      for (const [key, value] of Object.entries(NO_STORE_HEADERS)) response.headers.set(key, value);
    }
    return response;
  }
  applyCookieWrites();

  // H-AUTH (03-13a; A00-5, ruling R-35): a session established with an emailed code (recovery, invite, OTP, signup,
  // magic link; any `amr` method not known to be a password or MFA factor counts as one, and an unreadable `amr`
  // fails closed) lives at most FRESH_MAILBOX_SESSION_SECONDS after the code was used, unless a later password
  // sign-in superseded it. Such a session is exempt from hosted "require current password" (AUTH-00 E5), so left alive
  // it could change the password straight through GoTrue `PUT /auth/v1/user`, skipping the app's checks. Here it is
  // revoked at GoTrue (`signOut({ scope: "local" })` ends this session and its refresh token) and the request goes on
  // signed out, before any page, Server Action or route handler runs.
  if (signedIn && sessionMustEnd(amr)) {
    transport.restartBudget();
    try {
      await supabase.auth.signOut({ scope: "local" });
    } catch {
      // Fail closed: the cookies are deleted below whatever GoTrue answered.
    }
    applyCookieWrites();
    response = continueSignedOut(request, requestId, response);
    signedIn = false;
  }

  // R-U: a large body reaches an upload page only with a session.
  if (largeBody && !signedIn) return forgetActiveClinic(request, payloadTooLarge(requestId));

  // OA-5 default deny (R-28): a signed-out request for any page outside the public prefixes is sent to the login page
  // here, before any layout or page loader runs (they would only throw "Unauthenticated"). GET/HEAD only: other
  // methods on a page path are Server Action calls, which authenticate themselves (P0-13 guard manifest), and `/api`
  // handlers authenticate themselves.
  if (!signedIn && (request.method === "GET" || request.method === "HEAD") && pageNeedsSession(pathname)) {
    return forgetActiveClinic(request, redirectToLogin(request, requestId, response));
  }
  // L-N4: every other definitively signed-out request (a public page such as /login, an `/api` call, a Server Action).
  if (!signedIn) forgetActiveClinic(request, response);

  // V2-06 06-05 (PWA_STRATEGY §4 D-4, ruling R-20): a signed-in page or RSC response (GET/HEAD outside /api) is
  // `private, no-store`, set here rather than relying on Next's default for dynamic pages, so neither the browser's
  // HTTP cache nor any shared cache keeps patient data and the page is not restored from the back-forward cache.
  // `/api` handlers set their own headers. A response `setAll` already marked no-store (a refreshed session) keeps that.
  if (
    signedIn &&
    (request.method === "GET" || request.method === "HEAD") &&
    !isApiPath(normaliseRequestPath(pathname) ?? pathname) &&
    !(response.headers.get("cache-control") ?? "").includes("no-store")
  ) {
    for (const [key, value] of Object.entries(NO_STORE_HEADERS)) response.headers.set(key, value);
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
     * - top-level public assets (`/logo.png`): ONE path segment with an image extension.
     * 03-13a (review D L-4): the image-extension exclusion used to apply at any depth, so `/patients/abc.png` reached
     * `app/(dashboard)/patients/[id]` with no default-deny redirect, no session check and no request id. Nested paths
     * now always run the proxy; `public/` has no nested assets (a new one would be redirected while signed out, which
     * fails closed and is visible at once).
     */
    "/((?!_next/static|_next/image|favicon.ico|[^/]+\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
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
