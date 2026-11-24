import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { errorTag, log } from "@/lib/log";
import { requestMemo } from "@/lib/auth/request-memo";
import { DEFAULT_CLINIC_TZ, resolveTimeZone, todayInTz } from "./index";
import { LIVE_DOMAINS, emptyVersions, type Versions } from "@/lib/live/domains";

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

/**
 * The zone AND the clinic's live versions in ONE statement (V2-09e 09E-04, R-18): `tenants.timezone` with the clinic's `clinic_versions` rows embedded.
 * A page that hydrates a live screen calls this BEFORE it reads the screen's data, so the versions are a lower bound of what the data holds (research
 * 2.1) at no extra call: the zone read it needs anyway carries them. `versions` is null when they could not be read (the screen then has no basis:
 * one extra re-read, never a missed one). User-JWT clients only: the embed runs under RLS (a service-role client has no grant on `clinic_versions`).
 */
export async function getTenantTimeZoneAndVersions(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<any, any, any>,
  tenantId: string
): Promise<{ zone: string; versions: Versions | null }> {
  const read = await requestMemo(`tenant-tz-v:${tenantId.toLowerCase()}`, () => readTenantTimeZoneAndVersions(db, tenantId), {
    keep: (r) => !r.fallback,
  });
  return { zone: read.zone, versions: read.versions };
}

async function readTenantTimeZoneAndVersions(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<any, any, any>,
  tenantId: string
): Promise<{ zone: string; fallback: boolean; versions: Versions | null }> {
  try {
    const { data, error } = await db.from("tenants").select("timezone, clinic_versions(domain, version)").eq("id", tenantId).maybeSingle();
    if (error) {
      log.warn({ event: "datetime.tenant_tz.failed", code: errorTag(error), tenantId });
      // The zone alone still answers (the embed may be what failed): never a wrong zone because of the versions.
      return { ...(await readTenantTimeZone(db, tenantId)), versions: null };
    }
    const row = data as { timezone?: string | null; clinic_versions?: Array<{ domain: string; version: number }> | null } | null;
    const versions = emptyVersions();
    const seen = new Set<string>();
    for (const v of row?.clinic_versions ?? []) {
      if ((LIVE_DOMAINS as readonly string[]).includes(v.domain) && Number.isSafeInteger(v.version) && v.version >= 0) {
        versions[v.domain as keyof Versions] = v.version;
        seen.add(v.domain);
      }
    }
    return { zone: resolveTimeZone(row?.timezone), fallback: false, versions: seen.size === LIVE_DOMAINS.length ? versions : null };
  } catch (err) {
    log.warn({ event: "datetime.tenant_tz.failed", code: errorTag(err), tenantId });
    return { zone: DEFAULT_CLINIC_TZ, fallback: true, versions: null };
  }
}
