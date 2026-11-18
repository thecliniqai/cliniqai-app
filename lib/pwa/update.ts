import { takeNavigationVerdict } from "@/lib/pwa/dirty-guard";
import { reportClientError } from "@/lib/log/client";

/**
 * New-version state of the open app (V2-06 06-06; PWA_STRATEGY §3.7 steps 1, 3, 4; R-21, R-28, R-29).
 *
 * The update is "available" when the session-status poll reports another `deploymentId` than the page's `data-dpl-id`,
 * or when the service worker has a new version waiting. The app then shows "A new version is ready · Reload"
 * (`components/shell/update-toast.tsx`) and applies it by itself only at a safe point: the next route change with no
 * unsaved input and no command in flight (`lib/pwa/dirty-guard.ts`), and never after a skew error was shown (the user
 * may have typed input that the failed action did not save; they choose when to reload). Applying = post
 * `{ type: "SKIP_WAITING" }` to a waiting worker (06-05's worker answers it with `skipWaiting()`), then
 * `location.reload()`.
 *
 * `skew` is set by `lib/pwa/skew.ts` when an error shows the page's code is from another deployment: the toast then
 * reads "This app was updated. Reload to continue", and nothing reloads by itself.
 *
 * A small external store (`useSyncExternalStore` in the toast); every browser call is injected for the unit spec.
 */
export interface UpdateState {
  available: boolean;
  skew: boolean;
}

let state: UpdateState = { available: false, skew: false };
const listeners = new Set<() => void>();

function set(next: Partial<UpdateState>): void {
  const merged = { ...state, ...next };
  if (merged.available === state.available && merged.skew === state.skew) return;
  state = merged;
  for (const listener of [...listeners]) listener();
}

export function subscribeUpdate(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getUpdateState(): UpdateState {
  return state;
}

const SERVER_STATE: UpdateState = { available: false, skew: false };
export function getServerUpdateState(): UpdateState {
  return SERVER_STATE;
}

export function markUpdateAvailable(): void {
  set({ available: true });
}

export function markSkew(): void {
  set({ skew: true, available: true });
}

/** For tests only. */
export function resetUpdateStateForTests(): void {
  state = { available: false, skew: false };
}

// ---------------------------------------------------------------------------------------------------------------------
// The service worker side: a waiting worker is an available update; `update()` on resume and every 30 min.
// ---------------------------------------------------------------------------------------------------------------------

export const SW_UPDATE_INTERVAL_MS = 30 * 60_000;

type Registration = Pick<ServiceWorkerRegistration, "waiting" | "installing" | "update" | "addEventListener" | "removeEventListener">;

/**
 * Watches `registration`: an installed worker waiting behind the active one (on load or after `updatefound`) marks the
 * update available. Only when the page is already controlled: the first install of a worker is not an update.
 */
export function watchRegistration(registration: Registration, controlled: () => boolean): () => void {
  const check = () => {
    if (registration.waiting && controlled()) markUpdateAvailable();
  };
  const onUpdateFound = () => {
    const worker = registration.installing;
    if (!worker) return;
    worker.addEventListener("statechange", () => {
      if (worker.state === "installed") check();
    });
  };
  check();
  registration.addEventListener("updatefound", onUpdateFound);
  return () => registration.removeEventListener("updatefound", onUpdateFound);
}

/** `registration.update()`, never throwing (offline, or the script answered an error: the next check retries). */
export function checkForWorkerUpdate(registration: Pick<ServiceWorkerRegistration, "update"> | null): void {
  if (!registration) return;
  registration.update().catch((err: unknown) => reportClientError("pwa.sw_update_check_failed", err));
}

// ---------------------------------------------------------------------------------------------------------------------
// Safe-point apply
// ---------------------------------------------------------------------------------------------------------------------

export interface ApplyDeps {
  waitingWorker: () => Pick<ServiceWorker, "postMessage"> | null;
  /** Resolves when the new worker took control (or after a short cap: the reload happens either way). */
  controllerChanged: () => Promise<void>;
  reload: () => void;
}

let applying = false;

/** Applies the update now: the waiting worker (if any) takes over, then the page reloads. */
export async function applyUpdate(deps: ApplyDeps): Promise<void> {
  if (applying) return;
  applying = true;
  try {
    const waiting = deps.waitingWorker();
    if (waiting) {
      waiting.postMessage({ type: "SKIP_WAITING" });
      await deps.controllerChanged();
    }
  } catch (err) {
    reportClientError("pwa.update_apply", err);
  } finally {
    deps.reload();
  }
}

/**
 * Called by the runtime on every route change. Returns true when it applied the update: one is available, it is not a
 * skew notice, and the dirty guard says nothing unsaved or in flight was on the page up to this change.
 */
export function onRouteChange(deps: ApplyDeps): boolean {
  const { safe } = takeNavigationVerdict();
  if (!state.available || state.skew || !safe) return false;
  void applyUpdate(deps);
  return true;
}

/** For tests only. */
export function resetApplyForTests(): void {
  applying = false;
}
