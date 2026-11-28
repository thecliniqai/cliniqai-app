"use client";

import { useState } from "react";
import { LIVE_DOMAINS, type LiveDomain, type Versions } from "./domains";
import { useSeenVersions } from "./provider";

/**
 * The flag of the screens that do not re-render by themselves (a patient, Visits, Billing reports, Settings, Staff; R-9, R-18): true when a
 * domain they display has moved since the page's data was read. `basis` is the versions the page read with its data (09E-06 hands them over);
 * without it the first confirmed versions after the screen opened are the baseline (the notice then covers changes after that moment). The
 * screens that show it are `components/shell/changed-elsewhere.tsx` (09E-06); this is the rule, tested with the live core.
 */
/** The rule: a domain the screen displays has a newer version than the baseline. A domain that is not listed never counts. */
export function versionsMoved(domains: readonly LiveDomain[], baseline: Versions, seen: Versions): boolean {
  return domains.some((domain) => seen[domain] > baseline[domain]);
}

/** The key of a basis: a new server render of the same screen (Refresh) has a new one, and the baseline follows it. */
export function basisKeyOf(basis: Versions | undefined): string {
  return basis ? LIVE_DOMAINS.map((d) => basis[d]).join(".") : "";
}

export function useChangedElsewhere(domains: readonly LiveDomain[], basis?: Versions): boolean {
  const seen = useSeenVersions();
  const [baseline, setBaseline] = useState<Versions | null>(basis ?? null);
  // A newer server render of the same screen (Refresh) hands over the versions of its new data: the notice is answered, the baseline follows the page.
  const basisKey = basisKeyOf(basis);
  const [knownBasisKey, setKnownBasisKey] = useState(basisKey);
  if (basisKey !== knownBasisKey) {
    setKnownBasisKey(basisKey);
    setBaseline(basis ?? null);
  }
  if (seen === null) return false;
  if (baseline === null) {
    // The first confirmed versions are the baseline (a state update during render, guarded: it runs once).
    setBaseline(seen);
    return false;
  }
  return versionsMoved(domains, baseline, seen);
}
