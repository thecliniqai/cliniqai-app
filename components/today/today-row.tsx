"use client";

import Link from "next/link";
import { Activity, CalendarPlus, HandCoins, OctagonAlert, Stethoscope, UserCheck } from "lucide-react";
import { Button, buttonClassName } from "@/components/ui/button";
import { QueueRow } from "@/components/clinical/queue-row";
import { StatusChip } from "@/components/clinical/status-chip";
import { VitalsSummary } from "@/components/clinical/vitals-summary";
import { formatClinicTime } from "@/lib/datetime/format";
import { chipBalance, formatRupees, rowButtons, waitNow, type RowButton, type TodayMode, type TodayRow } from "@/features/today/schema";
import { RowMenu, rowMenuItems } from "@/components/front-desk/row-menu";
import { startLabel, useCheckIn, useStart } from "./use-row-commands";

/**
 * One Today row (V2-08 08-03a, 08-03b; 06-UI-SPEC §7): the V2-06 `QueueRow` fed from a {@link TodayRow}. The buttons come
 * only from the state machine's `actions` for the caller's role (`rowButtons`, R-7), arranged by the mode: Check in and
 * Collect at the desk, Record vitals first in triage, Call in / Start consultation / Open consult for the doctor.
 * Move, Mark as no-show and Cancel are in the ⋯ menu (`RowMenu`, V2-08 08-04b). Check in and Start are single commands through `useCommand` (`use-row-commands.ts`); Check in moves the row to Waiting
 * at once (`onOptimistic`) and takes it back (`onRollback`) when refused. Opening the row selects it (`?visit=`).
 */
