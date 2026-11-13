/**
 * MSW 3 helpers for specs that also talk to the local stack (V2-04 04-07b root cause of a full-run-only failure).
 *
 * MSW 3 intercepts at the socket, below `fetch`, so while an MSW server listens it sees every request that opens a new
 * socket, including requests to the local Supabase stack. With `onUnhandledFrame: "error"` such a request fails
 * ("Cannot bypass a request when using the error strategy"). A spec therefore passed only while undici reused an already
 * open keep-alive socket for every local call, which depends on what earlier files in the same worker left in the pool.
 *
 * `loopbackPassthrough` is a handler that matches loopback requests only and passes them through, so the "error"
 * strategy stays in force for every other host (MSG91's socket still dials 127.0.0.1 via `mswFetch`, and the worker
 * guard still refuses other hosts). Give it to `setupServer(...)` so `resetHandlers()` keeps it.
 */
import { http, passthrough } from "msw";
import { isLoopbackHost } from "../setup/worker-guard";

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/** True when the request goes to a loopback host (the local stack, the e2e server). */
export function isLoopbackRequest(request: Request): boolean {
  return isLoopbackHost(hostOf(request.url));
}

/** Passes loopback requests through unmocked; matches nothing else. */
export const loopbackPassthrough = http.all(({ request }) => isLoopbackRequest(request), () => passthrough());
