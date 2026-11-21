import { cn } from "@/lib/utils";
import { POLL_INTERVAL_MS, type LiveState } from "./use-today-live";

/**
 * LiveStatus (V2-08 08-03a; 06-UI-SPEC §8 "Live data"): "Live" while the Realtime channel is joined, "Updating every 20 s"
 * while the board polls instead, "Connecting…" until the channel has answered once. A dot and the words, never colour
 * alone. Not a live region: changes are announced by the board's own polite region (throttled), not by this label.
 */
const TEXT: Record<LiveState, string> = {
  connecting: "Connecting…",
  live: "Live",
  polling: `Updating every ${POLL_INTERVAL_MS / 1000} s`,
};

export function LiveStatus({ state, className }: { state: LiveState; className?: string }) {
  return (
    <p data-live-status={state} className={cn("inline-flex items-center gap-1.5 text-label text-fg-muted", className)}>
      <span
        aria-hidden="true"
        className={cn("size-2 shrink-0 rounded-pill", state === "live" ? "bg-success-fg" : "border border-border-strong bg-surface")}
      />
      {TEXT[state]}
    </p>
  );
}
