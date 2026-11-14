import { z } from "zod";

/**
 * Bounds of a visit's `estimated_duration_minutes` (V2-05 05a review M-DURATION). The database enforces the same range
 * with the `visits_duration_range` CHECK (05-11a); every writer validates it first (the app booking schemas and the
 * `/api/v1` visit and appointment routes, 05-11c), so a caller gets a validation answer, never a database error. A zero
 * length would slip past `visits_no_double_booking` (an empty range overlaps nothing) and a huge one would block the
 * doctor's calendar for years.
 */
export const MIN_VISIT_DURATION_MINUTES = 5;
export const MAX_VISIT_DURATION_MINUTES = 480;
export const DEFAULT_VISIT_DURATION_MINUTES = 15;

/** A whole number of minutes within the bounds (no coercion: a string is refused). */
export const visitDurationSchema = z
  .number()
  .int("Duration must be a whole number of minutes.")
  .min(MIN_VISIT_DURATION_MINUTES, `Duration must be at least ${MIN_VISIT_DURATION_MINUTES} minutes.`)
  .max(MAX_VISIT_DURATION_MINUTES, `Duration must be at most ${MAX_VISIT_DURATION_MINUTES} minutes.`);

/** Fixed `/api/v1` validation text for a duration outside {@link visitDurationSchema}. */
export const VISIT_DURATION_API_MESSAGE =
  `Field 'estimated_duration_minutes' must be a whole number of minutes from ${MIN_VISIT_DURATION_MINUTES} to ${MAX_VISIT_DURATION_MINUTES}.`;

/**
 * The duration an `/api/v1` body asks for: omitted or `null` → the default; anything else must pass
 * {@link visitDurationSchema}, else `null` (the route answers 422 with {@link VISIT_DURATION_API_MESSAGE}).
 */
export function apiVisitDuration(value: unknown): number | null {
  if (value === undefined || value === null) return DEFAULT_VISIT_DURATION_MINUTES;
  const parsed = visitDurationSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
