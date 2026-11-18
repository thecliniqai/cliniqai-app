"use client";

import React, { useRef } from "react";
import { cn } from "@/lib/utils";
import { inputKindAttributes, type InputKind } from "@/lib/ui/input-kind";
import { CONTROL_BASE, CONTROL_HEIGHT, CONTROL_STATE, FOCUS_RING, TRANSITION, controlState } from "@/lib/ui/variants";
import { useFieldProps } from "./field";

/**
 * Input (V2-06 06-02a; 06-UI-SPEC Input, PWA-07). 36 px / 14 px on a fine pointer, 44 px / 16 px on touch (no iOS
 * zoom on focus). `kind` sets `type`, `inputMode`, `autoComplete`, `enterKeyHint` and `autoCapitalize` from
 * `lib/ui/input-kind.ts`; explicit props win. Inside a `Field` it takes the field's id, description and invalid state.
 *
 * States: default, hover (border fg-muted), focus (the ring outside), disabled (surface-muted), invalid
 * (`input-invalid-border` and `aria-invalid`), read-only (CD-27: surface-soft, hairline, no hover).
 * Adornments: `startIcon` / `endIcon` (16 px icons inside the box) and `startAdornment` / `endAdornment` (a unit block
 * such as "₹", "+91", "kg", "mmHg" on surface-soft with a hairline divider; the ring then draws around the whole box).
 * v1 props kept: `invalid`, `startIcon`, `endIcon`.
 */
export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  kind?: InputKind;
  invalid?: boolean;
  startIcon?: React.ReactNode;
  endIcon?: React.ReactNode;
  startAdornment?: React.ReactNode;
  endAdornment?: React.ReactNode;
  /** Classes for the wrapper element (the input's own classes go in `className`). */
  wrapperClassName?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    kind,
    invalid,
    startIcon,
    endIcon,
    startAdornment,
    endAdornment,
    wrapperClassName,
    className,
    disabled,
    readOnly,
    id,
    "aria-describedby": describedBy,
    "aria-invalid": ariaInvalid,
    ...props
  },
  ref,
) {
  const field = useFieldProps({ id, "aria-describedby": describedBy, "aria-invalid": ariaInvalid, invalid });
  const state = controlState({ invalid: field.invalid, disabled, readOnly });
  const adorned = Boolean(startAdornment || endAdornment);
  const inner = useRef<HTMLInputElement | null>(null);
  const setRefs = (node: HTMLInputElement | null) => {
    inner.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref) ref.current = node;
  };

  const input = (
    <input
      ref={setRefs}
      {...inputKindAttributes(kind)}
      {...props}
      id={field.id}
      disabled={disabled}
      readOnly={readOnly}
      aria-describedby={field["aria-describedby"]}
      aria-invalid={field.invalid || undefined}
      className={cn(
        CONTROL_BASE,
        TRANSITION,
        "px-2.5",
        adorned
          ? "h-full min-w-0 flex-1 rounded-none border-0 bg-transparent outline-none"
          : [CONTROL_HEIGHT, FOCUS_RING, CONTROL_STATE[state]],
        startIcon && "pl-8.5",
        endIcon && "pr-8.5",
        state === "disabled" && adorned && "cursor-not-allowed text-fg-muted",
        className,
      )}
    />
  );

  if (adorned) {
    // The whole box is the target (≥ 44 px on touch): a press on the unit block focuses the input.
    return (
      <div
        data-control-box=""
        role="presentation"
        onMouseDown={(event) => {
          if (event.target !== inner.current && !disabled) {
            event.preventDefault();
            inner.current?.focus();
          }
        }}
        className={cn(
          "flex w-full items-stretch overflow-hidden rounded-md border",
          CONTROL_HEIGHT,
          TRANSITION,
          CONTROL_STATE[state],
          "has-[input:focus-visible]:focus-ring",
          disabled ? "cursor-not-allowed" : "cursor-text",
          wrapperClassName,
        )}
      >
        {startAdornment && <Adornment side="start">{startAdornment}</Adornment>}
        {input}
        {endAdornment && <Adornment side="end">{endAdornment}</Adornment>}
      </div>
    );
  }

  return (
    <div className={cn("relative w-full", wrapperClassName)}>
      {startIcon && (
        <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-fg-icon [&_svg]:size-4">
          {startIcon}
        </span>
      )}
      {input}
      {endIcon && (
        <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-fg-icon [&_svg]:size-4">
          {endIcon}
        </span>
      )}
    </div>
  );
});

Input.displayName = "Input";

function Adornment({ side, children }: { side: "start" | "end"; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center bg-surface-soft px-2.5 text-body-sm text-fg-secondary",
        side === "start" ? "border-r border-border" : "border-l border-border",
      )}
    >
      {children}
    </span>
  );
}
