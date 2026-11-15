"use client";

import { useSyncExternalStore } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useOnlineStatus } from "@/lib/pwa/online";
import { getServerUpdateState, getUpdateState, subscribeUpdate } from "@/lib/pwa/update";
import { cn } from "@/lib/utils";

export const UPDATE_READY_TEXT = "A new version is ready";
export const SKEW_TEXT = "This app was updated. Reload to continue.";

/**
 * The update toast (V2-06 06-06; PWA_STRATEGY §3.7 step 3, 06-UI-SPEC "Banners and toasts"): "A new version is ready ·
 * Reload", or after a skew error "This app was updated. Reload to continue." with the same action. A token-styled live
 * region that is always in the DOM (announced politely when it fills); 06-04b moves it onto the `sonner` Toaster.
 * Non-blocking: it never covers the page's own controls on a phone (bottom, full width minus margins) and sits above
 * the offline banner when both show. Reload is the user's choice here; the runtime applies the update by itself only
 * at a safe point (`lib/pwa/update.ts`).
 */
export function UpdateToast({ onReload }: { onReload: () => void }) {
  const state = useSyncExternalStore(subscribeUpdate, getUpdateState, getServerUpdateState);
  const online = useOnlineStatus();
  const text = state.skew ? SKEW_TEXT : UPDATE_READY_TEXT;
  return (
    <div
      role="status"
      aria-live="polite"
      data-update-toast=""
      className={cn(
        "pointer-events-none fixed inset-x-3 z-[61] flex justify-center md:inset-x-auto md:right-4",
        online ? "bottom-[calc(1rem+env(safe-area-inset-bottom,0px))]" : "bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))]",
      )}
    >
      {state.available ? (
        <div
          data-update-kind={state.skew ? "skew" : "ready"}
          className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-lg border border-border bg-surface py-2 pr-2 pl-4 text-body-sm text-fg shadow-popover"
        >
          <RefreshCw className="size-4 shrink-0 text-fg-muted" aria-hidden="true" />
          <span className="min-w-0 flex-1">{text}</span>
          <Button type="button" size="sm" variant="primary" onClick={onReload}>
            Reload
          </Button>
        </div>
      ) : null}
    </div>
  );
}
