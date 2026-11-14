import { Check, CircleAlert, CloudOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatClinicTime } from "@/lib/datetime/format";
import { FOCUS_RING } from "@/lib/ui/variants";

/**
 * SaveStatus (V2-06 06-03a; 06-UI-SPEC SaveStatus, CD-26): the autosave state of a form (the consult note).
 * - `saving`: "Saving…" with a spinner (fg-muted);
 * - `saved`: "Saved · 10:42 am" with a check (success-fg);
 * - `offline`: "Offline · not saved. Reconnect to save" (CloudOff, warning-fg);
 * - `error`: "Couldn't save · Retry" (CircleAlert, danger-fg; Retry is a link button).
 * One polite live region that always exists (`role="status"`), so every change is announced once. Below 768 px only
 * the offline and error states are drawn; saving and saved stay in the live region for screen readers (CD-26: the
 * prototype hides it on phones, failures must stay visible). `idle` renders the empty region. Server or Client
 * Component (`onRetry` needs a Client parent).
 */
export type SaveState = "idle" | "saving" | "saved" | "offline" | "error";

export interface SaveStatusProps {
  state: SaveState;
  /** `saved`: the clinic wall-clock time of the last save, `HH:mm`. */
  savedAt?: string | null;
  onRetry?: () => void;
  className?: string;
}

export function SaveStatus({ state, savedAt, onRetry, className }: SaveStatusProps) {
  const quiet = state === "saving" || state === "saved";
  return (
    <div
      role="status"
      aria-live="polite"
      data-save-status={state}
      className={cn(
        "inline-flex min-h-6 items-center gap-1.5 text-label text-fg-muted",
        quiet && "max-md:sr-only",
        className,
      )}
    >
      {state === "saving" && (
        <>
          <span
            aria-hidden="true"
            className="size-3.25 shrink-0 rounded-pill border-2 border-border-strong border-t-fg-muted motion-safe:animate-spin"
          />
          Saving…
        </>
      )}
      {state === "saved" && (
        <>
          <Check aria-hidden="true" strokeWidth={2.25} className="size-3.25 shrink-0 text-success-fg" />
          {savedAt ? `Saved · ${formatClinicTime(savedAt)}` : "Saved"}
        </>
      )}
      {state === "offline" && (
        <>
          <CloudOff aria-hidden="true" className="size-3.25 shrink-0 text-warning-fg" />
          Offline · not saved. Reconnect to save
        </>
      )}
      {state === "error" && (
        <>
          <CircleAlert aria-hidden="true" className="size-3.25 shrink-0 text-danger-fg" />
          <span>Couldn&apos;t save</span>
          {onRetry && (
            <>
              <span aria-hidden="true">·</span>
              <button
                type="button"
                onClick={onRetry}
                className={cn(
                  "inline-flex min-h-6 cursor-pointer items-center justify-center rounded-sm px-0.5 font-medium text-accent-fg underline-offset-2 hover:underline touch:min-h-control touch:min-w-control",
                  FOCUS_RING,
                )}
              >
                Retry
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}
