"use client";

import { useCallback, useRef } from "react";

/**
 * Focus return for modal overlays opened from state rather than a Radix `Trigger` (V2-06 06-02b).
 *
 * Radix's modal Dialog / AlertDialog always cancel the default close-autofocus and focus their `Trigger`. The v1
 * `<Modal>` call sites, the palette and the dirty-form "Discard changes?" question open from state and have no
 * Trigger, so focus fell to `<body>` on close (found by `keyboard/overlays.spec.ts`). This remembers the element that
 * had focus when the overlay opened (read in `onOpenAutoFocus`, before the focus scope moves focus) and returns focus
 * there on close. With nothing usable remembered (Safari does not focus a clicked button), Radix's own behaviour (the
 * Trigger) stays in charge.
 */
export function useFocusReturn() {
  const opener = useRef<HTMLElement | null>(null);

  const onOpenAutoFocus = useCallback(() => {
    const active = document.activeElement;
    opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
  }, []);

  const onCloseAutoFocus = useCallback((event: Event) => {
    const target = opener.current;
    opener.current = null;
    if (target && target.isConnected) {
      event.preventDefault();
      target.focus({ preventScroll: true });
    }
  }, []);

  return { onOpenAutoFocus, onCloseAutoFocus };
}
