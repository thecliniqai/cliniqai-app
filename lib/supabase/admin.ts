import { createClient } from "@supabase/supabase-js";
import { Database } from "@/lib/db/types";
import { publicEnv } from "@/lib/env";
import { serverEnv } from "@/lib/env-server";

let adminClientInstance: ReturnType<typeof createClient<Database>> | null = null;

/**
 * Service-role admin client for secure server-side operations that require
 * bypassing RLS (e.g. tokenized zero-login public patient document verification).
 * MANDATORY: ONLY used in server-side route handlers / actions.
 * NEVER import or expose to browser client (AGENTS.md §5, §8).
 */
export function getAdminClient() {
  const serviceKey = serverEnv().SUPABASE_SECRET_KEY;
  if (!serviceKey) {
    throw new Error("SUPABASE_SECRET_KEY is required for server administrative operations");
  }

  if (!adminClientInstance) {
    adminClientInstance = createClient<Database>(publicEnv.NEXT_PUBLIC_SUPABASE_URL, serviceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  return adminClientInstance;
}
