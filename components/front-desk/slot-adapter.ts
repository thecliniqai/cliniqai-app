import type { Slot } from "@/components/ui/slot-picker";
import { clockOf, zonedDateTimeToUtcIso } from "@/lib/datetime";

/**
 * The one place that converts between the database's slot instants and the clinic's wall-clock `HH:mm` the pickers show
 * (V2-08 08-04b, R-16, ADR-016). `available_slots` answers UTC instants; staff think in the clinic's time, never in the browser's
 * zone, so every conversion goes through the clinic's IANA zone and never `Date#getHours()`. Pure (no React, no zone of the
 * process): `tests/schedule/slot-adapter.spec.ts` runs it with the process zone set to UTC and to America/Los_Angeles.
 */
export interface SlotInstants {
  /** ISO instants; the slot is the half-open interval [start, end). */
  start: string;
  end: string;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The clinic wall-clock `HH:mm` of an instant. */
export function clinicHHmm(instant: string, timeZone: string): string {
  const { hour, minute } = clockOf(instant, timeZone);
  return `${pad(hour)}:${pad(minute)}`;
}

/** Free slots as `SlotPicker` slots: clinic `HH:mm`, ascending, one per start. */
export function toPickerSlots(slots: readonly SlotInstants[], timeZone: string): Slot[] {
  const times = new Set(slots.map((s) => clinicHHmm(s.start, timeZone)));
  return [...times].sort().map((time) => ({ time }));
}

/** The instant (ISO, UTC) of clinic date `date` at wall-clock `hhmm`: what the booking commands are sent. */
export function slotInstant(date: string, hhmm: string, timeZone: string): string {
  return zonedDateTimeToUtcIso(date, hhmm, timeZone);
}

/** The earliest free slot's `HH:mm`, or null when there is none. */
export function earliestSlot(slots: readonly Slot[]): string | null {
  return slots.length === 0 ? null : slots.reduce((min, s) => (s.time < min ? s.time : min), slots[0]!.time);
}

/** Each slot's length in minutes by its clinic `HH:mm` (the booking sends it as the visit's duration). */
export function slotLengths(slots: readonly SlotInstants[], timeZone: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of slots) out.set(clinicHHmm(s.start, timeZone), Math.round((Date.parse(s.end) - Date.parse(s.start)) / 60_000));
  return out;
}
