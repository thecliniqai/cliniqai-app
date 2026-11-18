import { useSyncExternalStore } from "react";
import { readDevicePref, writeDevicePref } from "@/lib/pwa/device-prefs";
import { installMode, isStandalone, type InstallMode } from "@/lib/pwa/platform";

/**
 * Install state of the open page (V2-06 06-06; PWA_STRATEGY §6.1-§6.3).
 *
 * - `beforeinstallprompt` is captured and `preventDefault()`ed (no mini-infobar); the held event backs the "Install app"
 *   entry on Chromium. `appinstalled` hides every entry.
 * - {@link useInstallMode} combines that with the platform (`lib/pwa/platform.ts`).
 * - The Today card (`components/shell/install-card.tsx`) shows from the second signed-in browser session on
 *   ({@link countSignedInSession}: `clinicos.pref.signedInSessions`, +1 once per browser session, the marker in
 *   `sessionStorage`), and a dismissal hides it for 30 days (`clinicos.pref.installDismissedUntil`). Both are D-3
 *   device preferences (numbers only, never an identifier).
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

interface InstallSnapshot {
  canPrompt: boolean;
  installed: boolean;
}

let held: BeforeInstallPromptEvent | null = null;
let snapshot: InstallSnapshot = { canPrompt: false, installed: false };
const listeners = new Set<() => void>();

function publish(next: InstallSnapshot): void {
  snapshot = next;
  for (const listener of [...listeners]) listener();
}

/** Starts capturing on `target` (the window); returns the function that stops. */
export function startInstallCapture(target: Pick<Window, "addEventListener" | "removeEventListener"> = window): () => void {
  const onPrompt = (event: Event) => {
    event.preventDefault();
    held = event as BeforeInstallPromptEvent;
    publish({ ...snapshot, canPrompt: true });
  };
  const onInstalled = () => {
    held = null;
    publish({ canPrompt: false, installed: true });
  };
  target.addEventListener("beforeinstallprompt", onPrompt);
  target.addEventListener("appinstalled", onInstalled);
  return () => {
    target.removeEventListener("beforeinstallprompt", onPrompt);
    target.removeEventListener("appinstalled", onInstalled);
  };
}

/** Shows the browser's install prompt (Chromium). The event can be used once; afterwards the entry hides. */
export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  const event = held;
  if (!event) return "unavailable";
  held = null;
  publish({ ...snapshot, canPrompt: false });
  try {
    await event.prompt();
    const choice = await event.userChoice;
    return choice.outcome;
  } catch {
    return "dismissed";
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function currentMode(): InstallMode {
  return installMode({
    ua: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    standalone: isStandalone(),
    canPrompt: snapshot.canPrompt,
    installed: snapshot.installed,
  });
}

/** What "Install app" does here; "none" on the server and during hydration. */
export function useInstallMode(): InstallMode {
  return useSyncExternalStore(subscribe, currentMode, () => "none" as InstallMode);
}

// ---------------------------------------------------------------------------------------------------------------------
// The Today card's rules (PWA §6.1)
// ---------------------------------------------------------------------------------------------------------------------

export const SESSION_COUNT_KEY = "clinicos.pref.signedInSessions";
export const DISMISSED_UNTIL_KEY = "clinicos.pref.installDismissedUntil";
export const DISMISS_MS = 30 * 24 * 60 * 60_000;

/**
 * Counts this browser session once; returns the count (1 on the device's first signed-in session). The "already
 * counted" marker is the same preference name in `sessionStorage` (the count itself), so no other key is written
 * (D-3; the cache-audit spec allows only the preference names in either storage) and it dies with the browser session
 * or the sign-out purge.
 */
export function countSignedInSession(
  local: Storage | undefined = safeStorage("localStorage"),
  session: Storage | undefined = safeStorage("sessionStorage"),
): number {
  const current = Number.parseInt(readDevicePref(SESSION_COUNT_KEY, local) ?? "0", 10);
  const count = Number.isFinite(current) && current > 0 ? Math.min(current, 1_000_000) : 0;
  try {
    if (session?.getItem(SESSION_COUNT_KEY) !== null && session?.getItem(SESSION_COUNT_KEY) !== undefined) {
      return Math.max(count, 1);
    }
  } catch {
    return Math.max(count, 1);
  }
  const next = count + 1;
  writeDevicePref(SESSION_COUNT_KEY, String(next), local);
  writeDevicePref(SESSION_COUNT_KEY, String(next), session);
  notifyPrefs();
  return next;
}

const prefListeners = new Set<() => void>();
function notifyPrefs(): void {
  for (const listener of [...prefListeners]) listener();
}
function subscribePrefs(listener: () => void): () => void {
  prefListeners.add(listener);
  return () => {
    prefListeners.delete(listener);
  };
}

/** The signed-in session count recorded on this device (0 when none). */
export function signedInSessionCount(local: Storage | undefined = safeStorage("localStorage")): number {
  const value = Number.parseInt(readDevicePref(SESSION_COUNT_KEY, local) ?? "0", 10);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** Whether the Today card shows now (false on the server and during hydration; follows the count and a dismissal). */
export function useInstallCardVisible(mode: InstallMode): boolean {
  return useSyncExternalStore(
    subscribePrefs,
    () => installCardVisible(mode, signedInSessionCount(), readDevicePref(DISMISSED_UNTIL_KEY)),
    () => false,
  );
}

export function dismissInstallCard(now: number = Date.now(), local: Storage | undefined = safeStorage("localStorage")): void {
  writeDevicePref(DISMISSED_UNTIL_KEY, String(now + DISMISS_MS), local);
  notifyPrefs();
}

/** Whether the card may show: an install path exists, second session or later, not dismissed in the last 30 days. */
export function installCardVisible(
  mode: InstallMode,
  sessionCount: number,
  dismissedUntil: string | null,
  now: number = Date.now(),
): boolean {
  if (mode === "none") return false;
  if (sessionCount < 2) return false;
  const until = dismissedUntil === null ? Number.NaN : Number.parseInt(dismissedUntil, 10);
  return !(Number.isFinite(until) && until > now);
}

function safeStorage(kind: "localStorage" | "sessionStorage"): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window[kind];
  } catch {
    return undefined;
  }
}
