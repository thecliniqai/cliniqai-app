"use client";

import React from "react";
import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";
import { FOCUS_RING, SEGMENTED_COUNT, SEGMENTED_ITEM, SEGMENTED_TRACK, TRANSITION } from "@/lib/ui/variants";

/**
 * SegmentedControl (V2-06 06-02a; 06-UI-SPEC SegmentedControl; Radix RadioGroup): one choice out of a few, shown at
 * once ("Booked · Waiting · Doctor · Bill · Done", "°F / °C", "Male / Female / Other"). Track surface-muted, segments
 * 28 px on a fine pointer and 44 px on touch (CD-03); the selected segment is white with fg text and a hairline. An
 * optional count (tabular). `role="radiogroup"` + `role="radio"` / `aria-checked`; arrows move and select, wrapping.
 */
export interface SegmentOption {
  value: string;
  label: React.ReactNode;
  count?: number;
  disabled?: boolean;
}

export interface SegmentedControlProps
  extends Omit<React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root>, "children" | "className" | "orientation"> {
  /** The group's accessible name ("Lane", "Temperature unit"). */
  "aria-label": string;
  options: readonly SegmentOption[];
  /** Stretch the track to the container width (segments share it equally). */
  block?: boolean;
  className?: string;
}

export const SegmentedControl = React.forwardRef<HTMLDivElement, SegmentedControlProps>(function SegmentedControl(
  { options, block = false, className, ...props },
  ref,
) {
  return (
    <RadioGroupPrimitive.Root
      ref={ref}
      loop
      orientation="horizontal"
      className={cn(SEGMENTED_TRACK, block ? "flex w-full" : "w-fit", "no-scrollbar", className)}
      {...props}
    >
      {options.map((option) => (
        <RadioGroupPrimitive.Item
          key={option.value}
          value={option.value}
          disabled={option.disabled}
          className={cn(SEGMENTED_ITEM, TRANSITION, FOCUS_RING)}
        >
          <span>{option.label}</span>
          {option.count !== undefined && <span className={SEGMENTED_COUNT}>{option.count}</span>}
        </RadioGroupPrimitive.Item>
      ))}
    </RadioGroupPrimitive.Root>
  );
});

SegmentedControl.displayName = "SegmentedControl";
