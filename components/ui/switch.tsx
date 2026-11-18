"use client";

import React, { useId } from "react";
import { Switch as SwitchPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";
import { CHOICE_ROW, FOCUS_RING, SWITCH_THUMB, SWITCH_TRACK, TRANSITION } from "@/lib/ui/variants";

/**
 * Switch (V2-06 06-02a; 06-UI-SPEC Switch; Radix): track 34×20 (off border-control, on accent), white 16 px thumb,
 * 120 ms. `role="switch"` with `aria-checked`; Space (and Enter) toggles; disabled is skipped by Tab. For settings that
 * take effect at once only (a form field that saves on submit is a Checkbox). The label row is ≥ 44 px on touch.
 */
export interface SwitchProps
  extends Omit<React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>, "children" | "className"> {
  /** The visible label; omit only with `aria-label`. */
  label?: React.ReactNode;
  className?: string;
}

export const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(function Switch(
  { label, className, id, ...props },
  ref,
) {
  const generated = useId();
  const switchId = id ?? generated;
  const control = (
    <SwitchPrimitive.Root ref={ref} id={switchId} className={cn(SWITCH_TRACK, TRANSITION, FOCUS_RING)} {...props}>
      <SwitchPrimitive.Thumb className={SWITCH_THUMB} />
    </SwitchPrimitive.Root>
  );
  if (label === undefined) return control;
  return (
    <label htmlFor={switchId} className={cn(CHOICE_ROW, "cursor-pointer", className)}>
      {control}
      <span>{label}</span>
    </label>
  );
});

Switch.displayName = "Switch";
