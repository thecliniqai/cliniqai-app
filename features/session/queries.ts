import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { errorTag, log } from "@/lib/log";
import { getRequestId } from "@/lib/log/request-id";
import { parseSessionBootstrap, type SessionBootstrap } from "./bootstrap";

/**
 * The session bootstrap read (V2-09e 09E-13, R-13): one `public.session_bootstrap` call (STABLE INVOKER) on the user's own JWT client, so RLS and the
 * function's active-membership check decide what comes back; the clinic is the session's (the caller passes the tenant the session resolved, never a
 * request's input). The answer is checked against the allow-list (`parseSessionBootstrap`); anything else, NULL (not an active member) or a failed call
 * is `null` and is logged by tag only. No service-role client, no server cache (ADR-019): every call reads the database.
 */
export async function readSessionBootstrap(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<any, any, any>,
  tenantId: string,
): Promise<SessionBootstrap | null> {
  const { data, error } = await db.rpc("session_bootstrap", { p_tenant_id: tenantId });
  if (error) {
    log.error({ event: "session.bootstrap.failed", code: errorTag(error), requestId: await getRequestId(), tenantId });
    return null;
  }
  const parsed = parseSessionBootstrap(data);
  if (!parsed) {
    log.error({ event: "session.bootstrap.failed", code: data === null ? "empty" : "shape", requestId: await getRequestId(), tenantId });
    return null;
  }
  return parsed;
}
