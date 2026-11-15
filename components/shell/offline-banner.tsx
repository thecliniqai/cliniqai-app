"use client";

import { WifiOff } from "lucide-react";
import { useOnlineStatus, useStaleSince } from "@/lib/pwa/online";

/**
 * Offline banner (PWA_STRATEGY §3.6, DESIGN_SYSTEM offline banner; V2-06 06-05 step 9). The live region is always in
 * the DOM so assistive technology announces the change; it holds text only while offline. Data already on screen
 * stays visible (in memory, never persisted). Write buttons react to offline from 06-02a's Button primitive (R-32).
 *
 * 06-04b (CD-23): `--banner-offline-*` (Midnight); fixed at the viewport bottom, and above the BottomBar on phones while
 * the shell shows one (`data-bottom-bar="shown"` on the shell root). Copy unchanged.
 */
export function OfflineBanner() {
  const online = useOnlineStatus();
  const since = useStaleSince();
  return (
    <div
      role="status"
      aria-live="polite"
      data-offline-banner=""
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] max-md:group-data-[bottom-bar=shown]/shell:bottom-[calc(var(--spacing-bottom-bar)+env(safe-area-inset-bottom,0px))]"
    >
      {online ? null : (
        <p className="pointer-events-auto flex items-center justify-center gap-2 bg-(--banner-offline-bg) px-4 pt-2.5 pb-safe text-center text-body-sm text-(--banner-offline-fg) max-md:group-data-[bottom-bar=shown]/shell:pb-2.5">
          <WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            You&apos;re offline{since ? ` · showing data from ${since}` : ""}. Changes are disabled until you reconnect.
          </span>
        </p>
      )}
    </div>
  );
}
