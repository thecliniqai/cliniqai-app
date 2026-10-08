import React from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  startIcon?: React.ReactNode;
  endIcon?: React.ReactNode;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ invalid = false, startIcon, endIcon, className, ...props }, ref) => {
    return (
      <div className="relative w-full">
        {startIcon && (
          <span className="absolute inset-y-0 start-0 flex items-center ps-3.5 pointer-events-none text-gray-400">
            {startIcon}
          </span>
        )}
        <input
          ref={ref}
          aria-invalid={invalid}
          className={cn(
            "w-full min-h-[44px] px-3.5 py-2.5 text-sm rounded-lg border bg-white text-gray-900 placeholder:text-gray-400 transition-colors shadow-theme-xs",
            "focus:outline-none focus:ring-3 focus:ring-offset-0",
            startIcon && "ps-10",
            endIcon && "pe-10",
            invalid
              ? "border-[#B42318] focus:border-[#B42318] focus:ring-[#B42318]/15"
              : "border-gray-300 focus:border-[#1769E0] focus:ring-[#1769E0]/15",
            "disabled:opacity-50 disabled:bg-gray-50 disabled:cursor-not-allowed",
            className
          )}
          {...props}
        />
        {endIcon && (
          <span className="absolute inset-y-0 end-0 flex items-center pe-3.5 pointer-events-none text-gray-400">
            {endIcon}
          </span>
        )}
      </div>
    );
  }
);

Input.displayName = "Input";
