"use client";

import React, { useId } from "react";
import { Checkbox as CheckboxPrimitive } from "radix-ui";
import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { CHECKBOX_BOX, CHOICE_ROW, FOCUS_RING, TRANSITION } from "@/lib/ui/variants";

/**
 * Checkbox (V2-06 06-02a; 06-UI-SPEC Checkbox; Radix): a 16 px box (radius 4, border-control); checked = accent fill
 * with a white check, indeterminate = a white bar. `role="checkbox"` with `aria-checked` (`true | false | mixed`),
 * Space toggles, disabled is skipped by Tab. The whole label row is the hit area and is ≥ 44 px on touch.
 */
export interface CheckboxProps
  extends Omit<React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>, "children" | "className"> {
  /** The visible label; omit only with `aria-label`. */
  label?: React.ReactNode;
  className?: string;
}

export const Checkbox = React.forwardRef<HTMLButtonElement, CheckboxProps>(function Checkbox(
  { label, className, id, ...props },
  ref,
) {
  const generated = useId();
  const boxId = id ?? generated;
  const box = (
    <CheckboxPrimitive.Root ref={ref} id={boxId} className={cn(CHECKBOX_BOX, TRANSITION, FOCUS_RING)} {...props}>
      <CheckboxPrimitive.Indicator className="flex items-center justify-center">
        {props.checked === "indeterminate" ? (
          <Minus aria-hidden="true" className="size-3" strokeWidth={3} />
        ) : (
          <Check aria-hidden="true" className="size-3" strokeWidth={3} />
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
  if (label === undefined) return box;
  return (
    <label htmlFor={boxId} className={cn(CHOICE_ROW, "cursor-pointer", className)}>
      {box}
      <span>{label}</span>
    </label>
  );
});

Checkbox.displayName = "Checkbox";
