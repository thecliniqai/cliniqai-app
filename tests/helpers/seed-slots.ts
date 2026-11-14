/**
 * Non-overlapping appointment times for seeded scheduled visits (V2-05 05-08).
 *
 * Since `visits_no_double_booking`, two scheduled, non-overbooked, live visits of one doctor in one clinic may not
 * overlap (23P01). Seeders that create such a visit per call for the same doctor take its minute offset from here: a
 * random base per test file (so files do not all book the same instants), then a 20-minute step per call (seeded
 * visits use the default 15 minutes), so no two seeds of one file ever overlap. Independent random minutes collided.
 */
const BASE_MINUTE = Math.floor(Math.random() * 10_000);
let step = 0;

/** The next seed offset in minutes (add it to a future base instant). */
export function nextSeedSlotMinutes(): number {
  return BASE_MINUTE + 20 * step++;
}

/** A future ISO instant for a seeded scheduled visit: two days ahead plus {@link nextSeedSlotMinutes}. */
export function seedSlotIso(): string {
  return new Date(Date.now() + 2 * 86_400_000 + nextSeedSlotMinutes() * 60_000).toISOString();
}
