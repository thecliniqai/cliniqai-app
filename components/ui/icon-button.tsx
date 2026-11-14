"use client";

import React from "react";
import { cn } from "@/lib/utils";
import {
  BUTTON_BASE,
  FOCUS_RING,
  ICON_BUTTON_INTERACTIVE,
  ICON_BUTTON_SIZE,
  ICON_BUTTON_VARIANT,
  TRANSITION,
  type IconButtonSize,
  type IconButtonVariant,
} from "@/lib/ui/variants";

/**
 * IconButton (V2-06 06-02a; 06-UI-SPEC IconButton): 36×36 ghost (radius-md), `sm` 28×28 (radius-sm), `bordered`;
 * 44×44 on touch. The accessible name is required by the type (`label` → `aria-label`); the desktop Tooltip with the
 * label and shortcut arrives with 06-02b. `loading` draws a spinner in place of the icon (`aria-busy`).
 */
export interface IconButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "children"> {
  /** The accessible name ("Remove Paracetamol 650 mg", "Account menu"). */
  label: string;
  icon: React.ReactNode;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  loading?: boolean;
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, variant = "ghost", size = "md", loading = false, disabled, type = "button", className, ...props },
  ref,
) {
  const inert = Boolean(disabled) || loading;
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      aria-busy={loading || undefined}
      disabled={inert}
      className={cn(
        BUTTON_BASE,
        TRANSITION,
        FOCUS_RING,
        "gap-0 px-0",
        ICON_BUTTON_SIZE[size],
        ICON_BUTTON_VARIANT[variant],
        inert ? (loading ? "cursor-wait" : "cursor-not-allowed text-(--button-disabled-fg)") : ICON_BUTTON_INTERACTIVE[variant],
        size === "sm" ? "[&_svg]:size-3.5" : "[&_svg]:size-4",
        className,
      )}
      {...props}
    >
      {loading ? (
        <span
          aria-hidden="true"
          data-spinner=""
          className="size-3.5 rounded-pill border-2 border-border-strong border-t-accent motion-safe:animate-spin"
        />
      ) : (
        <span aria-hidden="true" className="flex items-center">
          {icon}
        </span>
      )}
    </button>
  );
});

IconButton.displayName = "IconButton";
