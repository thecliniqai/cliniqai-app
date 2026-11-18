"use client";

import React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { CONTROL_BASE, CONTROL_HEIGHT, CONTROL_STATE, FOCUS_RING, TRANSITION, controlState } from "@/lib/ui/variants";
import { useFieldProps } from "./field";

/**
 * NativeSelect (V2-06 06-02a; 06-UI-SPEC NativeSelect): the native `<select>` on the Input skin with a 16 px chevron at
 * right 8 (padding-right 30), for short lists (≤ 15 options; longer lists use a combobox, 06-03b). Always named: inside
 * a `Field` it takes the field's id (so the label names it); elsewhere pass `aria-label` or `aria-labelledby` (the M0
 * axe `select-name` finding; the gallery axe spec checks every specimen). v1 `Select` is this component under its v1
 * name.
 */
export interface NativeSelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
  wrapperClassName?: string;
}

export const NativeSelect = React.forwardRef<HTMLSelectElement, NativeSelectProps>(function NativeSelect(
  {
    invalid,
    className,
    wrapperClassName,
    disabled,
    id,
    children,
    "aria-describedby": describedBy,
    "aria-invalid": ariaInvalid,
    ...props
  },
  ref,
) {
  const field = useFieldProps({ id, "aria-describedby": describedBy, "aria-invalid": ariaInvalid, invalid });
  const state = controlState({ invalid: field.invalid, disabled });
  return (
    <div className={cn("relative w-full", wrapperClassName)}>
      <select
        ref={ref}
        {...props}
        id={field.id}
        disabled={disabled}
        aria-describedby={field["aria-describedby"]}
        aria-invalid={field.invalid || undefined}
        className={cn(
          CONTROL_BASE,
          CONTROL_HEIGHT,
          TRANSITION,
          FOCUS_RING,
          CONTROL_STATE[state],
          "cursor-pointer appearance-none pr-7.5 pl-2.5",
          state === "disabled" && "cursor-not-allowed",
          className,
        )}
      >
        {children}
      </select>
      <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-fg-icon">
        <ChevronDown aria-hidden="true" className="size-4" strokeWidth={1.75} />
      </span>
    </div>
  );
});

NativeSelect.displayName = "NativeSelect";
