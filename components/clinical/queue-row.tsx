import type { ReactNode } from "react";
import Link from "next/link";
import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { FOCUS_RING } from "@/lib/ui/variants";
import { formatWait, waitLevel, type WaitLevel } from "@/lib/visit-status";
import { TokenChip } from "./token-chip";

/**
 * QueueRow (V2-06 06-03a; 06-UI-SPEC QueueRow, CD-03, CD-15; DESIGN_SYSTEM §7.4): one visit in a Today lane or list.
 *
 * Grid: a token column (44 px; 48 on touch) with the TokenChip and the wait under it · the content: the name (body-md
 * 500, the row's link or button, its hit area stretched over the whole row), a meta line (12 px fg-muted: age/sex,
 * doctor, origin as text "Walk-in" / "Appt 10:15"), a flags line (vitals summary, allergy chip, "Vitals pending") ·
 * the actions. Below 1280 px (phones, tablets, the two-pane Today) the actions sit in a right-hand column beside the
 * content, vertically centred (`today_360`/`today_820` at 3a78a5d: rows of about 80 px); at 1280 px and up (the lane
 * board) they go on a line under the content with the ⋯ at the far right (06-09e, design review M2). Actions are
 * always visible (never on hover only) and sit above the stretched name: `sm` 28 px buttons plus a ⋯ IconButton,
 * 44 px on touch. Hairline separators between rows.
 *
 * States: `selected` (`row-selected-bg`, a 3 px indicator bar and `aria-current="true"`); `next` (the patient called
 * next: `row-next-bg`, the bar and a visible "Next" caption, so the state never rests on the tint, CD-15); a change
 * flash (`flashKey`: 600 ms `accent-subtle` to transparent, motion-safe only). Wait time: caption 11 tabular,
 * `wait-normal-fg` under 30 min, `wait-long-fg` 600 with a clock at 30–60 min, `wait-critical-fg` 600 with a clock
 * over 60 min. Server or Client Component (`onOpen` needs a Client parent).
 */
export interface QueueRowProps {
  name: string;
  /** Opens the visit: a link (`href`) or a button (`onOpen`). */
  href?: string;
  onOpen?: () => void;
  token?: number | null;
  /** Booked visits: appointment time `HH:mm` shown in the token column. */
  time?: string | null;
  status?: string | null;
  balanceDue?: number | null;
  waitMinutes?: number | null;
  /** Meta line (age/sex · doctor · origin); may ellipsize. */
  meta?: ReactNode;
  /** Flags line (VitalsSummary, AllergyChip, "Vitals pending", a StatusChip). */
  flags?: ReactNode;
  /** Row actions: `sm` buttons and a ⋯ menu, always visible. */
  actions?: ReactNode;
  selected?: boolean;
  next?: boolean;
  /** Change this to flash the row once (a live update arrived). */
  flashKey?: string | number | null;
  /** Heading level of the name inside a lane (lanes use h2 heads, so rows default to h3). */
  headingLevel?: 3 | 4;
  className?: string;
}

const WAIT_TONE: Record<WaitLevel, string> = {
  normal: "text-(--wait-normal-fg)",
  long: "font-semibold text-(--wait-long-fg)",
  critical: "font-semibold text-(--wait-critical-fg)",
};

const WAIT_SPOKEN: Record<WaitLevel, string> = { normal: "", long: ", long wait", critical: ", over an hour" };

export function WaitTime({ minutes }: { minutes: number }) {
  const level = waitLevel(minutes);
  // "1 h 05 min" breaks only between its hour and minute parts, and the clock goes above the time when the 44 px
  // token column is too narrow for both on one line.
  const parts = formatWait(minutes).split(/(?<=h) /);
  return (
    <span
      data-wait={level}
      className={cn(
        "flex max-w-full flex-wrap items-center justify-center gap-x-0.5 text-center text-caption leading-tight tabular-nums",
        WAIT_TONE[level],
      )}
    >
      {level !== "normal" && <Clock aria-hidden="true" strokeWidth={2.25} className="size-3 shrink-0" />}
      <span className="sr-only">Waiting </span>
      {parts.map((part, i) => (
        <span key={i} className="whitespace-nowrap">
          {i > 0 ? " " : ""}
          {part}
        </span>
      ))}
      <span className="sr-only">{WAIT_SPOKEN[level]}</span>
    </span>
  );
}

/** A lane's list of rows (`<ul>`), named by its lane ("Waiting"). */
export function QueueList({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <ul aria-label={label} className={cn("flex flex-col", className)}>
      {children}
    </ul>
  );
}

export function QueueRow({
  name,
  href,
  onOpen,
  token,
  time,
  status,
  balanceDue,
  waitMinutes,
  meta,
  flags,
  actions,
  selected = false,
  next = false,
  flashKey,
  headingLevel = 3,
  className,
}: QueueRowProps) {
  const Heading = `h${headingLevel}` as "h3" | "h4";
  // The name's hit area covers the row (::after); the actions sit above it (z-10).
  const nameClass = cn(
    "block cursor-pointer rounded-sm text-left text-body-md leading-[1.3] font-medium text-fg after:absolute after:inset-0 after:content-[''] hover:underline",
    "line-clamp-2 break-normal",
    FOCUS_RING,
  );
  return (
    <li
      data-queue-row=""
      data-next={next || undefined}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "relative isolate grid grid-cols-[2.75rem_minmax(0,1fr)] gap-x-3 border-b border-border bg-surface px-3 py-2 last:border-b-0 touch:grid-cols-[3rem_minmax(0,1fr)] touch:px-3.5 touch:py-2.5",
        next && "bg-(--row-next-bg)",
        selected && "bg-(--row-selected-bg)",
        (next || selected) && "before:absolute before:inset-y-0 before:left-0 before:w-0.75 before:bg-(--row-selected-indicator) before:content-['']",
        className,
      )}
    >
      {flashKey != null && (
        <span
          key={flashKey}
          aria-hidden="true"
          data-row-flash=""
          className="pointer-events-none absolute inset-0 -z-10 bg-transparent motion-safe:transition-[background-color] motion-safe:duration-600 motion-safe:ease-linear motion-safe:starting:bg-accent-subtle"
        />
      )}
      <div className="relative flex flex-col items-center gap-1 pt-0.5">
        <TokenChip token={token} time={time} status={status} balanceDue={balanceDue} />
        {waitMinutes != null && <WaitTime minutes={waitMinutes} />}
      </div>
      <div className="flex min-w-0 max-xl:flex-row max-xl:items-center max-xl:gap-2 xl:flex-col">
        <div data-row-content="" className="flex min-w-0 flex-1 flex-col">
          {next && (
            <span className="text-caption font-semibold tracking-caps text-status-with-doctor-fg uppercase">Next</span>
          )}
          <Heading className="text-body-md font-medium">
            {href ? (
              <Link href={href} className={nameClass} data-patient-name="">
                {name}
              </Link>
            ) : (
              <button type="button" onClick={onOpen} className={nameClass} data-patient-name="">
                {name}
              </button>
            )}
          </Heading>
          {meta && <p className="mt-0.5 truncate text-label text-fg-muted">{meta}</p>}
          {flags && <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-label">{flags}</div>}
        </div>
        {actions && (
          <div
            data-row-actions=""
            className="relative z-10 flex shrink-0 items-center gap-2 xl:mt-2 xl:[&>:last-child:not(:first-child)]:ml-auto"
          >
            {actions}
          </div>
        )}
      </div>
    </li>
  );
}
