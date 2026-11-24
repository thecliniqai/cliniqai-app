import { QueryClient } from "@tanstack/react-query";

/**
 * The client data layer's defaults (V2-09e 09E-03, R-14). Memory only: there is no persister and no storage (lint bans the packages).
 * Reads retry once; mutations never retry on their own (the command helper retries with the same request id); active queries refetch
 * on focus and on reconnect when they are stale.
 */
export const QUERY_STALE_MS = 30_000;
/** A query nobody watches is dropped after this long (memory, and a screen left behind keeps no data). */
export const QUERY_GC_MS = 5 * 60_000;

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: QUERY_STALE_MS,
        gcTime: QUERY_GC_MS,
        retry: 1,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        networkMode: "online",
      },
      mutations: { retry: 0, networkMode: "online" },
    },
  });
}
