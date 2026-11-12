import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import type { TestDb } from "./db";

/**
 * Service-role admin client.
 * MANDATORY: ONLY used in test helpers and server administration scripts.
 * NEVER import or expose to browser client (AGENTS.md §5, §31).
 *
 * Typed through the RL-13b `TestDb` seam (see `./db.ts`) until generated types land in V2-03 plan 03-03.
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
