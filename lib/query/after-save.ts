"use client";

import { useCallback } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { TodayBoard } from "@/features/today/schema";

/**
 * What a confirmed save does to the screens after the database answered (V2-09e 09E-08, R-11): no Server Action revalidates a path any more, so each
 * screen that can show the change is told here, from the command's own result.
 *
 * - Today's boards (the query layer, `[clinic, "today", mode]`): a status change the answer fully describes is written with `setQueryData`
 *   (`patchTodayBoards`); a change that adds a row or moves one off the day (a walk-in, a booking, a reschedule, a payment) marks the boards stale, and
 *   the one `GET /api/today/board` read replaces them (`staleToday`; the same read a live signal makes). Other devices converge through the live layer.
 * - The Schedule's ranges (09E-12, `[clinic, "schedule", from, to, mode]`): every confirmed save marks them stale; the visible one is read again (one
 *   `GET /api/schedule/range`, no page render) and the others are read when shown. A sheet that closes by dropping its URL parameter renders the page
 *   once anyway (`closing`): that render hands the page's fresh range to the query.
 */
const isTodayQuery = (key: readonly unknown[]): boolean => key[1] === "today";
const isScheduleQuery = (key: readonly unknown[]): boolean => key[1] === "schedule";

/** Marks every cached Schedule range stale and reads the visible one (one GET). An own write: a read in flight may predate it, so it is replaced. */
export function staleSchedule(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ predicate: (q) => isScheduleQuery(q.queryKey) }, { cancelRefetch: true });
}

/** Writes `patch` into every cached Today board of the clinic. */
export function patchTodayBoards(queryClient: QueryClient, patch: (board: TodayBoard) => TodayBoard): void {
  queryClient.setQueriesData<TodayBoard>({ predicate: (q) => isTodayQuery(q.queryKey) }, (old) => (old ? patch(old) : old));
}

/** Marks every cached Today board stale and reads the active one (one GET). */
export function staleToday(queryClient: QueryClient): void {
  // 09E-14a (L3): the user's own write: a read already in flight may have started before it committed, so it is cancelled and read again after it (the live core's basis is taken at each fetch start, so no newer signal is lost).
  void queryClient.invalidateQueries({ predicate: (q) => isTodayQuery(q.queryKey) }, { cancelRefetch: true });
}

export interface AfterSaveOptions {
  /**
   * The caller is a sheet or dialog opened by a URL parameter and closes by dropping it (`router.replace`): that navigation reads the route again, so no
   * second refresh is made (one RSC request for the save, not two).
   */
  closing?: boolean;
}

export interface AfterSave {
  /** A status change the answer describes: written into the boards; the Schedule's ranges are read again (unless the caller closes by URL). */
  patchToday: (patch: (board: TodayBoard) => TodayBoard, options?: AfterSaveOptions) => void;
  /** A change that adds or moves rows: the boards and the Schedule's ranges are read again (the ranges unless the caller closes by URL). */
  refreshScreens: (options?: AfterSaveOptions) => void;
}

export function useAfterSave(): AfterSave {
  const queryClient = useQueryClient();
  const patchToday = useCallback(
    (patch: (board: TodayBoard) => TodayBoard, options?: AfterSaveOptions) => {
      patchTodayBoards(queryClient, patch);
      if (!options?.closing) staleSchedule(queryClient);
    },
    [queryClient],
  );
  const refreshScreens = useCallback(
    (options?: AfterSaveOptions) => {
      staleToday(queryClient);
      if (!options?.closing) staleSchedule(queryClient);
    },
    [queryClient],
  );
  return { patchToday, refreshScreens };
}
