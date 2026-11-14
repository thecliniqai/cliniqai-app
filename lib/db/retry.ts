import type { DbErrorLike } from "@/lib/db/errors";

/** SQLSTATE of a transaction PostgreSQL aborted to break a deadlock. */
export const DEADLOCK_DETECTED = "40P01";

export function isDeadlock(err: DbErrorLike | null | undefined): boolean {
  return Boolean(err && typeof err === "object" && err.code === DEADLOCK_DETECTED);
}

/**
 * Runs a single-statement write once more when PostgreSQL aborted it as a deadlock victim (V2-05 05-08 deviation 5;
 * 05a review INT L-3, plan 05-11c).
 *
 * Two concurrent writes of overlapping visit slots can each find the other's not-yet-committed index entry while
 * checking the `visits_no_double_booking` exclusion constraint; PostgreSQL then aborts one of them with 40P01 instead
 * of answering 23P01. The aborted statement rolled back completely (PostgREST runs each request, and an RPC, in its
 * own transaction, so trigger-created rows such as the visit's `clinical_notes` go with it), and the survivor goes on,
 * so ONE retry answers definitively: 23P01 (the slot is taken) or the write itself. `write` must build a fresh query
 * each call (a Supabase builder runs once). A deadlock on the retry as well is returned as is: a slot writer reports it
 * as the taken slot (`isSlotTakenError` in features/visits/service.ts), and `mapDbError` maps any other 40P01 to
 * CONFLICT ("try again"), never to a server error.
 */
export async function retryOnDeadlock<T extends { error: DbErrorLike | null }>(write: () => PromiseLike<T>): Promise<T> {
  const first = await write();
  if (!isDeadlock(first.error)) return first;
  return await write();
}
