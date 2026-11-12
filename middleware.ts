import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { apiRequestBlocked, isApiV1Path, normaliseRequestPath } from "@/lib/api/enabled";

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // PO-16: `/api/v1/**` (docs and openapi.json included) is a plain 404 unless API_V1_ENABLED is on. AR2-H2: the check
  // runs on the decoded, normalised path (Next decodes `/api/v%31/...` before matching the route), and any `/api` path
  // that is undecodable or still holds `%` or a backslash is refused outright.
  if (apiRequestBlocked(pathname)) {
    return new NextResponse(null, { status: 404 });
  }
  if (isApiV1Path(normaliseRequestPath(pathname) ?? pathname)) {
    return NextResponse.next();
  }

  if (pathname === "/api/health" || pathname === "/api/ready") {
    return NextResponse.next();
  }

  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(
          cookiesToSet: Array<{
            name: string;
            value: string;
            options?: Record<string, unknown>;
          }>
        ) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refresh auth session
  await supabase.auth.getUser();

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
    // AR2-H2: every /api path runs the middleware whatever its extension or encoding (`/api/v%31/x.png`), so the
    // normalised switch check cannot be skipped by the asset exclusion above. Static assets outside /api stay excluded.
    "/api",
    "/api/:path*",
  ],
};
