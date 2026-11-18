"use client";

import React, { createContext, useContext, useId } from "react";
import { CircleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { joinIds } from "@/lib/ui/ids";
import { Label } from "./label";

/**
 * Field (V2-06 06-02a; 06-UI-SPEC Field + Label, DESIGN_SYSTEM §6.2): label above the control, an optional hint, and
 * the error with an icon. It wires the control for assistive technology: the control inside takes the field's `id`,
 * `aria-describedby` (hint, then error) and `aria-invalid` from context, so a call site cannot forget them. `Input`,
 * `Textarea` and `NativeSelect` read the context; any other control can call `useFieldControl()`.
 *
 * v1 props kept (`label`, `htmlFor`, `error`, `help` / `helpText`, `required` with its asterisk, `className`); the
 * error keeps its v1 id `<htmlFor>-error`. New: `hint`, `optional` (the "Optional" tag), `htmlFor` may be omitted.
 */
export interface FieldControl {
  id: string;
  describedBy: string | undefined;
  invalid: boolean;
}

const FieldContext = createContext<FieldControl | null>(null);

/** The surrounding Field's wiring, or null outside a Field. */
export function useFieldControl(): FieldControl | null {
  return useContext(FieldContext);
}

/** Merges a control's own props with its Field's wiring (explicit props win; describedby ids are joined). */
export function useFieldProps(props: {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: React.AriaAttributes["aria-invalid"];
  invalid?: boolean;
}): { id: string | undefined; "aria-describedby": string | undefined; invalid: boolean } {
  const field = useFieldControl();
  const invalid = Boolean(props.invalid) || props["aria-invalid"] === true || props["aria-invalid"] === "true" || Boolean(field?.invalid);
  return {
    id: props.id ?? field?.id,
    "aria-describedby": joinIds(field?.describedBy, props["aria-describedby"]),
    invalid,
  };
}

export interface FieldProps {
  label: React.ReactNode;
  htmlFor?: string;
  error?: string;
  hint?: React.ReactNode;
  /** v1 name of `hint`. */
  help?: string;
  /** v1 name of `hint`. */
  helpText?: string;
  required?: boolean;
  optional?: boolean;
  className?: string;
  children: React.ReactNode;
}

export function Field({
  label,
  htmlFor,
  error,
  hint,
  help,
  helpText,
  required = false,
  optional = false,
  className,
  children,
}: FieldProps) {
  const generated = useId();
  const id = htmlFor ?? generated;
  const hintText = hint ?? help ?? helpText;
  const hintId = hintText ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const control: FieldControl = { id, describedBy: joinIds(hintId, errorId), invalid: Boolean(error) };

  return (
    <div className={cn("grid w-full gap-1.5 text-left", className)}>
      <Label htmlFor={id} required={required} optional={optional}>
        {label}
      </Label>
      <FieldContext.Provider value={control}>{children}</FieldContext.Provider>
      {hintText && (
        <p id={hintId} className="text-label text-fg-muted">
          {hintText}
        </p>
      )}
      {error && (
        <p id={errorId} className="flex items-start gap-1 text-label text-danger-fg">
          <CircleAlert aria-hidden="true" className="mt-px size-3.5 shrink-0" strokeWidth={1.75} />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}
