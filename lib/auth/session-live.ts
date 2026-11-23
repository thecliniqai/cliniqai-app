import "server-only";

import type { SensitiveAction } from "@/lib/auth/sensitive-actions";
import { errorTag, log } from "@/lib/log";
import { getRequestId } from "@/lib/log/request-id";

/**
 * V2-09d 09D-01a (ruling R-S, AUTH_REDESIGN §3.5 step 3): whether the caller's session is still live, from
 * `public.session_is_live()` (migration 000087: the JWT's `session_id` has an unexpired `auth.sessions` row of the caller).
 * The local JWT check (`getClaims()`) cannot see a session revoked elsewhere while its access token is unexpired; this one
 * call can. Used only by the sensitive actions (`lib/auth/sensitive-actions.ts`).
 *
 * - `live`: the RPC answered `true`;
 * - `revoked`: it answered anything else (signed out elsewhere, password changed or reset, removed; or a token without a
 *   session id): the caller is treated as signed out;
 * - `unavailable`: the call failed (never a sign-out: the caller answers its generic failure / 503).
 */
export type SessionLiveness = "live" | "revoked" | "unavailable";

type RpcClient = { rpc: (fn: "session_is_live") => PromiseLike<{ data: unknown; error: unknown }> };

export async function sessionLiveness(db: unknown, action: SensitiveAction): Promise<SessionLiveness> {
  let data: unknown;
  let error: unknown;
  try {
    ({ data, error } = await (db as RpcClient).rpc("session_is_live"));
  } catch (err) {
    error = err;
  }
  if (error) {
    log.warn({ event: "auth.session_live.unavailable", action, code: errorTag(error), requestId: await getRequestId() });
    return "unavailable";
  }
  if (data === true) return "live";
  log.info({ event: "auth.session_live.refused", action, requestId: await getRequestId() });
  return "revoked";
}
