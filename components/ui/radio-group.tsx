"use client";

import React, { useId } from "react";
import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";
import { CHOICE_ROW, FOCUS_RING, RADIO_BOX, TRANSITION } from "@/lib/ui/variants";

/**
 * RadioGroup (V2-06 06-02a; 06-UI-SPEC RadioGroup; Radix): `role="radiogroup"` named by `label` (or `aria-label`), each
 * option a 16 px circle (border-control) with the accent ring and an 8 px accent dot when checked. Tab enters the group
 * on the checked option; the arrow keys move and select (roving focus, wrapping); disabled options are skipped. Each
 * row is ≥ 44 px on touch.
 */
export interface RadioOption {
  value: string;
  label: React.ReactNode;
  disabled?: boolean;
}

export interface RadioGroupProps
  extends Omit<React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root>, "children" | "className"> {
  /** The group's visible name (rendered above the options); or pass `aria-label`. */
  label?: React.ReactNode;
  options: readonly RadioOption[];
  className?: string;
}

export const RadioGroup = React.forwardRef<HTMLDivElement, RadioGroupProps>(function RadioGroup(
  { label, options, className, orientation = "horizontal", ...props },
  ref,
) {
  const base = useId();
  const labelId = label !== undefined ? `${base}-label` : undefined;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label !== undefined && (
        <span id={labelId} className="text-label font-medium text-fg-secondary">
          {label}
        </span>
      )}
      <RadioGroupPrimitive.Root
        ref={ref}
        loop
        orientation={orientation}
        aria-labelledby={labelId}
        className={cn("flex", orientation === "vertical" ? "flex-col gap-1" : "flex-wrap gap-x-4 gap-y-1")}
        {...props}
      >
        {options.map((option, index) => {
          const id = `${base}-${index}`;
          return (
            <label key={option.value} htmlFor={id} className={cn(CHOICE_ROW, !option.disabled && "cursor-pointer")}>
              <RadioGroupPrimitive.Item
                id={id}
                value={option.value}
                disabled={option.disabled}
                className={cn(RADIO_BOX, TRANSITION, FOCUS_RING)}
              >
                <RadioGroupPrimitive.Indicator className="block size-2 rounded-pill bg-accent" />
              </RadioGroupPrimitive.Item>
              <span>{option.label}</span>
            </label>
          );
        })}
      </RadioGroupPrimitive.Root>
    </div>
  );
});

RadioGroup.displayName = "RadioGroup";
