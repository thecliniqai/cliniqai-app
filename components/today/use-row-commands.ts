"use client";

import { useRouter } from "next/navigation";
import { notify } from "@/components/ui/toast";
import { useRowChanged } from "@/lib/live/use-row-changed";
import { useReversibleCommand } from "@/lib/query/mutations";
import { checkInVisit, startConsultation } from "@/features/queue/actions";
import type { TodayRow } from "@/features/today/schema";
import type { CommandVersions } from "@/lib/commands/command-versions";

/**
 * The commands a Today row sends (V2-08 08-03b, R-1, R-6): Check in (`check_in_visit`) and Start consultation / Call in
 * (`start_consultation`: checks a booked visit in first and opens the consult in one transaction). Each is one command through
 * `useCommand` (one `client_request_id` per submit, a 15 s timeout, one retry with the same id); a refusal shows a toast
 * with Retry that sends the same id again. A row and the doctor's Next card share these hooks.
 */
export interface CheckInHooks {
  /** The row moves to Waiting (or With doctor, for a start) at once. */
  onOptimistic: (row: TodayRow, to?: "waiting" | "in_consultation") => void;
  /** The server refused or could not be reached: the row moves back. */
  onRollback: (visitId: string) => void;
  /** The command answered: its result goes into the board (no re-read). After a refused stale version it is called with no result and the board is re-read. */
  onDone: (result?: { visitId: string; tokenNumber: number; rowVersion?: number; versions?: CommandVersions }) => void;
}

/**
 * Check in is a reversible save (09E-08, R-11): the row moves to Waiting before the answer, the answer is written into the board's query
 * (`onDone`), and a refusal (a stale version included) takes the row back with the fixed text. A stale version has no Retry (the same version
 * would be refused again); every other failure keeps the request id, so Retry is the same command.
 */
export function useCheckIn(row: TodayRow, hooks: CheckInHooks) {
  const rowChanged = useRowChanged();
  const mutation = useReversibleCommand<TodayRow, { tokenNumber: number; queueTokenId: string; replayed: boolean; rowVersion?: number; versions?: CommandVersions }>({
    // The version is the one the row shows (09E-07, R-19).
    call: (r, clientRequestId) => checkInVisit(r.visitId, "normal", clientRequestId, r.rowVersion),
    keyOf: (r) => `${r.visitId}:${r.rowVersion}`,
    apply: (r) => {
      hooks.onOptimistic(r);
      return () => hooks.onRollback(r.visitId);
    },
    onValue: (value, r) => hooks.onDone({ visitId: r.visitId, tokenNumber: value.tokenNumber, rowVersion: value.rowVersion, versions: value.versions }),
    onFailure: (error, r, retry) => {
      // A visit that moved on elsewhere: the row went back, the board is re-read, the fixed message says why. No Retry.
      if (rowChanged(error)) {
        hooks.onDone();
        notify.error(`Couldn't check in ${r.name}. ${error.message}`);
        return;
      }
      notify.error(`Couldn't check in ${r.name}. ${error.message}`, { retry });
    },
  });
  return { run: () => void mutation.run(row), busy: mutation.pending };
}

/**
 * Start consultation / Call in (R-1): one command that checks a booked visit in first and opens the consult. The consult is where the doctor goes,
 * so success navigates; the row shows With doctor at once and comes back with the fixed text on a refusal (reversible, R-11).
 */
export function useStart(row: TodayRow, hooks: Pick<CheckInHooks, "onOptimistic" | "onRollback"> & { onStarted?: () => void }) {
  const router = useRouter();
  const rowChanged = useRowChanged();
  const mutation = useReversibleCommand<TodayRow, unknown>({
    call: (r, clientRequestId) => startConsultation(r.visitId, clientRequestId, r.rowVersion),
    keyOf: (r) => `${r.visitId}:${r.rowVersion}`,
    apply: (r) => {
      hooks.onOptimistic(r, "in_consultation");
      return () => hooks.onRollback(r.visitId);
    },
    onValue: (_value, r) => {
      hooks.onStarted?.();
      router.push(`/consultation/${r.visitId}`);
    },
    onFailure: (error, r, retry) => {
      if (rowChanged(error)) {
        hooks.onStarted?.();
        notify.error(`Couldn't start ${r.name}'s consultation. ${error.message}`);
        return;
      }
      notify.error(`Couldn't start ${r.name}'s consultation. ${error.message}`, { retry });
    },
  });
  return { run: () => void mutation.run(row), busy: mutation.pending };
}

/** "Call in" for a patient already waiting; "Start consultation" for one who has not been checked in (R-1). */
export function startLabel(row: Pick<TodayRow, "status">): string {
  return row.status === "waiting" ? "Call in" : "Start consultation";
}
