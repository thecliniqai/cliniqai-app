"use client";

import React from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { OVERLAY_SURFACE } from "@/lib/ui/variants";
import { useFocusReturn } from "@/lib/ui/focus-return";
import { Dialog, DialogClose, DialogOverlay, DialogTrigger, useDismissGuard } from "./dialog";
import { IconButton } from "./icon-button";

/**
 * Sheet (V2-06 06-02b; 06-UI-SPEC Sheet / Drawer / ResponsiveSheet, DESIGN_SYSTEM §6.4, PWA §3.2.3; Radix Dialog):
 * the data-entry overlay (Book, Walk-in, Collect, Vitals). A modal dialog with another placement:
 *
 * - `right` (Sheet, ≥ 768): full height, `sheet` 448 / `sheet-lg` 608 px (CD-08), no radius, left hairline.
 * - `bottom` (Drawer, < 768): full width, at most 92 dvh, radius-xl top corners, a decorative 32×4 handle; no
 *   drag-to-dismiss and no snap points (CD-09); foot buttons share the width.
 * - `responsive` (ResponsiveSheet): the bottom drawer below 768 px and the right sheet from 768 px, one content tree,
 *   switched by CSS so nothing re-mounts on a resize.
 *
 * Same head / body / foot in every placement: head = title (Manrope `title-2`) + optional context line + Close button;
 * the body scrolls on its own (`overscroll-behavior: contain`); the foot sticks to the bottom above the safe area
 * (`pb-safe`), top hairline, buttons right-aligned. Every sheet is closable on screen (Close button), by Escape and by
 * the scrim; with `dirty`, a dismissal asks "Discard changes?" first. Focus is trapped and returns to the opener.
 */
export const Sheet = Dialog;
export const SheetTrigger = DialogTrigger;
export const SheetClose = DialogClose;

export type SheetPlacement = "right" | "bottom" | "responsive";
export type SheetSize = "md" | "lg";

const PLACEMENT: Record<SheetPlacement, string> = {
  right:
    "top-0 right-0 h-[calc(100dvh-var(--offline-banner-h,0px))] max-w-full border-l border-border motion-safe:transition-[translate] motion-safe:duration-(--duration-sheet) motion-safe:ease-(--ease-out) motion-safe:starting:translate-x-full",
  bottom:
    "inset-x-0 bottom-[var(--offline-banner-h,0px)] max-h-[calc(92dvh-var(--offline-banner-h,0px))] rounded-t-xl border-t border-border motion-safe:transition-[translate] motion-safe:duration-(--duration-sheet) motion-safe:ease-(--ease-out) motion-safe:starting:translate-y-full",
  responsive:
    "inset-x-0 bottom-[var(--offline-banner-h,0px)] max-h-[calc(92dvh-var(--offline-banner-h,0px))] rounded-t-xl border-t border-border motion-safe:transition-[translate] motion-safe:duration-(--duration-sheet) motion-safe:ease-(--ease-out) motion-safe:starting:translate-y-full md:inset-x-auto md:top-0 md:bottom-auto md:right-0 md:h-[calc(100dvh-var(--offline-banner-h,0px))] md:max-h-none md:max-w-full md:rounded-none md:border-t-0 md:border-l md:motion-safe:starting:translate-x-full md:motion-safe:starting:translate-y-0",
};

const WIDTH: Record<SheetPlacement, Record<SheetSize, string>> = {
  right: { md: "w-sheet", lg: "w-sheet-lg" },
  bottom: { md: "", lg: "" },
  responsive: { md: "md:w-sheet", lg: "md:w-sheet-lg" },
};

/** The first focusable control of the body (where a sheet's initial focus goes). */
const FIRST_FIELD =
  "[data-sheet-body] :is(input:not([type=hidden]), textarea, select, button, a[href], [tabindex]:not([tabindex='-1'])):not(:disabled)";

const SheetPlacementContext = React.createContext<SheetPlacement>("right");

export interface SheetContentProps extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  placement?: SheetPlacement;
  size?: SheetSize;
  /** Unsaved input: a dismissal asks "Discard changes?" first. */
  dirty?: boolean;
  /** Accessible name of the head's Close button. */
  closeLabel?: string;
}

