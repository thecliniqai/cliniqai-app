import type { AccessDestination } from "@/lib/auth/access-redirect";
import { concealDocument, hardSignOut } from "@/lib/auth/hard-sign-out";
import { runCleanups } from "@/lib/pwa/cleanup";
import { requestSessionCheck } from "@/lib/pwa/session-status";
import { reportClientError } from "@/lib/log/client";

/**
 * The client's subscription-lock reaction (V2-06 06-06; PWA_STRATEGY §6.6, D-8; R-16). A lock is NOT a sign-out: the
 * session is kept, so the owner can renew or export from the locked page.
 *
 * {@link onLocked}: the page's content is hidden and made inert at once (no patient data stays on screen), the "lock"
 * cleanups run (Realtime unsubscribes, in-flight aborts; each capped at 2 s by `lib/pwa/cleanup.ts`), then a hard
 * navigation (`location.replace`) to the member's destination page, which the server rendered for this role (05-10b).
 * Only the three destinations of `lib/auth/access-redirect.ts` reach here (`parseSessionStatus` refuses others).
 *
 * {@link onAppErrorCode}: for code that reads a typed result (the command hook V2-07/V2-08 forms adopt, PWA-06):
 * `SUBSCRIPTION_LOCKED` → a fresh status check (which redirects); `UNAUTHENTICATED` → `hardSignOut("expired")`.
 */
export interface LockDeps {
  conceal: () => void;
  runCleanups: () => Promise<void>;
  replace: (url: string) => void;
}

const browserLockDeps = (): LockDeps => ({
  conceal: () => concealDocument(),
  runCleanups: () => runCleanups("lock"),
  replace: (url) => window.location.replace(url),
});

let leaving = false;

export async function onLocked(destination: AccessDestination, deps: LockDeps = browserLockDeps()): Promise<void> {
  if (leaving) return;
  leaving = true;
  try {
    deps.conceal();
  } catch (err) {
    reportClientError("pwa.lock_conceal", err);
  }
  try {
    await deps.runCleanups();
  } catch (err) {
    reportClientError("pwa.lock_cleanup", err);
  } finally {
    deps.replace(destination);
  }
}

/** For tests: lets a second `onLocked` run (a real page navigates away after the first). */
export function resetLockForTests(): void {
  leaving = false;
}

export interface AppErrorCodeDeps {
  check: () => void;
  signOutExpired: () => void;
}

/** Reacts to an app error code from a server result; returns true when the code was one it handles. */
export function onAppErrorCode(
  code: string | null | undefined,
  deps: AppErrorCodeDeps = { check: () => requestSessionCheck("lock"), signOutExpired: () => void hardSignOut("expired") },
): boolean {
  if (code === "SUBSCRIPTION_LOCKED") {
    deps.check();
    return true;
  }
  if (code === "UNAUTHENTICATED") {
    deps.signOutExpired();
    return true;
  }
  return false;
}
