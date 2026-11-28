"use client";

import { useEffect } from "react";
import { hashKey, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { adjacentRanges, parseScheduleRange, type ScheduleRange } from "@/features/schedule/range";
import { clinicHeaders, ClinicChangedError, isClinicChanged, onClinicChanged } from "@/lib/live/clinic-changed";
import type { Versions } from "@/lib/live/domains";
import { useLiveCore } from "@/lib/live/provider";
import { useLiveScreen } from "@/lib/live/use-live-screen";
import { queryDomains, queryKeys } from "@/lib/query/keys";

/** The error of a refused or failed range read; the fixed text only, never a body. */
class RangeReadError extends Error {}

/** One `GET /api/schedule/range` (09E-12, R-10): the range query's read. No RSC request, no page render. */
export async function fetchScheduleRange(tenantId: string, range: { from: string; to: string }, signal?: AbortSignal, prefetch = false): Promise<ScheduleRange> {
  // A prefetch says so (`x-clinicos-prefetch: 1`): the latency lane holds the read-ahead out of a measured step. The server treats both alike.
  const headers = prefetch ? { ...clinicHeaders(tenantId), "x-clinicos-prefetch": "1" } : clinicHeaders(tenantId);
  const response = await fetch(`/api/schedule/range?from=${range.from}&to=${range.to}`, { cache: "no-store", credentials: "same-origin", signal, headers });
  // 09E-14a: this tab shows a clinic the session left: never store the answer under this clinic's key.
  if (await isClinicChanged(response)) {
    onClinicChanged();
    throw new ClinicChangedError();
  }
  if (!response.ok) throw new RangeReadError("The schedule could not be refreshed.");
  const parsed = parseScheduleRange(await response.json(), range.from, range.to);
  if (!parsed) throw new RangeReadError("The schedule could not be refreshed.");
  return parsed;
}

/**
 * The range query's options (09E-12, R-10, R-18): live (its domains are `schedule` and `queue`), and fresh until the live core says otherwise. A newer
 * version of a domain, from a signal or the 12 s heartbeat, re-reads the visible range and REMOVES the others (a prefetched week is never shown once
 * behind), so the range needs no time-based staleness: `staleTime: Infinity` keeps a prefetched week at 0 calls when it is opened (B-9).
 */
export function scheduleRangeOptions(tenantId: string, range: { from: string; to: string }, prefetch = false) {
  return {
    queryKey: queryKeys.scheduleRange(tenantId, range.from, range.to, true),
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchScheduleRange(tenantId, range, signal, prefetch),
    meta: { live: true, domains: queryDomains.schedule },
    staleTime: Infinity,
  } as const;
}

/**
 * The Schedule's range from the client data layer (09E-12, R-10): the page hydrates the visible week; changing the day or the week reads the query (one
 * `GET /api/schedule/range` when the week is not held); once the visible week has settled the weeks before and after are prefetched. The Schedule is a
 * live screen (the heartbeat runs while it is open and visible).
 */
export function useScheduleRange(tenantId: string, range: { from: string; to: string }, hydratedVersions?: Versions) {
  const queryClient = useQueryClient();
  useLiveScreen();
  const options = scheduleRangeOptions(tenantId, range);
  const query = useQuery(options);
  // The page's own read is the hydrated range's basis until a re-read replaces it.
  const core = useLiveCore();
  const hash = hashKey(options.queryKey);
  useEffect(() => {
    if (core && hydratedVersions) core.setBasis(hash, hydratedVersions);
    // Only the first (hydrated) key gets the page's versions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [core, hydratedVersions]);
  const settled = query.isSuccess && !query.isFetching;
  useEffect(() => {
    if (!settled) return;
    for (const next of adjacentRanges(range)) void prefetchRange(queryClient, tenantId, next);
  }, [settled, queryClient, tenantId, range.from, range.to]); // eslint-disable-line react-hooks/exhaustive-deps
  return query;
}

/** Reads a range into the cache unless it is held already (a prefetch: never re-reads a held range). */
export function prefetchRange(queryClient: QueryClient, tenantId: string, range: { from: string; to: string }): Promise<void> {
  return queryClient.prefetchQuery(scheduleRangeOptions(tenantId, range, true));
}