export const SheetContent = React.forwardRef<React.ElementRef<typeof DialogPrimitive.Content>, SheetContentProps>(
  function SheetContent(
    {
      placement = "right",
      size = "md",
      dirty,
      closeLabel = "Close",
      className,
      children,
      onInteractOutside,
      onEscapeKeyDown,
      onOpenAutoFocus,
      onCloseAutoFocus,
      ...props
    },
    ref,
  ) {
    const { hold, requestClose, guard } = useDismissGuard(dirty);
    const focusReturn = useFocusReturn();
    return (
      <DialogPrimitive.Portal>
        <DialogOverlay />
        <DialogPrimitive.Content
          ref={ref}
          data-overlay="sheet"
          data-placement={placement}
          onInteractOutside={(event) => {
            onInteractOutside?.(event);
            if (!event.defaultPrevented) hold(event);
          }}
          onEscapeKeyDown={(event) => {
            onEscapeKeyDown?.(event);
            if (!event.defaultPrevented) hold(event);
          }}
          onCloseAutoFocus={(event) => {
            onCloseAutoFocus?.(event);
            if (!event.defaultPrevented) focusReturn.onCloseAutoFocus(event);
          }}
          onOpenAutoFocus={(event) => {
            focusReturn.onOpenAutoFocus();
            onOpenAutoFocus?.(event);
            if (event.defaultPrevented) return;
            // The head's Close button comes first in the DOM; start on the first field of the body instead.
            const content = event.currentTarget as HTMLElement | null;
            const first = content?.querySelector<HTMLElement>(FIRST_FIELD);
            if (first) {
              event.preventDefault();
              first.focus();
            }
          }}
          className={cn(OVERLAY_SURFACE, "fixed", PLACEMENT[placement], WIDTH[placement][size], className)}
          {...props}
        >
          <SheetPlacementContext.Provider value={placement}>
            {placement !== "right" && (
              <span
                aria-hidden="true"
                data-drawer-handle=""
                className={cn(
                  "mx-auto mt-2 block h-1 w-8 shrink-0 rounded-pill bg-border-strong",
                  placement === "responsive" && "md:hidden",
                )}
              />
            )}
            <SheetCloseContext.Provider value={{ requestClose, closeLabel }}>{children}</SheetCloseContext.Provider>
          </SheetPlacementContext.Provider>
          {guard}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    );
  },
);

const SheetCloseContext = React.createContext<{ requestClose: () => void; closeLabel: string } | null>(null);

/** Head: title + optional context line on the left, the Close button on the right (padding 14 12 12 20). */
export function SheetHeader({
  title,
  description,
  className,
  children,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}) {
  const close = React.useContext(SheetCloseContext);
  return (
    <div className={cn("flex shrink-0 items-start gap-3 border-b border-border pt-3.5 pr-3 pb-3 pl-5", className)}>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 pt-1">
        <DialogPrimitive.Title className="font-display text-title-2 text-fg">{title}</DialogPrimitive.Title>
        {description && (
          <DialogPrimitive.Description className="text-body-sm text-fg-muted">{description}</DialogPrimitive.Description>
        )}
        {children}
      </div>
      {close && (
        <IconButton
          label={close.closeLabel}
          icon={<X />}
          tooltip={false}
          onClick={close.requestClose}
          data-overlay-close=""
        />
      )}
    </div>
  );
}

/** The scrolling body: padding 16 20, gap 16, scroll chaining contained. */
export function SheetBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-sheet-body=""
      className={cn("flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-5 py-4", className)}
      {...props}
    />
  );
}

/**
 * The sticky foot: padding 12 20, plus the safe-area inset at the bottom (`pb-safe` intent; the approved
 * `calc(12px + env(safe-area-inset-bottom))`), top hairline, buttons right-aligned (gap 8). On the bottom drawer
 * the buttons share the width (`flex: 1`, CD-09 drawer foot).
 */
export function SheetFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const placement = React.useContext(SheetPlacementContext);
  return (
    <div
      data-sheet-footer=""
      className={cn(
        "sticky bottom-0 flex shrink-0 items-center justify-end gap-2 border-t border-border bg-surface px-5 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]",
        placement === "bottom" && "[&>*]:flex-1",
        placement === "responsive" && "max-md:[&>*]:flex-1",
        className,
      )}
      {...props}
    />
  );
}
