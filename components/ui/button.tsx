import React from "react";
import { cn } from "@/lib/utils";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "outline" | "danger" | "ghost";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  startIcon?: React.ReactNode;
  endIcon?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      children,
      variant = "primary",
      size = "md",
      loading = false,
      disabled,
      startIcon,
      endIcon,
      className,
      ...props
    },
    ref
  ) => {
    const baseStyles =
      "inline-flex items-center justify-center font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none select-none cursor-pointer";

    // 44px min touch target on mobile per DESIGN.md & AGENTS.md §26
    const sizeStyles = {
      sm: "h-9 px-3 text-xs sm:text-sm rounded-lg gap-1.5",
      md: "min-h-[44px] px-4 py-2 text-sm rounded-lg gap-2",
      lg: "min-h-[48px] px-5 py-2.5 text-base rounded-lg gap-2.5",
    }[size];

    const variantStyles = {
      primary:
        "bg-[#1769E0] text-white hover:bg-[#0F5AB8] active:bg-[#0B4C9C] focus-visible:ring-[#1769E0] shadow-theme-xs",
      secondary:
        "bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 active:bg-gray-100 focus-visible:ring-[#1769E0] shadow-theme-xs",
      outline:
        "bg-transparent text-[#1769E0] border border-[#1769E0]/30 hover:bg-[#1769E0]/5 active:bg-[#1769E0]/10 focus-visible:ring-[#1769E0]",
      danger:
        "bg-[#B42318] text-white hover:bg-[#912018] active:bg-[#7A271A] focus-visible:ring-[#B42318] shadow-theme-xs",
      ghost:
        "bg-transparent text-gray-700 hover:bg-gray-100 hover:text-gray-900 focus-visible:ring-gray-400",
    }[variant];

    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(baseStyles, sizeStyles, variantStyles, className)}
        {...props}
      >
        {loading ? (
          <span className="flex items-center gap-2">
            <svg
              className="animate-spin h-4 w-4 shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8v8H4z"
              />
            </svg>
            <span>{children}</span>
          </span>
        ) : (
          <>
            {startIcon && <span className="shrink-0 flex items-center">{startIcon}</span>}
            {children}
            {endIcon && <span className="shrink-0 flex items-center">{endIcon}</span>}
          </>
        )}
      </button>
    );
  }
);

Button.displayName = "Button";
