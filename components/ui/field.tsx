import React from "react";

export interface FieldProps {
  label: string;
  htmlFor: string;
  error?: string;
  helpText?: string;
  required?: boolean;
  children: React.ReactNode;
}

export function Field({
  label,
  htmlFor,
  error,
  helpText,
  required = false,
  children,
}: FieldProps) {
  return (
    <div className="flex flex-col gap-1.5 w-full text-left">
      <label
        htmlFor={htmlFor}
        className="text-sm font-medium text-[var(--text-primary)]"
      >
        {label}
        {required && <span className="text-[var(--status-error)] ml-1">*</span>}
      </label>
      {children}
      {helpText && !error && (
        <p className="text-xs text-[var(--text-secondary)]">{helpText}</p>
      )}
      {error && (
        <p id={`${htmlFor}-error`} className="text-xs text-[var(--status-error)] font-medium">
          {error}
        </p>
      )}
    </div>
  );
}
