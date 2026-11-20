/**
 * The reasons `register_and_book` (V2-07 07-03, migration 000098) raises when the doctor's slot is not free: taken by a
 * booked visit (also the exclusion constraint's refusal under a race), outside the clinic-local shifts, or inside a
 * schedule block. All three answer CONFLICT and write nothing; the booking drawer then offers the overbooking
 * confirmation, which re-sends the booking with `is_overbooked`. Client-safe (no server imports).
 */
export const SLOT_CONFLICT_REASONS: readonly string[] = ["SLOT_TAKEN", "SLOT_OFF_DUTY", "SLOT_BLOCKED"];

export function isSlotConflictReason(reason: string | undefined): boolean {
  return reason !== undefined && SLOT_CONFLICT_REASONS.includes(reason);
}

/** What the overbook dialog says for each cause (V2-07 07-04a G-4). */
export interface OverbookCauseText {
  title: string;
  description: string;
  headline: string;
  detail: (time: string) => string;
  question: string;
}

const CAUSE_TEXT: Record<string, OverbookCauseText> = {
  SLOT_TAKEN: {
    title: "Slot Already Booked",
    description: "Double-booking conflict detected (D-06)",
    headline: "Another appointment is already scheduled",
    detail: (time) => `A booking exists at ${time}`,
    question: "Would you like to intentionally overbook this doctor's slot? Overbooked appointments will be flagged on the schedule and marked for special triage.",
  },
  SLOT_OFF_DUTY: {
    title: "Outside Doctor's Hours",
    description: "The doctor is not on duty at this time",
    headline: "This time is outside the doctor's working hours",
    detail: (time) => `The doctor has no shift at ${time}`,
    question: "Would you like to book it anyway? The appointment will be flagged on the schedule as outside the doctor's hours.",
  },
  SLOT_BLOCKED: {
    title: "Doctor Unavailable",
    description: "The doctor has blocked this time",
    headline: "This time is blocked on the doctor's schedule",
    detail: (time) => `A schedule block covers ${time}`,
    question: "Would you like to book into the blocked time anyway?",
  },
};

/** The dialog text for the reason the booking command raised; an unknown or missing reason reads as a taken slot. */
export function overbookCauseText(reason: string | undefined): OverbookCauseText {
  return (reason !== undefined ? CAUSE_TEXT[reason] : undefined) ?? CAUSE_TEXT.SLOT_TAKEN;
}
