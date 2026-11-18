"use client";

import React, { useState } from "react";
import { cn } from "@/lib/utils";
import { CONTROL_BASE, CONTROL_STATE, FOCUS_RING, TRANSITION, controlState } from "@/lib/ui/variants";
import { useFieldProps } from "./field";

/**
 * Textarea (V2-06 06-02a; 06-UI-SPEC Textarea): the Input skin, padding 8 10, at least 3 rows (72 px), growing with its
 * content up to 12 rows and then scrolling (`field-sizing: content`; browsers without it keep a resizable box). A
 * counter shows only when `maxLength` is set. Inside a `Field` it takes the field's id, description and invalid state.
 */
export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  {
    invalid,
    className,
    disabled,
    readOnly,
    id,
    maxLength,
    onChange,
    "aria-describedby": describedBy,
    "aria-invalid": ariaInvalid,
    ...props
  },
  ref,
) {
  const field = useFieldProps({ id, "aria-describedby": describedBy, "aria-invalid": ariaInvalid, invalid });
  const state = controlState({ invalid: field.invalid, disabled, readOnly });
  const initial = typeof props.value === "string" ? props.value : typeof props.defaultValue === "string" ? props.defaultValue : "";
  const [typed, setTyped] = useState(initial.length);
  const length = typeof props.value === "string" ? props.value.length : typed;

  return (
    <div className="flex w-full flex-col gap-1">
      <textarea
        ref={ref}
        {...props}
        id={field.id}
        disabled={disabled}
        readOnly={readOnly}
        maxLength={maxLength}
        aria-describedby={field["aria-describedby"]}
        aria-invalid={field.invalid || undefined}
        onChange={(event) => {
          setTyped(event.target.value.length);
          onChange?.(event);
        }}
        className={cn(
          CONTROL_BASE,
          TRANSITION,
          FOCUS_RING,
          CONTROL_STATE[state],
          "min-h-18 max-h-70.5 resize-y px-2.5 py-2 leading-(--text-body--line-height) field-sizing-content",
          className,
        )}
      />
      {maxLength !== undefined && (
        <span className="self-end text-label tabular-nums text-fg-muted">
          {length}/{maxLength}
        </span>
      )}
    </div>
  );
});

Textarea.displayName = "Textarea";
