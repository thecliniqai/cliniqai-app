/**
 * The one visit-status map (V2-06 06-03a; FRONTEND_MIGRATION_PLAN M1 `lib/visit-status.ts`; DESIGN_SYSTEM §7.5;
 * 06-UI-SPEC "Visit status hues", CD-16, CD-29). Every chip, lane and filter reads its label, colour tone, icon and
 * order from here, so a status looks and reads the same on every screen.
 *
 * Keys are the stored `visits.status` values (the CHECK constraint of 000006; `VisitStatus` in lib/db/types.ts) plus
 * two display states that are not stored:
 * - `to_bill`: a completed visit with a balance still due (derived, `displayVisitStatus`);
 * - `rescheduled`: an event shown in a visit's timeline (CD-29).
 * Anything else (a value a later migration adds before this map learns it, a typo, null) is the neutral
 * "Unknown status" entry: it never throws and never borrows another status's colour.
 *
 * No state uses the primary blue (06-01b revision): each has its own hue (`status-<tone>-*` tokens in app/globals.css).
 */
import type { LucideIcon } from "lucide-react";
import {
  CalendarCheck,
  CalendarClock,
  CalendarSync,
  CircleCheck,
  CircleX,
  Hourglass,
  IndianRupee,
  Stethoscope,
  UserX,
} from "lucide-react";
import type { VisitStatus } from "@/lib/db/types";

/** The colour family of a chip: the `status-<tone>-{bg,fg,border}` tokens, `info-*` or the neutral pair. */
export type VisitStatusTone =
  | "booked"
  | "waiting"
  | "with-doctor"
  | "to-bill"
  | "done"
  | "no-show"
  | "cancelled"
  | "info"
  | "unknown";

/** Every value `visits.status` may hold (000006 CHECK). Kept equal to `VisitStatus` by the type below. */
export const STORED_VISIT_STATUSES = [
  "booked",
  "confirmed",
  "waiting",
  "in_consultation",
  "completed",
  "cancelled",
  "no_show",
] as const satisfies readonly VisitStatus[];

/** Display states that are not stored: derived from a stored status and the bill, or a timeline event. */
export const DERIVED_VISIT_STATUSES = ["to_bill", "rescheduled"] as const;

export type VisitStatusKey = (typeof STORED_VISIT_STATUSES)[number] | (typeof DERIVED_VISIT_STATUSES)[number];

export interface VisitStatusEntry {
  key: VisitStatusKey | "unknown";
  /** Sentence-case label shown in the chip and read by screen readers. */
  label: string;
  tone: VisitStatusTone;
  /** 12 px lucide glyph drawn before the label (never the only cue); none for an unknown value. */
  icon: LucideIcon | null;
  /**
   * Lifecycle order (the Today lanes left to right, then the end states): sorts filters and lanes. The v1 queue's own
   * sort (in consultation first) is a queue rule and stays in features/queue/service.ts.
   */
  order: number;
  /** True for a value stored in `visits.status`. */
  stored: boolean;
}

const ENTRIES: Record<VisitStatusKey, VisitStatusEntry> = {
  booked: { key: "booked", label: "Booked", tone: "booked", icon: CalendarClock, order: 10, stored: true },
  confirmed: { key: "confirmed", label: "Confirmed", tone: "booked", icon: CalendarCheck, order: 20, stored: true },
  waiting: { key: "waiting", label: "Waiting", tone: "waiting", icon: Hourglass, order: 30, stored: true },
  in_consultation: {
    key: "in_consultation",
    label: "With doctor",
    tone: "with-doctor",
    icon: Stethoscope,
    order: 40,
    stored: true,
  },
  to_bill: { key: "to_bill", label: "To bill", tone: "to-bill", icon: IndianRupee, order: 50, stored: false },
  completed: { key: "completed", label: "Done", tone: "done", icon: CircleCheck, order: 60, stored: true },
  no_show: { key: "no_show", label: "No-show", tone: "no-show", icon: UserX, order: 70, stored: true },
  cancelled: { key: "cancelled", label: "Cancelled", tone: "cancelled", icon: CircleX, order: 80, stored: true },
  rescheduled: { key: "rescheduled", label: "Rescheduled", tone: "info", icon: CalendarSync, order: 90, stored: false },
};

export const UNKNOWN_VISIT_STATUS: VisitStatusEntry = Object.freeze({
  key: "unknown",
  label: "Unknown status",
  tone: "unknown",
  icon: null,
  order: 1000,
  stored: false,
});

/** All known entries in lifecycle order. */
export const VISIT_STATUS_ENTRIES: readonly VisitStatusEntry[] = Object.freeze(
  Object.values(ENTRIES).sort((a, b) => a.order - b.order),
);

export function isVisitStatusKey(value: unknown): value is VisitStatusKey {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(ENTRIES, value);
}

/** The entry for a status value; an unknown, empty or non-string value gives the neutral entry (never a throw). */
export function visitStatus(value: unknown): VisitStatusEntry {
  return isVisitStatusKey(value) ? ENTRIES[value] : UNKNOWN_VISIT_STATUS;
}

/**
 * The state a visit is shown in: a completed visit with money still due is "To bill"; everything else is its stored
 * status. `balanceDue` is in any unit (only its sign matters); unknown or missing means nothing is due.
 */
export function displayVisitStatus(status: unknown, balanceDue?: number | null): VisitStatusEntry {
  if (status === "completed" && typeof balanceDue === "number" && Number.isFinite(balanceDue) && balanceDue > 0) {
    return ENTRIES.to_bill;
  }
  return visitStatus(status);
}

/** Sort comparator by lifecycle order; unknown values sort last. */
export function compareVisitStatus(a: unknown, b: unknown): number {
  return visitStatus(a).order - visitStatus(b).order;
}

/*
 * Queue wait times (06-UI-SPEC QueueRow; DESIGN_SYSTEM §7.4): live and relative, with three levels. The thresholds are
 * the defaults; DESIGN_SYSTEM makes them a clinic setting later (V2-08).
 */
export type WaitLevel = "normal" | "long" | "critical";
export const WAIT_LONG_MIN = 30;
export const WAIT_CRITICAL_MIN = 60;

/** `< 30` normal, `30–60` long, `> 60` critical. */
export function waitLevel(minutes: number): WaitLevel {
  if (minutes > WAIT_CRITICAL_MIN) return "critical";
  if (minutes >= WAIT_LONG_MIN) return "long";
  return "normal";
}

/** `6 min`, `1 h 05 min`, `2 h` (DESIGN_SYSTEM §5). Negative or non-finite input reads `0 min`. */
export function formatWait(minutes: number): string {
  const m = Number.isFinite(minutes) && minutes > 0 ? Math.floor(minutes) : 0;
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${h} h` : `${h} h ${String(rest).padStart(2, "0")} min`;
}

/** Spoken form for screen readers: `waiting 1 hour 5 minutes`. */
export function spokenWait(minutes: number): string {
  const m = Number.isFinite(minutes) && minutes > 0 ? Math.floor(minutes) : 0;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  const parts = [];
  if (h > 0) parts.push(`${h} ${h === 1 ? "hour" : "hours"}`);
  if (rest > 0 || h === 0) parts.push(`${rest} ${rest === 1 ? "minute" : "minutes"}`);
  return `waiting ${parts.join(" ")}`;
}
