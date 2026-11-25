"use client";

import { useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { TodayBoard } from "@/features/today/schema";

/**
 * What a confirmed save does to the screens after the database answered (V2-09e 09E-08, R-11): no Server Action revalidates a path any more, so each
 * screen that can show the change is told here, from the command's own result.
 *
 * - Today's boards (the query layer, `[clinic, "today", mode]`): a status change the answer fully describes is written with `setQueryData`
 *   (`patchTodayBoards`); a change that adds a row or moves one off the day (a walk-in, a booking, a reschedule, a payment) marks the boards stale, and
 *   the one `GET /api/today/board` read replaces them (`staleToday`; the same read a live signal makes). Other devices converge through the live layer.
 * - The Schedule is still a server-rendered screen until 09E-12 puts it on the query layer: while it is the screen on show, the save refreshes its route
 *   (one RSC request). That is the only place a save still re-renders a page.
 */
const isTodayQuery = (key: readonly unknown[]): boolean => key[1] === "today";

/** Writes `patch` into every cached Today board of the clinic. */
export function patchTodayBoards(queryClient: QueryClient, patch: (board: TodayBoard) => TodayBoard): void {
  queryClient.setQueriesData<TodayBoard>({ predicate: (q) => isTodayQuery(q.queryKey) }, (old) => (old ? patch(old) : old));
}

/** Marks every cached Today board stale and reads the active one (one GET). */
export function staleToday(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ predicate: (q) => isTodayQuery(q.queryKey) }, { cancelRefetch: false });
}

export interface AfterSaveOptions {
  /**
   * The caller is a sheet or dialog opened by a URL parameter and closes by dropping it (`router.replace`): that navigation reads the route again, so no
   * second refresh is made (one RSC request for the save, not two).
   */
  closing?: boolean;
}

export interface AfterSave {
  /** A status change the answer describes: written into the boards. On the Schedule the route is refreshed too (unless the caller closes by URL). */
  patchToday: (patch: (board: TodayBoard) => TodayBoard, options?: AfterSaveOptions) => void;
  /** A change that adds or moves rows: the boards are read again. On the Schedule the route is refreshed too (unless the caller closes by URL). */
  refreshScreens: (options?: AfterSaveOptions) => void;
}

export function useAfterSave(): AfterSave {
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const onSchedule = pathname.startsWith("/schedule");
  const patchToday = useCallback(
    (patch: (board: TodayBoard) => TodayBoard, options?: AfterSaveOptions) => {
      patchTodayBoards(queryClient, patch);
      if (onSchedule && !options?.closing) router.refresh();
    },
    [queryClient, router, onSchedule],
  );
  const refreshScreens = useCallback(
    (options?: AfterSaveOptions) => {
      staleToday(queryClient);
      if (onSchedule && !options?.closing) router.refresh();
    },
    [queryClient, router, onSchedule],
  );
  return { patchToday, refreshScreens };
}
