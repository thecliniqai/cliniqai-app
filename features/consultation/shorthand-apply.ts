import type { ChiefComplaintItem } from "@/features/consultation/schema";
import { intervalForDays, type FollowUpInterval } from "@/features/consultation/catalogue";
import { addDaysYmd } from "@/lib/datetime";
import type { ParsedDuration, ShorthandResult } from "@/features/consultation/shorthand";
import { durationDays } from "@/features/consultation/shorthand";

/**
 * Applies a parsed shorthand (or an accepted follow-up phrase) to the consult's draft fields (V2-09b 09B-04b, R-14, R-15). Pure: the caller hands over
 * the current values and the clinic's today and gets the next values. Nothing is applied without the doctor's tap or Enter (R-10); this only computes it.
 */

export interface ShorthandFields {
  complaints: ChiefComplaintItem[];
  clinicalNotes: string;
  advice: string[];
}

export interface FollowUpFields {
  interval: FollowUpInterval;
  date: string;
  notes: string;
}

export interface AppliedShorthand extends ShorthandFields {
  /** The new follow-up values, or null when the shorthand carried none. */
  followUp: FollowUpFields | null;
}

/** The follow-up values for an interval counted from the clinic's today: the tile that matches the days, else a custom date. */
export function followUpFromDuration(duration: ParsedDuration, today: string, notes: string): FollowUpFields {
  const days = durationDays(duration);
  return { interval: intervalForDays(days) ?? "custom", date: addDaysYmd(today, days), notes };
}

export function applyShorthand(
  result: ShorthandResult,
  current: ShorthandFields & { followUpNotes: string },
  today: string,
  newId: () => string,
): AppliedShorthand {
  const complaints = [...current.complaints];
  for (const parsed of result.complaints) {
    if (complaints.some((c) => c.symptom.toLowerCase() === parsed.symptom.toLowerCase())) continue;
    const item: ChiefComplaintItem = { id: newId(), symptom: parsed.symptom, notes: null };
    if (parsed.duration) {
      item.duration_val = parsed.duration.value;
      item.duration_unit = parsed.duration.unit;
    }
    complaints.push(item);
  }
  const advice = [...current.advice];
  for (const line of result.advice) {
    if (advice.some((a) => a.toLowerCase() === line.toLowerCase())) continue;
    advice.push(line);
  }
  const added = result.notes.join("\n");
  const clinicalNotes = added ? (current.clinicalNotes.trim() ? `${current.clinicalNotes}\n${added}` : added) : current.clinicalNotes;
  const followUp = result.followUp ? followUpFromDuration(result.followUp, today, result.followUp.note ?? current.followUpNotes) : null;
  return { complaints, clinicalNotes, advice, followUp };
}
