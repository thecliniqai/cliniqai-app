"use client";

import React from "react";
import { Tooltip as TooltipPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";
import { Kbd } from "./kbd";

/**
 * Tooltip (V2-06 06-02b; 06-UI-SPEC Tooltip, CD-10; Radix): Midnight (`fg`) fill, white 12/500 label, radius-sm,
 * padding 4 8, `shadow-popover`, after 400 ms. Opens on pointer hover and on keyboard focus, closes on Escape, blur or
 * pointer leave; the trigger is described by it (`aria-describedby`). Never the only place information lives: it
 * repeats the control's name and adds a shortcut hint (Kbd, ≥ 1024 px on fine pointers, CD-33). Not shown on a
 * coarse pointer (CD-10): Radix ignores touch hover and the focus that follows a tap, and the bubble is hidden there.
 *
 * Each Tooltip carries its own provider, so it works anywhere (the shell may add a shared `TooltipProvider` later for
 * the skip-delay between neighbouring tooltips).
 */
export const TooltipProvider = TooltipPrimitive.Provider;

export const TOOLTIP_DELAY_MS = 400;

export interface TooltipProps {
  /** The tooltip text (usually the control's accessible name). */
  content: React.ReactNode;
  /** A shortcut hint shown after the text ("Ctrl K"). */
  shortcut?: string;
  side?: "top" | "right" | "bottom" | "left";
  /** The trigger: one focusable element that accepts a ref (a button). */
  children: React.ReactElement;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function Tooltip({ content, shortcut, side = "top", children, open, defaultOpen, onOpenChange }: TooltipProps) {
  return (
    <TooltipPrimitive.Provider delayDuration={TOOLTIP_DELAY_MS}>
      <TooltipPrimitive.Root open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipContent side={side}>
            {content}
            {shortcut && <Kbd className="ml-1.5">{shortcut}</Kbd>}
          </TooltipContent>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}

/** The bubble itself (exported for the gallery's static specimen). */
export const TOOLTIP_SURFACE =
  "z-50 inline-flex max-w-[min(18rem,calc(100vw-2rem))] items-center rounded-sm bg-fg px-2 py-1 text-label font-medium text-surface shadow-popover pointer-coarse:hidden";

export const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(function TooltipContent({ className, sideOffset = 6, ...props }, ref) {
  return (
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      collisionPadding={8}
      data-overlay="tooltip"
      className={cn(
        TOOLTIP_SURFACE,
        "motion-safe:transition-opacity motion-safe:duration-(--duration-fast) motion-safe:starting:opacity-0",
        className,
      )}
      {...props}
    />
  );
});
