import { cn } from "@/lib/utils";
import { displayVisitStatus, type VisitStatusTone } from "@/lib/visit-status";

/**
 * StatusChip (V2-06 06-03a; 06-UI-SPEC StatusChip, CD-16, CD-29; DESIGN_SYSTEM §7.5): the visit status as a 20 px pill
 * with a 12 px icon and its label, from the one map in `lib/visit-status.ts`. Never interactive; never the primary
 * blue; the label carries the meaning (colour and icon only support it). Cancelled is outlined (white fill, slate text,
 * 1 px inset `border-control` ring) so it never reads as the filled slate Done chip. An unknown value renders the
 * neutral "Unknown status" chip. Server or Client Component.
 */
export const STATUS_CHIP_TONE: Record<VisitStatusTone, string> = {
  booked: "bg-status-booked-bg text-status-booked-fg",
  waiting: "bg-status-waiting-bg text-status-waiting-fg",
  "with-doctor": "bg-status-with-doctor-bg text-status-with-doctor-fg",
  "to-bill": "bg-status-to-bill-bg text-status-to-bill-fg",
  done: "bg-status-done-bg text-status-done-fg",
  "no-show": "bg-status-no-show-bg text-status-no-show-fg",
  cancelled: "bg-status-cancelled-bg text-status-cancelled-fg shadow-[inset_0_0_0_1px_var(--color-border-control)]",
  info: "bg-info-bg text-info-fg",
  unknown: "bg-surface-muted text-fg-secondary",
};

export interface StatusChipProps {
  /** The stored `visits.status` value (or a display key such as `to_bill`, `rescheduled`). Any string is safe. */
  status: string | null | undefined;
  /** Money still due on the visit: a completed visit with a positive balance shows "To bill". */
  balanceDue?: number | null;
  className?: string;
}

export function StatusChip({ status, balanceDue, className }: StatusChipProps) {
  const entry = displayVisitStatus(status, balanceDue);
  const Icon = entry.icon;
  return (
    <span
      data-status-chip={entry.key}
      data-tone={entry.tone}
      className={cn(
        "inline-flex h-pill shrink-0 items-center gap-1 rounded-pill px-1.75 text-caption leading-none font-semibold tracking-[0.01em] whitespace-nowrap",
        STATUS_CHIP_TONE[entry.tone],
        className,
      )}
    >
      {Icon && <Icon aria-hidden="true" strokeWidth={2} className="size-3 shrink-0" />}
      {entry.label}
    </span>
  );
}
