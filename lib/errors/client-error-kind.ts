/**
 * What kind of failure a route error boundary caught (V2-06 06-04a step 3; PWA_STRATEGY §3.7). Isomorphic and pure:
 * the caller passes `navigator.onLine` (or leaves the default, which reads it in a browser).
 *
 * - `offline`: the browser reports no network, so the fix is to reconnect.
 * - `skew`: the page's code is from another deployment: a server action the server no longer knows
 *   (`unstable_isUnrecognizedActionError`, Next's own check) or a script chunk that no longer exists (`ChunkLoadError`,
 *   the name both webpack and Turbopack give a failed chunk load). The fix is a reload. 06-06's skew guard reuses this.
 * - `other`: anything else.
 */
import { unstable_isUnrecognizedActionError } from "next/navigation";

export type ClientErrorKind = "offline" | "skew" | "other";

function browserOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

export function clientErrorKind(error: unknown, online: boolean = browserOnline()): ClientErrorKind {
  if (!online) return "offline";
  if (unstable_isUnrecognizedActionError(error)) return "skew";
  if (error !== null && typeof error === "object" && (error as { name?: unknown }).name === "ChunkLoadError") return "skew";
  return "other";
}
