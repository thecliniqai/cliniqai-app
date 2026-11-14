import { reportClientError } from "@/lib/log/client";

/**
 * Cleanup registry (PWA_STRATEGY §4 D-5/D-8; V2-06 06-05, ruling R-17). Code that keeps patient data in memory or a
 * live channel open registers a cleanup here: Realtime unsubscribes, in-flight request aborts, in-memory query state.
 * `hardSignOut()` runs them with "signout" before it signs out; 06-06's lock redirect runs them with "lock" (the
 * session is kept). v1 has no Realtime subscriber; Today (V2-08) is the first.
 *
 * A cleanup that throws or rejects is reported (class name only) and the others still run; one that has not settled
 * after CLEANUP_TIMEOUT_MS is left behind, so a stuck cleanup can never hold a sign-out or a lock redirect.
 */
export const CLEANUP_TIMEOUT_MS = 2000;
export type CleanupKind = "signout" | "lock";
export type Cleanup = (kind: CleanupKind) => void | Promise<void>;

const cleanups = new Set<Cleanup>();

/** Registers `cleanup`; returns the function that removes it (call it when the owner unmounts). */
export function registerCleanup(cleanup: Cleanup): () => void {
  cleanups.add(cleanup);
  return () => {
    cleanups.delete(cleanup);
  };
}

/** Runs every registered cleanup once, in registration order, and forgets them. */
export async function runCleanups(kind: CleanupKind): Promise<void> {
  const pending = [...cleanups];
  cleanups.clear();
  for (const cleanup of pending) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.resolve().then(() => cleanup(kind)),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, CLEANUP_TIMEOUT_MS);
        }),
      ]);
    } catch (err) {
      reportClientError("pwa.cleanup_failed", err);
    } finally {
      clearTimeout(timer);
    }
  }
}
