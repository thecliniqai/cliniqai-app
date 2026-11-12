import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import type { TestDb } from "./db";

/**
 * Service-role admin client.
 * MANDATORY: ONLY used in test helpers and server administration scripts.
 * NEVER import or expose to browser client (AGENTS.md §5, §31).
 *
 * Typed as `SupabaseClient<Database>` over the generated `types/database.ts` (see `./db.ts`).
 */
export function getAdminClient(): TestDb {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for test administration helpers");
  }

  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
