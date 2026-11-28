"use client";

import { useCallback, type MouseEvent } from "react";

/**
 * In-place navigation of the Schedule (V2-09e 09E-12, R-10): a change of date, view or doctor moves the address with `history.pushState` (the App Router
 * keeps `useSearchParams` in step), so the screen reads its range query instead of rendering the page again. Links stay real links.
 */
export function useScheduleNavigate(): (href: string) => void {
  return useCallback((href: string) => window.history.pushState(null, "", href), []);
}

/** A plain click moves in place; a modified click (new tab, new window) keeps the browser's own behaviour. */
export function inPlace(navigate: (href: string) => void, href: string) {
  return (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(href);
  };
}
