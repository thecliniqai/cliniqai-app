"use client";

import { useLiveBadge } from "@/lib/live/provider";
import { cn } from "@/lib/utils";

/**
 * The live badge (V2-09e 09E-04, R-18; DESIGN_SYSTEM "Live data"): "Live" while the channel is SUBSCRIBED and a signal or a check confirmed the
 * versions within 24 s; otherwise "Reconnecting" with "Updated N s ago" (the time since the last confirmation, ticking every 5 s). A dot and
 * the words, never colour alone. Not a live region: changes are announced by the screen's own polite region (the board's, throttled), not by this label.
 * In Today's head now; the Schedule's head in 09E-12.
 */
export function LiveBadge({ className }: { className?: string }) {
  const badge = useLiveBadge();
  const state = badge.live ? "live" : "reconnecting";
  return (
    <p data-live-status={state} className={cn("inline-flex items-center gap-1.5 text-label text-fg-muted", className)}>
      <span
        aria-hidden="true"
        className={cn("size-2 shrink-0 rounded-pill", badge.live ? "bg-success-fg" : "border border-border-strong bg-surface")}
      />
      {badge.live ? "Live" : badge.secondsAgo === null ? "Reconnecting" : `Reconnecting · Updated ${badge.secondsAgo} s ago`}
    </p>
  );
}
