import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { errorTag, log } from "@/lib/log";
import { getRequestId } from "@/lib/log/request-id";
import { parseSessionBootstrap, type SessionBootstrap } from "./bootstrap";

/**
 * The session bootstrap read (V2-09e 09E-13, R-13): one `public.session_bootstrap` call (STABLE INVOKER) on the user's own JWT client, so RLS and the
 * function's active-membership check decide what comes back; the clinic is the session's (the caller passes the tenant the session resolved, never a
 * request's input). The answer is checked against the allow-list (`parseSessionBootstrap`); anything else, NULL (not an active member) or a failed call
 * is not used and is logged by tag only. No service-role client, no server cache (ADR-019): every call reads the database.
 * PR 2 review N5: NULL is the database's refusal (not an active member, or since 000133 not the session's active, full clinic), an answer rather than an
 * outage: `refused`, logged at info, or not at all for a `speculative` read (the layout's early read for the device's pinned clinic, which may name a
 * clinic the user left: its answer is used only when the session resolves to that clinic). A failed call or a wrong shape is `failed`, logged as an error.
 */
export type BootstrapRead = { ok: true; bootstrap: SessionBootstrap } | { ok: false; reason: "refused" | "failed" };

export async function readSessionBootstrap(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<any, any, any>,
  tenantId: string,
  options: { speculative?: boolean } = {},
): Promise<BootstrapRead> {
  const { data, error } = await db.rpc("session_bootstrap", { p_tenant_id: tenantId });
  if (error) {
    log.error({ event: "session.bootstrap.failed", code: errorTag(error), requestId: await getRequestId(), tenantId });
    return { ok: false, reason: "failed" };
  }
  if (data === null) {
    if (!options.speculative) log.info({ event: "session.bootstrap.refused", requestId: await getRequestId(), tenantId });
    return { ok: false, reason: "refused" };
  }
  const parsed = parseSessionBootstrap(data);
  if (!parsed) {
    log.error({ event: "session.bootstrap.failed", code: "shape", requestId: await getRequestId(), tenantId });
    return { ok: false, reason: "failed" };
  }
  return { ok: true, bootstrap: parsed };
}
