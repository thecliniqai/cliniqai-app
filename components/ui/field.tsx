import React from "react";
import { cn } from "@/lib/utils";

export interface FieldProps {
  label: string;
  htmlFor: string;
  error?: string;
  help?: string;
  helpText?: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}

export function Field({
  label,
  htmlFor,
  error,
  help,
  helpText,
  required = false,
  className,
  children,
}: FieldProps) {
  const displayHelp = help || helpText;

  return (
    <div className={cn("flex flex-col gap-1.5 w-full text-left", className)}>
      <label
        htmlFor={htmlFor}
        className="text-sm font-medium text-gray-700 flex items-center gap-1 select-none"
      >
        <span>{label}</span>
        {required && <span className="text-[#B42318] text-xs font-bold">*</span>}
      </label>
      {children}
      {displayHelp && !error && (
        <p className="text-xs text-gray-500 mt-0.5">{displayHelp}</p>
      )}
      {error && (
        <p id={`${htmlFor}-error`} className="text-xs text-[#B42318] font-medium mt-0.5">
          {error}
        </p>
      )}
    </div>
  );
}
