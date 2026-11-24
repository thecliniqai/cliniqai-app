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
  useEffect(() => core?.registerScreen(), [core]);
}
