import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { Database } from "@/lib/db/types";
import { env } from "@/lib/env";

/**
 * An anon-key client with no session and no cookies, for public token links (P0-04, ADR-0005 D3). It can only call
 * the token-scoped RPCs granted to `anon` (000020); RLS gives it no table rows. Safe outside a request scope.
 */
export function createPublicClient() {
  return createServerClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
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

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        // @supabase/ssr 0.12 also passes no-store cache headers; a Server Component or action cannot set response
        // headers, and the proxy (the only refresh point) already sets them on every response that carries cookies.
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
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
