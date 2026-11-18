import type { LabelHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Label (V2-06 06-02a; 06-UI-SPEC Field + Label): 12/500 fg-secondary above the control. Optional fields are marked
 * with an "Optional" tag (caption, fg-muted); required fields are not. `required` keeps the v1 asterisk for the v1
 * call sites of `Field` (their accessible names stay as they were, R-8).
 */
export const LABEL_CLASS = "flex items-center gap-1.5 text-label font-medium text-fg-secondary select-none";

export function Label({
  optional = false,
  required = false,
  className,
  children,
  ...props
}: LabelHTMLAttributes<HTMLLabelElement> & { optional?: boolean; required?: boolean; children: ReactNode }) {
  return (
    <label className={cn(LABEL_CLASS, className)} {...props}>
      <span>{children}</span>
      {required && <span className="text-label font-semibold text-danger-fg">*</span>}
      {optional && !required && <span className="text-caption font-normal text-fg-muted">Optional</span>}
    </label>
  );
}
