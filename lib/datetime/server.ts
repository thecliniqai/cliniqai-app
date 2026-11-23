import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { errorTag, log } from "@/lib/log";
import { requestMemo } from "@/lib/auth/request-memo";
import { DEFAULT_CLINIC_TZ, resolveTimeZone, todayInTz } from "./index";

/**
 * The tenant's IANA zone from `tenants.timezone` (V2-03 03-05, P1-21). `db` is the caller's client (the user-JWT
 * client from the service context, so RLS admits only a tenant the caller belongs to). A missing row, an unusable
 * value or a query failure yields {@link DEFAULT_CLINIC_TZ}, the zone every tenant has by default; a failure is
 * logged by tag only.
 */
export async function getTenantTimeZone(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<any, any, any>,
  tenantId: string
): Promise<string> {
  // V2-09d: once per request and clinic (`requestMemo`; nothing is memoised outside a request, e.g. in a job). 09D-01a
  // (A-10): a failed read's fallback answers its own callers but is not kept, so the next reader in the request asks again.
  const read = await requestMemo(`tenant-tz:${tenantId.toLowerCase()}`, () => readTenantTimeZone(db, tenantId), {
    keep: (r) => !r.fallback,
  });
  return read.zone;
}

async function readTenantTimeZone(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<any, any, any>,
  tenantId: string
): Promise<{ zone: string; fallback: boolean }> {
  try {
    const { data, error } = await db.from("tenants").select("timezone").eq("id", tenantId).maybeSingle();
    if (error) {
      log.warn({ event: "datetime.tenant_tz.failed", code: errorTag(error), tenantId });
      return { zone: DEFAULT_CLINIC_TZ, fallback: true };
    }
    return { zone: resolveTimeZone((data as { timezone?: string | null } | null)?.timezone), fallback: false };
  } catch (err) {
    log.warn({ event: "datetime.tenant_tz.failed", code: errorTag(err), tenantId });
    return { zone: DEFAULT_CLINIC_TZ, fallback: true };
  }
}

/** The tenant's current date and zone in one call. */
export async function getTenantToday(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<any, any, any>,
  tenantId: string,
  now: Date | number = Date.now()
): Promise<{ timeZone: string; today: string }> {
  const timeZone = await getTenantTimeZone(db, tenantId);
  return { timeZone, today: todayInTz(timeZone, now) };
}
