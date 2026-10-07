import React from "react";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ invalid = false, className = "", ...props }, ref) => {
    return (
      <input
        ref={ref}
        aria-invalid={invalid}
        className={`w-full min-h-[44px] px-3 py-2 text-base rounded-[var(--radius-md)] border bg-white text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-offset-1 transition-colors disabled:opacity-50 disabled:bg-[var(--surface-subtle)] ${
          invalid
            ? "border-[var(--status-error)] focus:ring-[var(--status-error)]"
            : "border-[var(--border-default)] focus:border-[var(--border-focus)] focus:ring-[var(--border-focus)]"
        } ${className}`}
        {...props}
      />
    );
  }
);

Input.displayName = "Input";
