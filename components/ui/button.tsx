"use client";

import React, { useId } from "react";
import { cn } from "@/lib/utils";
import { useOnlineStatus } from "@/lib/pwa/online";
import { joinIds } from "@/lib/ui/ids";
import {
  BUTTON_BASE,
  BUTTON_DISABLED,
  BUTTON_INTERACTIVE,
  BUTTON_LOADING,
  BUTTON_SIZE,
  BUTTON_VARIANT,
  FOCUS_RING,
  SPINNER_ON_FILL,
  TRANSITION,
  resolveButtonVariant,
  type ButtonSize,
  type ButtonVariant,
} from "@/lib/ui/variants";

/**
 * Button (V2-06 06-02a; 06-UI-SPEC "06-02a Forms", DESIGN_SYSTEM §6.1). One primitive for new code and the v1 call
 * sites: the v1 props (`variant` incl. `outline`, `size` `sm | md | lg`, `loading`, `startIcon`, `endIcon`) keep
 * working, so the ~55 v1 importers compile unchanged.
 *
 * - Variants `primary` (CliniQ Blue, one per view region), `soft`, `secondary`, `ghost`, `danger` (AlertDialog confirm
 *   only), `danger-quiet`, `link`. Sizes 28 / 36 / 44 px on a fine pointer; every size is 44 px on touch.
 * - `loading`: the label is hidden visually (width and accessible name kept), a spinner is drawn, `aria-busy="true"`,
 *   and the button does not act.
 * - `requiresNetwork` (PWA §3.6, R-32): defaults to true for `type="submit"`. Offline, the button is `aria-disabled`
 *   (still focusable, so keyboard and screen-reader users reach it), described by the reason "You're offline. Changes
 *   are disabled until you reconnect.", and a click or an implicit form submission does nothing.
 * - `kbd`: an optional trailing shortcut hint (shown ≥ 1024 px on fine pointers only, CD-33).
 */
export const OFFLINE_REASON = "You're offline. Changes are disabled until you reconnect.";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant | "outline";
  size?: ButtonSize;
  loading?: boolean;
  startIcon?: React.ReactNode;
  endIcon?: React.ReactNode;
  /** A `Kbd` hint after the label (≥ lg screens, fine pointer). */
  kbd?: React.ReactNode;
  /** Disable while offline. Default: true for `type="submit"`, false otherwise. */
  requiresNetwork?: boolean;
}

/** The class list of a button look, for a link that must look like a button (avoid a link wrapping a button). */
export function buttonClassName({
  variant,
  size = "md",
  className,
}: {
  variant?: ButtonVariant | "outline";
  size?: ButtonSize;
  className?: string;
} = {}): string {
  const v = resolveButtonVariant(variant);
  return cn(BUTTON_BASE, TRANSITION, FOCUS_RING, BUTTON_SIZE[size], BUTTON_VARIANT[v], BUTTON_INTERACTIVE[v], className);
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    children,
    variant,
    size = "md",
    loading = false,
    disabled,
    startIcon,
    endIcon,
    kbd,
    requiresNetwork,
    type,
    className,
    onClick,
    "aria-describedby": describedBy,
    ...props
  },
  ref,
) {
  const v = resolveButtonVariant(variant);
  const online = useOnlineStatus();
  const reasonId = useId();
  const offline = (requiresNetwork ?? type === "submit") && !online;
  const nativeDisabled = Boolean(disabled) || loading;
  const inert = nativeDisabled || offline;

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (offline) {
      // An aria-disabled button stays focusable; cancelling the click also cancels an implicit form submission.
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    onClick?.(event);
  };

  return (
    <>
      <button
        ref={ref}
        type={type}
        disabled={nativeDisabled}
        aria-disabled={offline && !nativeDisabled ? true : undefined}
        aria-busy={loading || undefined}
        aria-describedby={joinIds(describedBy, offline ? reasonId : undefined)}
        data-offline={offline || undefined}
        onClick={handleClick}
        className={cn(
          BUTTON_BASE,
          TRANSITION,
          FOCUS_RING,
          BUTTON_SIZE[size],
          BUTTON_VARIANT[v],
          inert ? (loading ? "cursor-wait" : BUTTON_DISABLED[v]) : BUTTON_INTERACTIVE[v],
          loading && BUTTON_LOADING,
          className,
        )}
        {...props}
      >
        {startIcon && <span className="flex shrink-0 items-center [&_svg]:size-4">{startIcon}</span>}
        {children}
        {kbd}
        {endIcon && <span className="flex shrink-0 items-center [&_svg]:size-4">{endIcon}</span>}
        {loading && (
          <span
            aria-hidden="true"
            data-spinner=""
            className={cn(
              "absolute inset-0 m-auto size-3.5 rounded-pill border-2 motion-safe:animate-spin",
              SPINNER_ON_FILL[v],
            )}
          />
        )}
      </button>
      {offline && (
        <span id={reasonId} className="sr-only">
          {OFFLINE_REASON}
        </span>
      )}
    </>
  );
});

Button.displayName = "Button";