export interface TodayRowViewProps {
  row: TodayRow;
  mode: TodayMode;
  /** The role holds `consultations:edit`. */
  canConsult: boolean;
  selected: boolean;
  /** The doctor's Next card carries this row's Call in; the row shows the "Next" caption instead. */
  next?: boolean;
  /** Changes when the row's status changed in a refresh: the row flashes once. */
  flashKey?: number | null;
  /** The wait ticks from these two clocks (`waitNow`). */
  clock: { received: number; now: number } | null;
  onOpen: (visitId: string) => void;
  onOptimistic: (row: TodayRow) => void;
  onRollback: (visitId: string) => void;
  onChanged: () => void;
  onRecordVitals: (row: TodayRow) => void;
  onCollect: (row: TodayRow) => void;
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

export function PriorityFlag({ priority }: { priority: TodayRow["priority"] }) {
  if (priority !== "urgent" && priority !== "vip") return null;
  return (
    <span
      data-priority-flag={priority}
      className={
        "inline-flex h-pill shrink-0 items-center rounded-pill px-1.75 text-caption font-semibold whitespace-nowrap " +
        (priority === "urgent" ? "bg-danger-bg text-danger-fg" : "bg-info-bg text-info-fg")
      }
    >
      {priority === "urgent" ? "Urgent" : "VIP"}
    </span>
  );
}

/** The buttons of a row (or of the Next card), wired to their commands. */
export function RowButtons({
  row,
  buttons,
  onOptimistic,
  onRollback,
  onChanged,
  onRecordVitals,
  onCollect,
}: Pick<TodayRowViewProps, "row" | "onOptimistic" | "onRollback" | "onChanged" | "onRecordVitals" | "onCollect"> & {
  buttons: readonly RowButton[];
}) {
  const checkIn = useCheckIn(row, { onOptimistic, onRollback, onDone: onChanged });
  const start = useStart(row, onChanged);
  const variant = (b: RowButton) => (b.primary ? "primary" : "secondary");
  return (
    <>
      {buttons.map((b) => {
        switch (b.kind) {
          case "check_in":
            return (
              <Button
                key={b.kind}
                type="button"
                size="sm"
                variant={variant(b)}
                requiresNetwork
                loading={checkIn.busy}
                startIcon={<UserCheck aria-hidden="true" />}
                onClick={() => void checkIn.run()}
                aria-label={`Check in ${row.name}`}
                data-row-action="check-in"
              >
                Check in
              </Button>
            );
          case "start":
            return (
              <Button
                key={b.kind}
                type="button"
                size="sm"
                variant={variant(b)}
                requiresNetwork
                loading={start.busy}
                startIcon={<Stethoscope aria-hidden="true" />}
                onClick={() => void start.run()}
                aria-label={`${startLabel(row)} ${row.name}`}
                data-row-action="start"
              >
                {startLabel(row)}
              </Button>
            );
          case "open_consult":
            return (
              <Link
                key={b.kind}
                href={`/consultation/${row.visitId}`}
                className={buttonClassName({ size: "sm", variant: variant(b) })}
                aria-label={`Open consult for ${row.name}`}
                data-row-action="open-consult"
              >
                <Stethoscope aria-hidden="true" className="size-4" />
                Open consult
              </Link>
            );
          case "record_vitals":
            return (
              <Button
                key={b.kind}
                type="button"
                size="sm"
                variant={variant(b)}
                startIcon={<Activity aria-hidden="true" />}
                onClick={() => onRecordVitals(row)}
                aria-label={`Record vitals for ${row.name}`}
                data-row-action="record-vitals"
              >
                Record vitals
              </Button>
            );
          case "collect": {
            const due = row.balanceDue != null && row.balanceDue > 0;
            return (
              <Button
                key={b.kind}
                type="button"
                size="sm"
                variant={due ? "primary" : "secondary"}
                startIcon={<HandCoins aria-hidden="true" />}
                onClick={() => onCollect(row)}
                aria-label={due ? `Collect ${formatRupees(row.balanceDue!)} from ${row.name}` : `Open bill of ${row.name}`}
                data-row-action="collect"
              >
                {due ? `Collect ${formatRupees(row.balanceDue!)}` : "Bill"}
              </Button>
            );
          }
        }
      })}
    </>
  );
}

export function TodayRowView(props: TodayRowViewProps) {
  const { row, mode, canConsult, selected, next, flashKey, clock, onOpen } = props;
  const wait = clock && row.waitMinutes != null ? waitNow(row, clock.received, clock.now) : row.waitMinutes;
  const origin = originText(row);
  const sexAge = [row.age, row.sex].filter(Boolean).join(" · ");
  const meta = [sexAge, row.doctorName, origin].filter(Boolean).join(" · ");
  const inQueue = row.status === "waiting" || row.status === "in_consultation";
  const flags = (
    <>
      {(row.status === "no_show" || row.status === "cancelled") && <StatusChip status={row.status} />}
      <PriorityFlag priority={row.priority} />
      {inQueue && (row.vitals || row.vitalsPending) && <VitalsSummary vitals={row.vitals} />}
      {row.hasAllergy && <AllergyFlag />}
      {row.balanceDue != null && row.balanceDue > 0 && (
        <span className="font-semibold text-fg tabular-nums">{formatRupees(row.balanceDue)} due</span>
      )}
      {row.billed === false && <span className="font-semibold text-fg">Not billed</span>}
    </>
  );
  const buttons = rowButtons(mode, row, canConsult).filter((b) => !(next && b.kind === "start"));
  // Move, Mark as no-show and Cancel live in the row's ⋯ menu (V2-08 08-04b); the doctor's own queue has none.
  const menu = mode !== "doctor" && rowMenuItems(row.actions).length > 0;
  // V2-09b 09B-04b (R-15): a completed visit whose recommended follow-up has no booked or confirmed visit yet offers "Book follow-up" to the front desk;
  // the V2-08 booking sheet opens over Today with the patient, the doctor and the date filled in, and the receptionist confirms the slot. `row.followUp` is
  // set only for a role that may book.
  const bookFollowUp = mode === "front" && row.status === "completed" && row.followUp !== null && !row.followUp.booked;
  const bookHref = row.followUp
    ? `?${new URLSearchParams({ book: "1", patient: row.patientId, doctor: row.doctorId, date: row.followUp.date }).toString()}`
    : "";

  return (
    <QueueRow
      name={row.name}
      onOpen={() => onOpen(row.visitId)}
      token={row.token}
      time={row.time}
      status={row.status}
      balanceDue={chipBalance(row)}
      waitMinutes={wait}
      meta={meta}
      flags={flags}
      selected={selected}
      next={next}
      flashKey={flashKey}
      actions={
        buttons.length > 0 || menu || bookFollowUp ? (
          <>
            <RowButtons {...props} buttons={buttons} />
            {bookFollowUp && (
              <Link
                href={bookHref}
                scroll={false}
                className={buttonClassName({ size: "sm", variant: "secondary" })}
                aria-label={`Book follow-up for ${row.name}`}
                data-row-action="book-follow-up"
              >
                <CalendarPlus aria-hidden="true" className="size-4" />
                Book follow-up
              </Link>
            )}
            {menu && <RowMenu visitId={row.visitId} name={row.name} actions={row.actions} rowVersion={row.rowVersion} />}
          </>
        ) : undefined
      }
    />
  );
}
