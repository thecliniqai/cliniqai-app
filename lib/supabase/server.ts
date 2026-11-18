import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";
import { Database } from "@/lib/db/types";
import { publicEnv } from "@/lib/env";
import {
  AUTH_STATE_HEADER,
  AUTH_STATE_UNAVAILABLE,
  createAuthTransport,
  keepSessionCookies,
} from "@/lib/supabase/auth-transport";

/** The clinic a multi-clinic user picked (read by `lib/auth/tenant.ts` `getActiveMembership()`). */
export const ACTIVE_TENANT_COOKIE = "clinic_active_tenant";
/**
 * V2-06 06-09d: how long `/api/session-status` keeps the clinic it pinned (the auth cookies' 400-day lifetime; every
 * sign-out expires it).
 */
export const ACTIVE_TENANT_COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

/**
 * Request header that carries the active clinic to the database (V2-05 05-01b, ruling R-42). PostgREST and the Storage
 * API expose it to SQL as `request.headers`; `authz.active_tenant_id()` (migration 000046) accepts it only for a
 * clinic the caller is a member of, so a forged value can only name another of the caller's own clinics (T-05-40).
 */
export const ACTIVE_TENANT_HEADER = "x-clinicos-tenant";

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The global headers for a user client: the active-clinic header when the cookie holds a UUID, nothing otherwise
 * (single-clinic users need no cookie: the database falls back to their only membership).
 */
export function activeTenantHeaders(cookieValue: string | undefined): Record<string, string> {
  return cookieValue && UUID_SHAPE.test(cookieValue) ? { [ACTIVE_TENANT_HEADER]: cookieValue.toLowerCase() } : {};
}

/**
 * An anon-key client with no session and no cookies, for public token links (P0-04, ADR-0005 D3). It can only call
 * the token-scoped RPCs granted to `anon` (000020); RLS gives it no table rows. Safe outside a request scope.
 */
export function createPublicClient() {
  return createServerClient<Database>(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return [];
      },
      setAll() {
        // No session is ever stored for public links.
      },
    },
  });
}

/** Whether `proxy.ts` found Supabase Auth unavailable for this request (06-09d; false outside a request scope). */
async function authUnavailableForRequest(): Promise<boolean> {
  try {
    return (await headers()).get(AUTH_STATE_HEADER) === AUTH_STATE_UNAVAILABLE;
  } catch {
    return false;
  }
}

/**
 * The user client every request-path `ServiceContext` uses: the session from the auth cookies, and the active clinic
 * from `clinic_active_tenant` as the `x-clinicos-tenant` header on every PostgREST, RPC and Storage call (R-42).
 *
 * V2-06 06-09d (H-AUTHOUT-R1): Auth calls go through `createAuthTransport` (bounded to `AUTH_REQUEST_BUDGET_MS`;
 * answered "unavailable" at once when the proxy already found Auth unavailable for this request), and `setAll` never
 * deletes the auth cookies after an Auth answer that was not definitive (`keepSessionCookies`): a route handler or
 * server action whose refresh got a 429, a 5xx, a timeout or a gateway's uncoded 4xx keeps the session.
 */
export async function createClient() {
  const cookieStore = await cookies();
  const activeTenant = cookieStore.getAll().find((c) => c.name === ACTIVE_TENANT_COOKIE)?.value;
  const transport = createAuthTransport({
    supabaseUrl: publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    unavailable: await authUnavailableForRequest(),
  });

  return createServerClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      global: { headers: activeTenantHeaders(activeTenant), fetch: transport.fetch },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        // @supabase/ssr 0.12 also passes no-store cache headers; a Server Component or action cannot set response
        // headers, and the proxy (the only refresh point) already sets them on every response that carries cookies.
        setAll(cookiesToSet) {
          try {
            keepSessionCookies(transport, cookiesToSet).forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Ignored when called from Server Components
          }
        },
      },
    }
  );
}
