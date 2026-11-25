"use client";

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLiveScreen } from "@/lib/live/use-live-screen";
import { queryKeys } from "@/lib/query/keys";

/**
 * Today's live updates (V2-08 08-03a, R-10; rebuilt on the shell's live convergence by V2-09e 09E-04, R-18). Today registers as a live screen
 * (`useLiveScreen`: the 12 s heartbeat of the live state runs while it is open and visible); its query carries its domains (`queryDomains.today`), so a
 * newer clinic version of one of them, from a signal or from a check, re-reads the board (one `GET /api/today/board`, coalesced 400 ms) and a version
 * that did not move re-reads nothing. The old 20 s full-board poll and its own channel are gone: the shell owns the one channel of the clinic
 * (`lib/live/provider.tsx`). `refreshNow` is for the user's own writes (a vitals save, a payment): it invalidates Today's query and replaces a read
 * already in flight (it may predate the write).
 */
export function useTodayLive(tenantId: string): { refreshNow: () => void } {
  const queryClient = useQueryClient();
  useLiveScreen();
  const refreshNow = useCallback(() => {
    // 09E-14a (L3): an own write: a read in flight may predate it, so it is replaced by one that starts after.
    void queryClient.invalidateQueries({ queryKey: queryKeys.todayAll(tenantId) }, { cancelRefetch: true });
  }, [queryClient, tenantId]);
  return { refreshNow };
}
