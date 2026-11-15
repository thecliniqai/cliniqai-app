"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { registerServiceWorker } from "@/lib/pwa/register-sw";
import { onSignOutElsewhere } from "@/lib/pwa/auth-broadcast";
import { concealDocument, followSignOutElsewhere, hardSignOut } from "@/lib/auth/hard-sign-out";
import { checkSessionNow, currentPageDeploymentId, startSessionStatusWatch, type Reaction } from "@/lib/pwa/session-status";
import { onLocked } from "@/lib/pwa/lock";
import {
  applyUpdate,
  checkForWorkerUpdate,
  markUpdateAvailable,
  onRouteChange,
  SW_UPDATE_INTERVAL_MS,
  watchRegistration,
  type ApplyDeps,
} from "@/lib/pwa/update";
import { startDirtyGuard } from "@/lib/pwa/dirty-guard";
import { startSkewGuard } from "@/lib/pwa/skew";
import { countSignedInSession, startInstallCapture } from "@/lib/pwa/install";
import { OfflineBanner } from "@/components/shell/offline-banner";
import { UpdateToast } from "@/components/shell/update-toast";
import { InstallSheetHost } from "@/components/shell/install-sheet";

/** How long the reload waits for a skipped-waiting worker to take control before reloading anyway. */
const CONTROLLER_CHANGE_CAP_MS = 3000;

let registrationRef: ServiceWorkerRegistration | null = null;

/**
 * "Check for updates" (06-04b, More sheet; PWA §3.7): asks the waiting-worker check and the deployment check now.
 * Resolves `"update"` when another deployment answered (the update toast is then showing), else what the check did.
 */
export async function checkForUpdatesNow(): Promise<Reaction | "skipped"> {
  checkForWorkerUpdate(registrationRef);
  return checkSessionNow();
}

function browserApplyDeps(): ApplyDeps {
  return {
    waitingWorker: () => registrationRef?.waiting ?? null,
    controllerChanged: () =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, CONTROLLER_CHANGE_CAP_MS);
        navigator.serviceWorker?.addEventListener(
          "controllerchange",
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      }),
    reload: () => window.location.reload(),
  };
}

/**
 * The PWA runtime of the authenticated shell (V2-06 06-05, 06-06; PWA_STRATEGY §3.6, §3.7, §5, §6), mounted once by
 * the app shell (`components/shell/app-shell.tsx`, 06-04b), inside its root so the offline banner can sit above the
 * BottomBar. The update toast is a `sonner` toast since 06-04b (the shell mounts the Toaster).
 *
 * - 06-05: registers the service worker (only when the server layout passes `swEnabled`: `APP_ENV` is not
 *   `development`) and shows the offline banner.
 * - 06-09a (M-TABS): when another tab of this device signs out, this tab hides its content, runs the cleanups and the
 *   purge, and leaves for `/login` with no server call.
 * - 06-06: the session-status watch (`lib/pwa/session-status.ts`: on load, resume, `online`, every 5 min while visible,
 *   after any error) and its reactions: 401 → `hardSignOut("expired")`, 403 → `hardSignOut("removed")`, a lock →
 *   `onLocked` (D-8, session kept), another deployment → the update toast. The worker's `update()` on resume and every
 *   30 min (a waiting worker is an update too). The safe-point apply on route changes (`onRouteChange`: never over
 *   unsaved input or a running command, never after a skew notice). The skew guard (`unhandledrejection` and uncaught
 *   errors), the dirty guard, the install capture (`beforeinstallprompt`), the browser-session count for the Today
 *   install card, the update toast and the install sheet host.
 */
export function PwaRuntime({ swEnabled }: { swEnabled: boolean }) {
  const pathname = usePathname();
  const previousPath = useRef<string | null>(null);

  useEffect(() => {
    if (!swEnabled) return;
    let stopWatching: (() => void) | null = null;
    let cancelled = false;
    void registerServiceWorker().then((registration) => {
      if (cancelled || !registration) return;
      registrationRef = registration;
      stopWatching = watchRegistration(registration, () => navigator.serviceWorker?.controller != null);
    });
    const onVisible = () => {
      if (document.visibilityState === "visible") checkForWorkerUpdate(registrationRef);
    };
    document.addEventListener("visibilitychange", onVisible);
    const interval = window.setInterval(() => checkForWorkerUpdate(registrationRef), SW_UPDATE_INTERVAL_MS);
    return () => {
      cancelled = true;
      stopWatching?.();
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(interval);
    };
  }, [swEnabled]);

  useEffect(
    () =>
      onSignOutElsewhere(() => {
        // Patient data off the screen before anything else (the purge and the navigation take a moment).
        concealDocument();
        void followSignOutElsewhere();
      }),
    [],
  );

  useEffect(() => {
    const stops = [startDirtyGuard(document), startSkewGuard(window), startInstallCapture(window)];
    countSignedInSession();
    const watch = startSessionStatusWatch({
      fetch: (input, init) => window.fetch(input, init),
      pageDeploymentId: () => currentPageDeploymentId(),
      isVisible: () => document.visibilityState === "visible",
      listen: (onVisible, onOnline) => {
        const visible = () => {
          if (document.visibilityState === "visible") onVisible();
        };
        document.addEventListener("visibilitychange", visible);
        window.addEventListener("online", onOnline);
        return () => {
          document.removeEventListener("visibilitychange", visible);
          window.removeEventListener("online", onOnline);
        };
      },
      setInterval: (fn, ms) => window.setInterval(fn, ms),
      clearInterval: (handle) => window.clearInterval(handle as number),
      now: () => Date.now(),
      reactions: {
        expired: () => void hardSignOut("expired"),
        removed: () => void hardSignOut("removed"),
        locked: (destination) => void onLocked(destination),
        updateAvailable: () => markUpdateAvailable(),
      },
    });
    return () => {
      watch.stop();
      for (const stop of stops) stop();
    };
  }, []);

  useEffect(() => {
    if (previousPath.current !== null && previousPath.current !== pathname) onRouteChange(browserApplyDeps());
    previousPath.current = pathname;
  }, [pathname]);

  return (
    <>
      <OfflineBanner />
      <UpdateToast onReload={() => void applyUpdate(browserApplyDeps())} />
      <InstallSheetHost />
    </>
  );
}
