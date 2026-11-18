"use client";

import React from "react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";
import { POP_IN, POPOVER_SURFACE } from "@/lib/ui/variants";

/**
 * Popover (V2-06 06-02b; 06-UI-SPEC Popover, DESIGN_SYSTEM §6.3; Radix): non-modal anchored content (filters, a quick
 * vitals view). Radius-lg, hairline, `shadow-popover`, padding 12 (`padding="list"`: 4, for lists); at most 320 px tall
 * with its own scroll, never wider than the viewport − 32 px; 200 ms fade and 4 px rise.
 *
 * Opens from its trigger (click, or Enter / Space on the focused trigger) and moves focus into itself; Escape and an
 * outside click close it and focus returns to the trigger. The trigger carries `aria-expanded` and `aria-controls`.
 */
export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;
export const PopoverClose = PopoverPrimitive.Close;

export const POPOVER_PANEL =
  "max-h-[min(20rem,var(--radix-popover-content-available-height))] w-max max-w-[calc(100vw-2rem)] overflow-y-auto overscroll-contain";

export const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content> & { padding?: "content" | "list" }
>(function PopoverContent({ className, align = "start", sideOffset = 6, padding = "content", ...props }, ref) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        ref={ref}
        align={align}
        sideOffset={sideOffset}
        collisionPadding={16}
        data-overlay="popover"
        className={cn(POPOVER_SURFACE, POPOVER_PANEL, POP_IN, padding === "list" ? "p-1" : "p-3", className)}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
});
