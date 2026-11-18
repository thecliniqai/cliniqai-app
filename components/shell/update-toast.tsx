"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { notify } from "@/components/ui/toast";
import { getServerUpdateState, getUpdateState, subscribeUpdate } from "@/lib/pwa/update";

export const UPDATE_READY_TEXT = "A new version is ready";
export const SKEW_TEXT = "This app was updated. Reload to continue.";
/** The sonner id of the update toast: one at a time, updated in place when a skew error follows. */
export const UPDATE_TOAST_ID = "app-update";

/**
 * The update toast (V2-06 06-06; moved onto `sonner` by 06-04b, R-29; PWA_STRATEGY §3.7 step 3, 06-UI-SPEC "Banners
 * and toasts"): "A new version is ready · Reload", or after a skew error "This app was updated. Reload to continue."
 * with the same action. A `role="status"` toast in the shell's Toaster (`components/shell/toaster.tsx`), so it stacks
 * with the other toasts above the BottomBar and the offline banner; it stays until the page reloads (no timer, no
 * Dismiss: the runtime applies the update by itself at the next safe point anyway, `lib/pwa/update.ts`). Reload is
 * the user's choice here. Renders nothing itself.
 */
export function UpdateToast({ onReload }: { onReload: () => void }) {
  const state = useSyncExternalStore(subscribeUpdate, getUpdateState, getServerUpdateState);
  const reload = useRef(onReload);
  useEffect(() => {
    reload.current = onReload;
  }, [onReload]);

  useEffect(() => {
    if (!state.available) {
      notify.dismiss(UPDATE_TOAST_ID);
      return;
    }
    notify.sticky(
      UPDATE_TOAST_ID,
      state.skew ? SKEW_TEXT : UPDATE_READY_TEXT,
      { label: "Reload", onClick: () => reload.current() },
      { "data-update-toast": "", "data-update-kind": state.skew ? "skew" : "ready" },
    );
  }, [state.available, state.skew]);

  return null;
}
