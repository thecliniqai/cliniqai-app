import React from "react";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "outline" | "danger";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      children,
      variant = "primary",
      size = "md",
      loading = false,
      disabled,
      className = "",
      ...props
    },
    ref
  ) => {
    const baseStyles =
      "inline-flex items-center justify-center font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none cursor-pointer";

    // 44px min touch target on mobile per DESIGN.md & AGENTS.md §26
    const sizeStyles = {
      sm: "h-9 px-3 text-sm rounded-[var(--radius-sm)]",
      md: "min-h-[44px] px-4 py-2 text-base rounded-[var(--radius-md)]",
      lg: "min-h-[48px] px-6 py-3 text-lg rounded-[var(--radius-md)]",
    }[size];

    const variantStyles = {
      primary:
        "bg-[var(--brand-primary)] text-white hover:bg-[var(--brand-hover)] focus-visible:ring-[var(--border-focus)] shadow-sm",
      secondary:
        "bg-[var(--surface-subtle)] text-[var(--text-primary)] hover:bg-[var(--border-default)] focus-visible:ring-[var(--border-focus)]",
      outline:
        "border border-[var(--border-default)] bg-transparent text-[var(--text-primary)] hover:bg-[var(--surface-subtle)] focus-visible:ring-[var(--border-focus)]",
      danger:
        "bg-[var(--status-error)] text-white hover:opacity-90 focus-visible:ring-[var(--status-error)]",
    }[variant];

    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={`${baseStyles} ${sizeStyles} ${variantStyles} ${className}`}
        {...props}
      >
        {loading ? (
          <span className="flex items-center gap-2">
            <svg
              className="animate-spin h-4 w-4"
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
            Loading...
          </span>
        ) : (
          children
        )}
      </button>
    );
  }
);

Button.displayName = "Button";
