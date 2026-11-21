"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { notify } from "@/components/ui/toast";
import { useCommand } from "@/lib/commands/use-command";
import { checkInVisit, startConsultation } from "@/features/queue/actions";
import type { TodayRow } from "@/features/today/schema";

/**
 * The commands a Today row sends (V2-08 08-03b, R-1, R-6): Check in (`check_in_visit`) and Start consultation / Call in
 * (`start_consultation`: checks a booked visit in first and opens the consult in one transaction). Each is one command through
 * `useCommand` (one `client_request_id` per submit, a 15 s timeout, one retry with the same id); a refusal shows a toast
 * with Retry that sends the same id again. A row and the doctor's Next card share these hooks.
 */
export interface CheckInHooks {
  /** The row moves to Waiting at once. */
  onOptimistic: (row: TodayRow) => void;
  /** The server refused or could not be reached: the row moves back. */
  onRollback: (visitId: string) => void;
  onDone: () => void;
}

export function useCheckIn(row: TodayRow, hooks: CheckInHooks) {
  const command = useCommand();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    hooks.onOptimistic(row);
    // A failed attempt keeps its id, so running this again (the toast's Retry) is a retry of the same command.
    const result = await command.run((clientRequestId) => checkInVisit(row.visitId, "normal", clientRequestId));
    setBusy(false);
    if (result.ok) {
      hooks.onDone();
      return;
    }
    hooks.onRollback(row.visitId);
    notify.error(`Couldn't check in ${row.name}. ${result.error.message}`, { retry: () => void run() });
  };
  return { run, busy };
}

export function useStart(row: TodayRow, onStarted?: () => void) {
  const router = useRouter();
  const command = useCommand();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    const result = await command.run((clientRequestId) => startConsultation(row.visitId, clientRequestId));
    setBusy(false);
    if (result.ok) {
      onStarted?.();
      router.push(`/consultation/${row.visitId}`);
      return;
    }
    notify.error(`Couldn't start ${row.name}'s consultation. ${result.error.message}`, { retry: () => void run() });
  };
  return { run, busy };
}

/** "Call in" for a patient already waiting; "Start consultation" for one who has not been checked in (R-1). */
export function startLabel(row: Pick<TodayRow, "status">): string {
  return row.status === "waiting" ? "Call in" : "Start consultation";
}
