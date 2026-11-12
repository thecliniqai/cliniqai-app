import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { errorTag, log } from "@/lib/log";
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
  try {
    const { data, error } = await db.from("tenants").select("timezone").eq("id", tenantId).maybeSingle();
    if (error) {
      log.warn({ event: "datetime.tenant_tz.failed", code: errorTag(error), tenantId });
      return DEFAULT_CLINIC_TZ;
    }
    return resolveTimeZone((data as { timezone?: string | null } | null)?.timezone);
  } catch (err) {
    log.warn({ event: "datetime.tenant_tz.failed", code: errorTag(err), tenantId });
    return DEFAULT_CLINIC_TZ;
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
