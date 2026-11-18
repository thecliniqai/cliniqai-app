import "server-only";

import { getSystemDb } from "@/lib/supabase/system";
import { errorTag, log } from "@/lib/log";

/**
 * The Send Email hook's shared delivery record (V2-04 04-03c; R-43, proposed ADR-0005 amendment A3; T-04-23, T-04-24).
 *
 * Supabase Auth retries a hook call with the same Standard Webhooks `webhook-id`, and a retry can land on another
 * server instance, past the route's per-instance memory. These two functions record the id in the shared inbound store
 * (`ops.inbound_webhook_events`, provider `supabase_auth_hook`, migration 000037) so a delivery is sent once across
 * instances. They run on the service role (reason `auth.send_email_hook`) and are importable only from
 * `app/api/auth/send-email/route.ts` (ESLint A3 zone), which calls them only after the signature check.
 *
 * Only the provider, the id and timestamps reach the table: never an address, a code or a token.
 * The store fails OPEN: a database error is logged (`errorTag`) and reported as `unavailable`, and the route sends the
 * email anyway. An auth email is never blocked by its dedupe store.
 */
const PROVIDER = "supabase_auth_hook";

/** A `webhook-id` the store accepts; any other id skips the shared layer (the per-instance memory still applies). */
const WEBHOOK_ID = /^[A-Za-z0-9_.-]{1,128}$/;

/**
 * - `process`: first delivery of this id (or the earlier attempt failed / never finished): send it.
 * - `duplicate`: this id was delivered: answer 200, send nothing.
 * - `in_flight`: another instance is sending it right now: answer a hook error so Supabase Auth retries later.
 * - `skipped`: the id has an unexpected shape: no shared record (send).
 * - `unavailable`: the store failed: send anyway (fail open).
 */
export type AuthHookDeliveryState = "process" | "duplicate" | "in_flight" | "skipped" | "unavailable";

export function isRecordableWebhookId(webhookId: string): boolean {
  return WEBHOOK_ID.test(webhookId);
}

export async function authHookDeliveryBegin(webhookId: string): Promise<AuthHookDeliveryState> {
  if (!isRecordableWebhookId(webhookId)) return "skipped";
  try {
    const db = getSystemDb("auth.send_email_hook");
    const { data, error } = await db.rpc("inbound_webhook_begin", { p_provider: PROVIDER, p_dedupe_key: webhookId });
    if (error) throw error;
    if (data === "process" || data === "duplicate" || data === "in_flight") return data;
    throw new Error("unexpected_begin_state");
  } catch (err) {
    log.warn({ event: "auth.email.dedupe_unavailable", module: "auth.email", code: errorTag(err) });
    return "unavailable";
  }
}

/** Records the outcome: `processed` (later retries are duplicates) or `failed` (the next retry sends). Never throws. */
export async function authHookDeliveryFinish(webhookId: string, outcome: "processed" | "failed"): Promise<void> {
  if (!isRecordableWebhookId(webhookId)) return;
  try {
    const db = getSystemDb("auth.send_email_hook");
    const { error } = await db.rpc("inbound_webhook_finish", {
      p_provider: PROVIDER,
      p_dedupe_key: webhookId,
      p_outcome: outcome,
    });
    if (error) throw error;
  } catch (err) {
    log.warn({ event: "auth.email.dedupe_unavailable", module: "auth.email", code: errorTag(err) });
  }
}
