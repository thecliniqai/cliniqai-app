import "server-only";

import { currentTiming } from "./db-timing";

/**
 * `Server-Timing` for route handlers (V2-09e 09E-02, R-20): `db;dur=<ms>;desc="calls=<n> depth=<d>", app;dur=<ms>`. Counts, depth and
 * milliseconds only; the header goes to the requester alone. Pages cannot set headers once streaming starts, so they write the
 * `request.timing` line only. Also records the response status for that line. Never throws and never changes the response.
 */
export async function withServerTiming<R extends Response>(response: R): Promise<R> {
  try {
    const timing = await currentTiming();
    if (!timing) return response;
    timing.setStatus(response.status);
    response.headers.set("Server-Timing", timing.serverTimingHeader());
    return response;
  } catch {
    return response;
  }
}

/** Wraps a route handler: whatever it answers goes through {@link withServerTiming}. The handler's own signature is kept. */
export function timedRoute<A extends unknown[], R extends Response>(handler: (...args: A) => Promise<R> | R): (...args: A) => Promise<R> {
  return async (...args) => {
    // Starts the request's timing first, so a route that stalls has written its `request.start` line.
    (await currentTiming().catch(() => null))?.start();
    return withServerTiming(await handler(...args));
  };
}
