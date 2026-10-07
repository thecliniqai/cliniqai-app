import React from "react";

export interface FieldProps {
  label: string;
  htmlFor: string;
  error?: string;
  help?: string;
  helpText?: string;
  required?: boolean;
  children: React.ReactNode;
}

export function Field({
  label,
  htmlFor,
  error,
  help,
  helpText,
  required = false,
  children,
}: FieldProps) {
  const displayHelp = help || helpText;

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
      {displayHelp && !error && (
        <p className="text-xs text-[var(--text-secondary)]">{displayHelp}</p>
      )}
      {error && (
        <p id={`${htmlFor}-error`} className="text-xs text-[var(--status-error)] font-medium">
          {error}
        </p>
      )}
    </div>
  );
}
