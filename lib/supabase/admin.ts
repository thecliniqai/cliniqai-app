import { createClient } from "@supabase/supabase-js";
import { Database } from "@/lib/db/types";
import { env } from "@/lib/env";

let adminClientInstance: ReturnType<typeof createClient<Database>> | null = null;

/**
 * Service-role admin client for secure server-side operations that require
 * bypassing RLS (e.g. tokenized zero-login public patient document verification).
 * MANDATORY: ONLY used in server-side route handlers / actions.
 * NEVER import or expose to browser client (AGENTS.md §5, §8).
 */
export function getAdminClient() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for server administrative operations");
  }

  if (!adminClientInstance) {
    adminClientInstance = createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, serviceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  return adminClientInstance;
}
