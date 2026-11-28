"use client";

import { useEffect } from "react";
import { useLiveCore } from "./provider";

/**
 * A live screen (Today now, Schedule in 09E-12) registers while it is mounted (V2-09e 09E-04, R-18): the heartbeat of the shell's live core runs
 * while at least one is open and the tab is visible. The screen's queries carry their domains in `meta.domains` (`lib/query/keys.ts`); this hook
 * only turns the heartbeat on.
 */
export function useLiveScreen(): void {
  const core = useLiveCore();
  useEffect(() => core?.registerScreen(isDocumentLoadPage()), [core]);
}

/**
 * PR 2 review N1: whether the page on screen is the one this document loaded with (its path equals the navigation entry's), rather than one reached by
 * in-app navigation. Only such a screen takes the check a join made before any screen owed (`registerScreen`).
 */
function isDocumentLoadPage(): boolean {
  try {
    const entry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    return new URL(entry?.name ?? window.location.href).pathname === window.location.pathname;
  } catch {
    return false;
  }
}
