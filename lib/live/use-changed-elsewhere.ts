"use client";

import { useState } from "react";
import type { LiveDomain, Versions } from "./domains";
import { useSeenVersions } from "./provider";

/**
 * The flag of the screens that do not re-render by themselves (a patient, Visits, Billing reports, Settings, Staff; R-9, R-18): true when a
 * domain they display has moved since the page's data was read. `basis` is the versions the page read with its data (09E-06 hands them over);
 * without it the first confirmed versions after the screen opened are the baseline (the notice then covers changes after that moment). The
 * screens that show it are placed in 09E-06; this is the rule, tested with the live core.
 */
export function useChangedElsewhere(domains: readonly LiveDomain[], basis?: Versions): boolean {
  const seen = useSeenVersions();
  const [baseline, setBaseline] = useState<Versions | null>(basis ?? null);
  if (seen === null) return false;
  if (baseline === null) {
    // The first confirmed versions are the baseline (a state update during render, guarded: it runs once).
    setBaseline(seen);
    return false;
  }
  return domains.some((domain) => seen[domain] > baseline[domain]);
}
