/**
 * Smart Assist slot suggestions (V2-08 08-05, AI-13, R-18): which free times the booking sheet offers first. Deterministic and
 * pure (no React, no clock, no zone): the caller passes the clinic wall-clock `HH:mm` of every free grid slot and its length, the
 * doctor's average consult minutes and the patient's preferred time band (`public.slot_suggestion_context`, 000105), and
 * `tests/visits/suggest-slots.spec.ts` pins the rules.
 *
 * A suggestion is a start time from which consecutive free grid slots cover the average consult (one slot when the average is
 * unknown, because fewer than five consults are on record). Ranking: the patient's preferred band first, then the earliest.
 * The result is the top three and the "next free" one (the earliest such start whatever the band). Nothing here books anything;
 * the doctor, the day and the final slot stay the receptionist's choice, and the command checks the slot again.
 */
export type TimeBand = "morning" | "afternoon" | "evening";

export const TIME_BANDS: readonly TimeBand[] = ["morning", "afternoon", "evening"];

/** One free grid slot: the clinic wall-clock start `HH:mm` and its length in minutes. */
export interface FreeSlot {
  time: string;
  minutes: number;
}

export interface SuggestSlotsInput {
  slots: readonly FreeSlot[];
  /** The doctor's average consult minutes; null when unknown (one grid slot then covers a visit). */
  avgConsultMinutes: number | null;
  /** The patient's usual time of day; null without history. */
  preferredBand: TimeBand | null;
  /** Clinic `HH:mm`: a slot that starts before it is dropped (the caller passes "now" for today). */
  notBefore?: string | null;
}

export interface SlotSuggestion {
  time: string;
  band: TimeBand;
  /** True when this start is in the patient's preferred band. */
  inPreferredBand: boolean;
}

export interface SlotSuggestions {
  /** At most three, preferred band first, then earliest. */
  top: SlotSuggestion[];
  /** The earliest start that covers the consult, whatever the band; null when none does. */
  nextFree: SlotSuggestion | null;
}

/** Minutes after midnight of `HH:mm`; NaN when malformed. */
function minutesOfDay(hhmm: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : Number.NaN;
}

/** The band of a clinic wall-clock time: morning before 12:00, afternoon before 17:00, evening from 17:00 (as the database). */
export function bandOf(hhmm: string): TimeBand {
  const minutes = minutesOfDay(hhmm);
  return minutes < 12 * 60 ? "morning" : minutes < 17 * 60 ? "afternoon" : "evening";
}

export function suggestSlots(input: SuggestSlotsInput): SlotSuggestions {
  const floor = input.notBefore ? minutesOfDay(input.notBefore) : Number.NEGATIVE_INFINITY;
  const grid = input.slots
    .map((s) => ({ start: minutesOfDay(s.time), minutes: s.minutes, time: s.time }))
    .filter((s) => Number.isFinite(s.start) && s.minutes > 0 && s.start >= floor)
    .sort((a, b) => a.start - b.start);
  // One start per time, so a duplicated slot cannot make a run longer.
  const unique = grid.filter((s, i) => i === 0 || s.start !== grid[i - 1]!.start);
  const byStart = new Map(unique.map((s) => [s.start, s]));
  const need = input.avgConsultMinutes != null && input.avgConsultMinutes > 0 ? input.avgConsultMinutes : 0;

  const covers = (first: { start: number; minutes: number }): boolean => {
    let covered = first.minutes;
    let end = first.start + first.minutes;
    while (covered < need) {
      const next = byStart.get(end);
      if (!next) return false;
      covered += next.minutes;
      end += next.minutes;
    }
    return true;
  };

  const candidates: SlotSuggestion[] = unique.filter(covers).map((s) => ({
    time: s.time,
    band: bandOf(s.time),
    inPreferredBand: input.preferredBand !== null && bandOf(s.time) === input.preferredBand,
  }));
  // `candidates` is ascending by start, and the sort is stable, so the preferred band only moves its members ahead.
  const ranked = [...candidates].sort((a, b) => Number(b.inPreferredBand) - Number(a.inPreferredBand));
  return { top: ranked.slice(0, 3), nextFree: candidates[0] ?? null };
}
