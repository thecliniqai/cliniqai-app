"use client";

import { useState } from "react";
import { OctagonAlert, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { notify } from "@/components/ui/toast";
import { QueueRow } from "@/components/clinical/queue-row";
import { StatusChip } from "@/components/clinical/status-chip";
import { VitalsSummary } from "@/components/clinical/vitals-summary";
import { formatClinicTime } from "@/lib/datetime/format";
import { useCommand } from "@/lib/commands/use-command";
import { checkInVisit } from "@/features/queue/actions";
import { formatRupees, waitNow, type TodayRow } from "@/features/today/schema";

/**
 * One Today row (V2-08 08-03a; 06-UI-SPEC §7): the V2-06 `QueueRow` fed from a {@link TodayRow}. The row's own action in this
 * plan is Check in (booked, confirmed or no-show visit of today): one tap, one `check_in_visit` command through
 * `useCommand` (one `client_request_id`, 15 s timeout, one retry). The board moves the row to Waiting at once (`onOptimistic`)
 * and takes it back (`onRollback`) when the command is refused, with a toast that offers Retry. Opening the row selects it
 * (`?visit=`); the name is the row's link.
 */
export interface TodayRowViewProps {
  row: TodayRow;
  selected: boolean;
  /** Changes when the row's status changed in a refresh: the row flashes once. */
  flashKey?: number | null;
  /** The wait ticks from these two clocks (`waitNow`). */
  clock: { received: number; now: number } | null;
  onOpen: (visitId: string) => void;
  onOptimistic: (row: TodayRow) => void;
  onRollback: (visitId: string) => void;
  onCheckedIn: () => void;
}

export function originText(row: Pick<TodayRow, "origin" | "time" | "status">): string | null {
  if (row.origin === "walk_in") return "Walk-in";
  if (row.time && row.status !== "booked" && row.status !== "confirmed" && row.status !== "no_show") {
    return `Appt ${formatClinicTime(row.time).replace(" ", " ")}`;
  }
  return null;
}

export function AllergyFlag() {
  return (
    <span
      data-allergy-flag=""
      className="inline-flex h-pill shrink-0 items-center gap-1 rounded-pill bg-danger-bg px-1.75 text-caption font-semibold whitespace-nowrap text-danger-fg"
    >
      <OctagonAlert aria-hidden="true" strokeWidth={2} className="size-3" />
      Allergies on file
    </span>
  );
}

export function TodayRowView({ row, selected, flashKey, clock, onOpen, onOptimistic, onRollback, onCheckedIn }: TodayRowViewProps) {
  const command = useCommand();
  const [busy, setBusy] = useState(false);

  const checkIn = async () => {
    setBusy(true);
    onOptimistic(row);
    // A failed attempt keeps its id, so running this again (the toast's Retry) is a retry of the same command.
    const result = await command.run((clientRequestId) => checkInVisit(row.visitId, "normal", clientRequestId));
    setBusy(false);
    if (result.ok) {
      onCheckedIn();
      return;
    }
    onRollback(row.visitId);
    notify.error(`Couldn't check in ${row.name}. ${result.error.message}`, { retry: () => void checkIn() });
  };

  const wait = clock && row.waitMinutes != null ? waitNow(row, clock.received, clock.now) : row.waitMinutes;
  const origin = originText(row);
  const sexAge = [row.age, row.sex].filter(Boolean).join(" · ");
  const meta = [sexAge, row.doctorName, origin].filter(Boolean).join(" · ");
  const inQueue = row.status === "waiting" || row.status === "in_consultation";
  const flags = (
    <>
      {(row.status === "no_show" || row.status === "cancelled") && <StatusChip status={row.status} />}
      {inQueue && (row.vitals || row.vitalsPending) && <VitalsSummary vitals={row.vitals} />}
      {row.hasAllergy && <AllergyFlag />}
      {row.balanceDue != null && row.balanceDue > 0 && (
        <span className="font-semibold text-fg tabular-nums">{formatRupees(row.balanceDue)} due</span>
      )}
    </>
  );

  return (
    <QueueRow
      name={row.name}
      onOpen={() => onOpen(row.visitId)}
      token={row.token}
      time={row.time}
      status={row.status}
      balanceDue={row.balanceDue}
      waitMinutes={wait}
      meta={meta}
      flags={flags}
      selected={selected}
      flashKey={flashKey}
      actions={
        row.actions.includes("check_in") ? (
          <Button
            type="button"
            size="sm"
            variant="primary"
            requiresNetwork
            loading={busy}
            startIcon={<UserCheck aria-hidden="true" />}
            onClick={() => void checkIn()}
            aria-label={`Check in ${row.name}`}
            data-row-action="check-in"
          >
            Check in
          </Button>
        ) : undefined
      }
    />
  );
}
