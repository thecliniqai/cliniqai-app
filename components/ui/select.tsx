import React from "react";
import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ invalid = false, className, children, ...props }, ref) => {
    return (
      <div className="relative w-full">
        <select
          ref={ref}
          aria-invalid={invalid}
          className={cn(
            "w-full min-h-[44px] px-3.5 py-2.5 pe-10 text-sm rounded-lg border bg-white text-gray-900 transition-colors shadow-theme-xs appearance-none cursor-pointer",
            "focus:outline-none focus:ring-3 focus:ring-offset-0",
            invalid
              ? "border-danger-solid focus:border-danger-solid focus:ring-danger-solid/15"
              : "border-gray-300 focus:border-accent focus:ring-ring/15",
            "disabled:opacity-50 disabled:bg-gray-50 disabled:cursor-not-allowed",
            className
          )}
          {...props}
        >
          {children}
        </select>
        <span className="absolute inset-y-0 end-0 flex items-center pe-3 pointer-events-none text-fg-subtle">
          <ChevronDown className="w-4 h-4" />
        </span>
      </div>
    );
  }
);

Select.displayName = "Select";
