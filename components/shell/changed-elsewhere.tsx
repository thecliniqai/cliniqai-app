"use client";

import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import type { LiveDomain, Versions } from "@/lib/live/domains";
import { useChangedElsewhere } from "@/lib/live/use-changed-elsewhere";

/**
 * "Changed on another device · Refresh" (V2-09e 09E-06, R-9, R-18): the notice of a screen that does not re-render by itself (a patient's record, Visits, Billing
 * reports, Settings, Staff). It shows when a clinic domain the screen displays has a newer version than the one the page read with its data (`basis`), as an
 * inline `Banner` (not a toast) announced politely; nothing on the screen changes until the person chooses Refresh, which is `router.refresh()` (the page is
 * read again, so a record the page writes an audit row for writes one then, not before). Nothing is shown before the first confirmation and none for a
 * domain that did not move. The notice says nothing about what changed or who changed it (no personal data in a banner).
 */
export function ChangedElsewhere({ domains, basis }: { domains: readonly LiveDomain[]; basis?: Versions }) {
  const changed = useChangedElsewhere(domains, basis);
  const router = useRouter();
  if (!changed) return null;
  return (
    <Banner
      tone="trial"
      role="status"
      className="rounded-lg"
      icon={<RefreshCw />}
      action={
        <Button type="button" variant="link" size="sm" onClick={() => router.refresh()}>
          Refresh
        </Button>
      }
    >
      Changed on another device
    </Banner>
  );
}
