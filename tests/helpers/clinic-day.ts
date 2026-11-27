/**
 * Seeded times that stay on the clinic-local day of "now" (09E PR 2, CI 46049011705).
 *
 * The check-in step (000106, R-8) refuses a booked, confirmed or no-show visit whose appointment is not on the clinic's
 * current day (VISIT_NOT_TODAY). A fixture seeded at `Date.now() - 15 min` therefore lands on the previous clinic day
 * whenever the run is within 15 minutes after clinic-local midnight (00:06 IST in that run), and the RPC rightly refuses
 * it. These helpers keep a "late" seed inside today and keep a run away from the end of the day, so a seed and the RPC
 * that reads it share one clinic day at any time of day. `now` is injectable for the boundary regression spec.
 */
import { DEFAULT_CLINIC_TZ, dayWindowUtc, todayInTz } from "@/lib/datetime";

/** The UTC instants (ms) that bound the clinic-local day of `now`: `[start, endExclusive)`. */
export function clinicDayBounds(now: number = Date.now(), tz: string = DEFAULT_CLINIC_TZ): { start: number; endExclusive: number } {
  const { startIso, endIsoExclusive } = dayWindowUtc(todayInTz(tz, now), tz);
  return { start: Date.parse(startIso), endExclusive: Date.parse(endIsoExclusive) };
}

/**
 * An ISO instant `beforeMs` before `now`, but never before the clinic-local midnight that starts `now`'s day: a late
 * appointment of today. Just after midnight it is midnight itself (still in the past, still today).
 */
export function earlierToday(beforeMs: number, now: number = Date.now(), tz: string = DEFAULT_CLINIC_TZ): string {
  return new Date(Math.max(now - beforeMs, clinicDayBounds(now, tz).start)).toISOString();
}

/**
 * Waits out the last `marginMs` of the clinic-local day, so a visit seeded "today" is still today when the RPC runs a
 * few milliseconds later. Waits at most `marginMs` + 1 s (under Vitest's 20 s test timeout for the default margin).
 */
export async function clearOfClinicMidnight(marginMs = 10_000, tz: string = DEFAULT_CLINIC_TZ): Promise<void> {
  const now = Date.now();
  const left = clinicDayBounds(now, tz).endExclusive - now;
  if (left < marginMs) await new Promise((resolve) => setTimeout(resolve, left + 1_000));
}
