/**
 * Test clients that act in a chosen clinic (V2-05 05-01b, ruling R-42, risk K-15).
 *
 * The app's user client (`lib/supabase/server.ts` `createClient()`) sends the `x-clinicos-tenant` header from the
 * `clinic_active_tenant` cookie, and `authz.active_tenant_id()` binds the session to that clinic. A multi-clinic test
 * user signed in with a plain supabase-js client sends no header, so once policies use the bound helpers (05-02c) it
 * reads nothing. `signInActingIn` builds the same JWT client with the header set, the way the app does.
 */
import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import { activeTenantHeaders } from "@/lib/supabase/server";
import type { TestDb } from "./db";
import { seededUserPassword } from "./tenants";

/** A signed-in JWT client for `email` whose every PostgREST, RPC and Storage call names `tenantId` as active. */
export async function signInActingIn(email: string, tenantId: string | null): Promise<TestDb> {
  const client: TestDb = createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: activeTenantHeaders(tenantId ?? undefined) },
  });
  const { error } = await client.auth.signInWithPassword({ email, password: seededUserPassword() });
  if (error) throw new Error(`sign-in failed: ${error.message}`);
  return client;
}
