"use client";

import { WifiOff } from "lucide-react";
import { useOnlineStatus, useStaleSince } from "@/lib/pwa/online";

/**
 * Offline banner (PWA_STRATEGY §3.6, DESIGN_SYSTEM offline banner; V2-06 06-05 step 9). The live region is always in
 * the DOM so assistive technology announces the change; it holds text only while offline. Data already on screen
 * stays visible (in memory, never persisted). Write buttons react to offline from 06-02a's Button primitive (R-32).
 */
export function OfflineBanner() {
  const online = useOnlineStatus();
  const since = useStaleSince();
  return (
    <div role="status" aria-live="polite" data-offline-banner="" className="fixed inset-x-0 bottom-0 z-[60] pointer-events-none">
      {online ? null : (
        <p className="pointer-events-auto flex items-center justify-center gap-2 bg-fg px-4 pt-2.5 pb-safe text-center text-body-sm text-surface">
          <WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            You&apos;re offline{since ? ` · showing data from ${since}` : ""}. Changes are disabled until you reconnect.
          </span>
        </p>
      )}
    </div>
  );
}
