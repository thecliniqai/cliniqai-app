"use client";

import { useEffect } from "react";
import { registerServiceWorker } from "@/lib/pwa/register-sw";
import { OfflineBanner } from "@/components/shell/offline-banner";

/**
 * The PWA runtime of the authenticated shell (V2-06 06-05; PWA_STRATEGY §3.6, §3.7, §5), mounted once by
 * `app/(dashboard)/layout.tsx`. Registers the service worker (only when the server layout passes `swEnabled`:
 * `APP_ENV` is not `development`) and shows the offline banner. 06-06 adds the session-status poll, the update toast
 * and the lock reaction here; 06-04b re-homes it in the new shell.
 */
export function PwaRuntime({ swEnabled }: { swEnabled: boolean }) {
  useEffect(() => {
    if (swEnabled) void registerServiceWorker();
  }, [swEnabled]);

  return <OfflineBanner />;
}
