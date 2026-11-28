"use client";

import { useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { refreshWhenReachable } from "@/lib/pwa/safe-refresh";
import { isRowChanged } from "@/lib/errors/row-changed";
import { useLiveCore } from "./provider";

/**
 * What a screen does when a command it sent was refused as stale (`ROW_CHANGED`, 09E-07, R-19): the visit or invoice moved on, so what the screen shows is
 * behind the database. It asks the live layer to look now (`wake`: the clinic's versions are read at once and every active query behind them is re-read, the
 * same path a signal takes), re-reads the live queries that are already known to be stale-able (Today's board), and, on the Schedule (a server-rendered
 * screen), refreshes the route. Returns true when the error was a stale-write refusal (the caller then shows the fixed message and does not offer a retry of
 * the same version: the retry would be refused again).
 */
export function useRowChanged(): (error: { reason?: string } | null | undefined) => boolean {
  const core = useLiveCore();
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  return useCallback(
    (error) => {
      if (!isRowChanged(error)) return false;
      core?.wake();
      void queryClient.invalidateQueries({ predicate: (q) => q.meta?.live === true }, { cancelRefetch: false });
      if (pathname.startsWith("/schedule")) void refreshWhenReachable(() => router.refresh());
      return true;
    },
    [core, queryClient, router, pathname]
  );
}
