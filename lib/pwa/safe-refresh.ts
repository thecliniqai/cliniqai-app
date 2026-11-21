/**
 * Refresh a live view without ever losing it (V2-08 08-03a, carried from the V2-07 merge; PWA_STRATEGY §3.2).
 *
 * Next's `router.refresh()` answers a failed RSC fetch with a browser navigation (`fetch-server-response.js`): on a
 * network that drops during a refresh the screen reloads (offline: the `/offline` page) and loses its rows. So a live view
 * refreshes only while the browser says it is online AND a one-line liveness probe (`/api/health`, no database) has just
 * answered; otherwise it keeps what is on screen and waits for the next signal, poll or `online` event. The window between
 * the probe and the refresh is a few milliseconds; the data on screen is never replaced by a failure.
 */
export const REFRESH_PROBE_PATH = "/api/health";
export const REFRESH_PROBE_TIMEOUT_MS = 3_000;

export interface SafeRefreshDeps {
  isOnline: () => boolean;
  /** Resolves true when the server answered. */
  probe: () => Promise<boolean>;
}

const browserDeps: SafeRefreshDeps = {
  isOnline: () => typeof navigator === "undefined" || navigator.onLine !== false,
  probe: async () => {
    try {
      const response = await fetch(REFRESH_PROBE_PATH, {
        method: "GET",
        cache: "no-store",
        credentials: "omit",
        signal: AbortSignal.timeout(REFRESH_PROBE_TIMEOUT_MS),
      });
      return response.ok;
    } catch {
      return false;
    }
  },
};

/** Calls `refresh` when the browser is online and the server answers the probe; resolves whether it did. */
export async function refreshWhenReachable(refresh: () => void, deps: SafeRefreshDeps = browserDeps): Promise<boolean> {
  if (!deps.isOnline()) return false;
  if (!(await deps.probe())) return false;
  if (!deps.isOnline()) return false;
  refresh();
  return true;
}
