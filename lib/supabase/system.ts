import "server-only";

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { publicEnv } from "@/lib/env";
import { serverEnv } from "@/lib/env-server";
import { log } from "@/lib/log";

/**
 * The one service-role client factory (V2-03 03-02, P1-34, ADR-0005 D2). The service role bypasses RLS, so it is
 * reachable only from the paths ADR-0005 allows (`lib/jobs/**` internals, `features/<domain>/system.ts`,
 * `app/api/{jobs,webhooks}/**`) and the exception register (`app/api/v1/**` + `lib/api/**` until P1-37;
 * `lib/webhooks/**`, `app/api/cron/**` until V2-04; V2-04 04-03a deleted `lib/messaging/dispatcher.ts` and the
 * `cron.dispatch_communications` reason with its route: patient messages go through the job runner). 03-04 enforces that list in ESLint.
 *
 * Every call names a closed {@link SystemDbReason} and writes exactly one log line
 * `{ event: "db.system_acquired", reason, module }`: the reason and its owning module only, never tenant data or PHI.
 * A reason outside the closed set (a cast, `any`) throws before any client exists. Request-path code never falls back
 * to this client when its own client fails (ADR-0005 D2).
 */

/** Each reason a system client may be acquired for, mapped to the module that owns the call site. */
export const REASON_OWNER = {
  api_v1: "app/api/v1",
  "cron.webhooks": "app/api/cron/webhooks",
  "webhook.messaging_inbound": "app/api/webhooks/messaging",
  // V2-04 04-02: the job runner pass (`runJobs` in lib/jobs/internal/runner.ts claims and finishes jobs through it).
  "jobs.run": "app/api/jobs/run",
  "share.sign": "features/sharing/system",
  "share.receipt_pdf": "features/sharing/system",
  "share.reschedule_notify": "features/sharing/system",
  "billing.record_payment_system": "features/billing/system",
} as const satisfies Record<string, string>;

export type SystemDbReason = keyof typeof REASON_OWNER;
export type SystemDb = ReturnType<typeof createClient<Database>>;

export const SYSTEM_DB_EVENT = "db.system_acquired";

let cached: { url: string; key: string; client: SystemDb } | null = null;

export function isSystemDbReason(value: unknown): value is SystemDbReason {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(REASON_OWNER, value);
}

export function getSystemDb(reason: SystemDbReason): SystemDb {
  if (!isSystemDbReason(reason)) {
    throw new Error("getSystemDb: unknown reason");
  }

  const key = serverEnv().SUPABASE_SECRET_KEY;
  if (!key) {
    throw new Error("SUPABASE_SECRET_KEY is required for the system client");
  }
  const url = publicEnv.NEXT_PUBLIC_SUPABASE_URL;

  if (!cached || cached.url !== url || cached.key !== key) {
    cached = {
      url,
      key,
      client: createClient<Database>(url, key, {
        auth: { autoRefreshToken: false, persistSession: false },
      }),
    };
  }

  log.info({ event: SYSTEM_DB_EVENT, reason, module: REASON_OWNER[reason] });
  return cached.client;
}
