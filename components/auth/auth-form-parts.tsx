"use client";

import React, { useState } from "react";
import { Eye, EyeOff, Stethoscope } from "lucide-react";
import { cn } from "@/lib/utils";

/** Mobile-only brand header shown above the auth forms (the showcase panel covers desktop). */
export function AuthMobileBrand() {
  return (
    <div className="lg:hidden flex items-center gap-2.5 pb-2 border-b border-gray-100">
      <div className="w-9 h-9 rounded-xl bg-accent text-white flex items-center justify-center shadow-theme-xs">
        <Stethoscope className="w-5 h-5" aria-hidden="true" />
      </div>
      <span className="text-base font-bold text-gray-900">ClinicOS</span>
    </div>
  );
}

/**
 * Live region for form errors and notices. It is always rendered so screen readers announce changes to it.
 */
export function FormMessage({
  id,
  tone,
  message,
}: {
  id: string;
  tone: "error" | "info";
  message: string | null;
}) {
  return (
    <div id={id} aria-live={tone === "error" ? "assertive" : "polite"} aria-atomic="true">
      {message && (
        <p
          className={cn(
            "p-3.5 text-sm rounded-xl border leading-relaxed",
            tone === "error"
              ? "bg-red-50 border-red-200 text-red-700"
              : "bg-blue-50 border-blue-100 text-gray-700",
          )}
        >
          {message}
        </p>
      )}
    </div>
  );
}

export interface PasswordInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "autoComplete"> {
  id: string;
  autoComplete: "current-password" | "new-password";
  invalid?: boolean;
}

/** Password field with a show/hide toggle (AUTH_REDESIGN §5: paste, managers and a show-password toggle). */
export const PasswordInput = React.forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ id, invalid = false, className, ...props }, ref) => {
    const [visible, setVisible] = useState(false);
    return (
      <div className="relative w-full">
        <input
          ref={ref}
          id={id}
          type={visible ? "text" : "password"}
          aria-invalid={invalid || undefined}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className={cn(
            "w-full min-h-[44px] ps-3.5 pe-12 py-2.5 text-sm rounded-lg border bg-white text-gray-900 placeholder:text-fg-placeholder transition-colors shadow-theme-xs",
            "focus:outline-none focus:ring-3 focus:ring-offset-0",
            invalid
              ? "border-danger-solid focus:border-danger-solid focus:ring-danger-solid/15"
              : "border-gray-300 focus:border-accent focus:ring-ring/15",
            "disabled:opacity-50 disabled:bg-gray-50 disabled:cursor-not-allowed",
            className,
          )}
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          aria-controls={id}
          className="absolute inset-y-0 end-0 flex items-center justify-center w-11 text-gray-500 hover:text-gray-800 rounded-e-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          {visible ? <EyeOff className="w-4 h-4" aria-hidden="true" /> : <Eye className="w-4 h-4" aria-hidden="true" />}
        </button>
      </div>
    );
  },
);

PasswordInput.displayName = "PasswordInput";
