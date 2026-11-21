"use client";

import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { FOCUS_RING } from "@/lib/ui/variants";

/** The small "remove this item" control of the consult's lists (44 px on touch). The accessible name says what is removed. */
export function RemoveButton({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={label}
      className={cn(
        "inline-flex size-control-compact shrink-0 cursor-pointer items-center justify-center rounded-sm text-fg-muted hover:text-danger-fg disabled:cursor-not-allowed disabled:text-fg-disabled max-lg:size-control",
        FOCUS_RING,
      )}
    >
      <X aria-hidden="true" className="size-3.5" />
    </button>
  );
}
