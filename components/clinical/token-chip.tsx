import { cn } from "@/lib/utils";
import { formatClinicTime } from "@/lib/datetime/format";
import { displayVisitStatus, type VisitStatusTone } from "@/lib/visit-status";

/**
 * TokenChip (V2-06 06-03a; 06-UI-SPEC TokenChip, CD-06; DESIGN_SYSTEM §7.4): the queue token number. White fill,
 * Midnight number in `font-display` (Manrope 800, −0.02em, tabular: `text-token-sm` 17 px in a row, `text-token` 22 px
 * large; only `text-token` carries the weight and tracking, so the row size sets them itself), a 1.5 px border in the visit's status hue (`status-<tone>-border`; neutral `border-control`). A booked visit
 * has no token yet: the chip shows the appointment time instead ("10:30" + "am" caption) with a 1 px dashed booked
 * border. Screen readers hear "Token 14" or "Appointment 10:30 am"; the status itself is read from the row's chip or
 * lane, so the border colour is never the only cue. Server or Client Component.
 */
const BORDER: Partial<Record<VisitStatusTone, string>> = {
  waiting: "border-status-waiting-border",
  "with-doctor": "border-status-with-doctor-border",
  "to-bill": "border-status-to-bill-border",
  done: "border-status-done-border",
};

export interface TokenChipProps {
  /** The day's token number. */
  token?: number | null;
  /** The visit's status (any string; unknown or end states draw the neutral border). */
  status?: string | null;
  /** Balance due: a completed visit with money due draws the "To bill" border. */
  balanceDue?: number | null;
  /** Booked visits: the appointment's clinic wall-clock time `HH:mm`, shown instead of a number. */
  time?: string | null;
  size?: "row" | "large";
  className?: string;
}

export function TokenChip({ token, status, balanceDue, time, size = "row", className }: TokenChipProps) {
  const tone = displayVisitStatus(status, balanceDue).tone;
  const booked = time != null && (token == null || tone === "booked");
  if (booked) {
    const [clock, meridiem] = formatClinicTime(time).split(" ");
    return (
      <span
        data-token-chip="booked"
        className={cn(
          "inline-flex min-h-8 min-w-11 shrink-0 flex-col items-center justify-center rounded-sm border border-dashed border-status-booked-border bg-(--token-chip-bg) px-1 leading-none text-(--token-chip-fg) tabular-nums",
          className,
        )}
      >
        <span className="sr-only">Appointment </span>
        <span className="text-label font-semibold">{clock}</span>
        <span className="sr-only"> </span>
        <span className="text-caption font-normal text-fg-muted">{meridiem}</span>
      </span>
    );
  }
  return (
    <span
      data-token-chip={tone === "booked" || tone === "unknown" || tone === "info" ? "neutral" : tone}
      className={cn(
        "inline-flex shrink-0 items-center justify-center border-(length:--token-chip-border-width) bg-(--token-chip-bg) font-display leading-none text-(--token-chip-fg) tabular-nums",
        size === "large"
          ? "h-10 min-w-12 rounded-md px-1.5 text-token"
          : "h-7 min-w-9 rounded-sm px-1.25 text-token-sm font-extrabold tracking-[-0.02em]",
        BORDER[tone] ?? "border-border-control",
        className,
      )}
    >
      <span className="sr-only">Token </span>
      {token ?? (
        <>
          <span aria-hidden="true">–</span>
          <span className="sr-only">not assigned</span>
        </>
      )}
    </span>
  );
}
