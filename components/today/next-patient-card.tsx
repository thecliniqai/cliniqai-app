"use client";

import { TokenChip } from "@/components/clinical/token-chip";
import { AllergyFlag, PriorityFlag, RowButtons, type TodayRowViewProps } from "./today-row";
import { chipBalance, type TodayRow } from "@/features/today/schema";

/**
 * The doctor's pinned "Next" card (V2-08 08-03b; 06-UI-SPEC §7 "Doctor mode"): the first patient of Waiting (mine) with the
 * primary action, "Call in" (`start_consultation`). Hairline panel, an inset 3 px accent bar, the eyebrow "Next", the token
 * large, the name and the meta line. It carries this patient's Call in; their row in the lane shows the "Next" caption.
 */
export type NextPatientCardProps = Pick<TodayRowViewProps, "onOptimistic" | "onRollback" | "onChanged" | "onRecordVitals" | "onCollect"> & {
  row: TodayRow;
};

export function NextPatientCard({ row, ...handlers }: NextPatientCardProps) {
  return (
    <section
      aria-label="Next patient"
      data-next-patient=""
      className="relative flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3.5 before:absolute before:inset-y-0 before:left-0 before:w-0.75 before:rounded-l-lg before:bg-(--row-selected-indicator) before:content-['']"
    >
      <TokenChip token={row.token} time={row.time} status={row.status} balanceDue={chipBalance(row)} size="large" />
      <div className="min-w-0 flex-1">
        <p className="text-caption font-semibold tracking-caps text-accent-fg uppercase">Next</p>
        <p className="truncate font-display text-title-2 text-fg">{row.name}</p>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body-sm text-fg-muted">
          {[row.age, row.sex].filter(Boolean).join(" · ")}
          <PriorityFlag priority={row.priority} />
          {row.hasAllergy && <AllergyFlag />}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <RowButtons row={row} buttons={[{ kind: "start", primary: true }]} {...handlers} />
      </div>
    </section>
  );
}
