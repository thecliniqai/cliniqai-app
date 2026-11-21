"use client";

import { useSyncExternalStore } from "react";

/** Whether the viewport is at least `px` wide. False on the server and during hydration; the real value follows (and tracks a resize or rotation). */
export function useMinWidth(px: number): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(`(min-width: ${px}px)`);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => window.matchMedia(`(min-width: ${px}px)`).matches,
    () => false,
  );
}
