import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, DocumentShareResourceType } from "@/lib/db/types";

/**
 * Creates a 7-day public share token through `create_share_token` (000020, P0-04). The tenant is derived inside the
 * database from the resource row and the caller must be a member of that tenant; members cannot insert tokens
 * directly. `db` is the acting user's JWT client (`ctx.db`). Returns null on any refusal (missing resource, other
 * tenant's resource, no session): callers map that to their own "could not create link" error.
 */
export async function createShareToken(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<Database, any, any>,
  resourceType: DocumentShareResourceType,
  resourceId: string
): Promise<{ token: string; expiresAt: string } | null> {
  const { data, error } = await db.rpc("create_share_token", {
    p_resource_type: resourceType,
    p_resource_id: resourceId,
  });

  const row = Array.isArray(data) ? data[0] : null;
  if (error || !row?.token) {
    if (error) {
      console.error("[features/sharing/tokens] create_share_token refused:", error.code ?? "unknown");
    }
    return null;
  }

  return { token: row.token, expiresAt: row.expires_at };
}
