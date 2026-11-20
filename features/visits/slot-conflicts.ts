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
