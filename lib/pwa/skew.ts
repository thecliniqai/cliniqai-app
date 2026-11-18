import { clientErrorKind } from "@/lib/errors/client-error-kind";
import { markSkew } from "@/lib/pwa/update";
import { requestSessionCheck } from "@/lib/pwa/session-status";

/**
 * The skew guard (V2-06 06-06; PWA_STRATEGY §3.7 step 5; R-28, R-29). An error the page did not handle (a rejected
 * promise reaching `unhandledrejection`, e.g. a Server Action the new deployment no longer has, called from an event
 * handler) or an error a route boundary caught is classified by 06-04a's `clientErrorKind`:
 * - `skew` → the shell shows "This app was updated. Reload to continue" (`markSkew`) and NEVER reloads by itself: the
 *   page, and whatever the user typed, stays on screen until they choose Reload.
 * - every error (skew or not) → a session-status check: any error may be a lock or a revoked session (rate-limited in
 *   `lib/pwa/session-status.ts`).
 *
 * The error's message is never read or shown (it can carry PHI). Not `preventDefault()`ed: the browser still reports it.
 */
export function noteAppError(error: unknown, online?: boolean): "skew" | "other" | "offline" {
  const kind = online === undefined ? clientErrorKind(error) : clientErrorKind(error, online);
  if (kind === "skew") markSkew();
  requestSessionCheck("error");
  return kind;
}

/** Listens for unhandled rejections and uncaught errors on `target` (the window); returns the function that stops. */
export function startSkewGuard(target: Pick<Window, "addEventListener" | "removeEventListener"> = window): () => void {
  const onRejection = (event: PromiseRejectionEvent) => {
    noteAppError(event.reason);
  };
  const onError = (event: ErrorEvent) => {
    noteAppError(event.error);
  };
  target.addEventListener("unhandledrejection", onRejection);
  target.addEventListener("error", onError);
  return () => {
    target.removeEventListener("unhandledrejection", onRejection);
    target.removeEventListener("error", onError);
  };
}
