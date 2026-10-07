import { createClient } from "@supabase/supabase-js";
import { Database } from "@/lib/db/types";
import { env } from "@/lib/env";

/**
 * Service-role admin client.
 * MANDATORY: ONLY used in test helpers and server administration scripts.
 * NEVER import or expose to browser client (AGENTS.md §5, §31).
 */
export function getAdminClient() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for test administration helpers");
  }

  return createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
