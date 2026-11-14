"use client";

import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { OVERLAY_SURFACE, SCRIM } from "@/lib/ui/variants";
import { useFocusReturn } from "@/lib/ui/focus-return";
import { IconButton } from "./icon-button";
import { DiscardChangesDialog } from "./alert-dialog";

/**
 * Dialog (V2-06 06-02b; 06-UI-SPEC "06-02b Overlays", DESIGN_SYSTEM §6.4; Radix): a short focused task or a
 * confirmation with content. Centred, `min(440px, 100vw − 32px)` (`lg` 640, CD-08), radius-xl, `shadow-overlay` on the
 * `scrim` (no blur), padding 20, gap 12, title in Manrope (`title-2`) naming the dialog (`aria-labelledby`, unique id).
 *
 * Behaviour (Radix): focus moves into the dialog and is trapped there (Tab and Shift+Tab cycle), Escape and the
 * on-screen Close button close it, focus returns to the opener, page scroll is locked (reference-counted), and the
 * rest of the page is hidden from assistive technology while it is open.
 *
 * Dirty forms (06-UI-SPEC §8 Overlays): with `dirty` set on the content, any dismissal (outside click, Escape, the Close
 * button) first asks "Discard changes?" in an AlertDialog whose initial focus is "Keep editing". At most two layers.
 *
 * The same root serves Sheet, Drawer and ResponsiveSheet (`sheet.tsx`), which are dialogs with another placement.
 */

interface DialogControl {
  /** Closes the dialog (after a confirmed discard, or from a component inside it). */
  close: () => void;
}

const DialogControlContext = createContext<DialogControl | null>(null);

/** Root. Controlled (`open` + `onOpenChange`) or uncontrolled (`defaultOpen`). */
export function Dialog({
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  children,
}: {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}) {
  const [uncontrolled, setUncontrolled] = useState(defaultOpen);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : uncontrolled;
  const setOpen = useCallback(
    (next: boolean) => {
      if (!controlled) setUncontrolled(next);
      onOpenChange?.(next);
    },
    [controlled, onOpenChange],
  );
  const control = useMemo<DialogControl>(() => ({ close: () => setOpen(false) }), [setOpen]);
  return (
    <DialogControlContext.Provider value={control}>
      <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
        {children}
      </DialogPrimitive.Root>
    </DialogControlContext.Provider>
  );
}

/** Closes the surrounding Dialog / Sheet from inside it. */
export function useDialogControl(): DialogControl {
  const control = useContext(DialogControlContext);
  if (!control) throw new Error("useDialogControl must be used inside <Dialog>");
  return control;
}

export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

/** The modal backdrop (`scrim`, 200 ms fade, no blur). */
export const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(function DialogOverlay({ className, ...props }, ref) {
  return <DialogPrimitive.Overlay ref={ref} data-scrim="" className={cn(SCRIM, className)} {...props} />;
});

/**
 * Wires the dirty-form guard into a Radix content element: outside clicks and Escape are held while `dirty`, and a
 * "Discard changes?" AlertDialog decides. Used by DialogContent and SheetContent.
 */
export function useDismissGuard(dirty: boolean | undefined) {
  const { close } = useDialogControl();
  const [asking, setAsking] = useState(false);
  const discarding = useRef(false);

  const hold = useCallback(
    (event: Event) => {
      if (!dirty) return;
      event.preventDefault();
      setAsking(true);
    },
    [dirty],
  );

  /** For an on-screen Close control: closes, or asks first while dirty. */
  const requestClose = useCallback(() => {
    if (dirty) setAsking(true);
    else close();
  }, [dirty, close]);

  const guard = (
    <DiscardChangesDialog
      open={asking}
      onKeepEditing={() => setAsking(false)}
      onDiscard={() => {
        discarding.current = true;
        setAsking(false);
      }}
      onClosed={(event) => {
        // The AlertDialog has unmounted: close the dialog under it now, so its own focus restore (to the opener) is
        // the last one to run.
        if (discarding.current) {
          discarding.current = false;
          event.preventDefault();
          close();
        }
      }}
    />
  );

  return { hold, requestClose, guard };
}

export type DialogSize = "md" | "lg";

const DIALOG_WIDTH: Record<DialogSize, string> = {
  md: "w-[min(27.5rem,calc(100vw-2rem))]",
  lg: "w-[min(40rem,calc(100vw-2rem))]",
};

export interface DialogContentProps extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  size?: DialogSize;
  /** Unsaved input: a dismissal asks "Discard changes?" first. */
  dirty?: boolean;
  /** Renders the on-screen Close button (top right). Default true (PWA §3.2.3: every overlay closable on screen). */
  showClose?: boolean;
  /** Accessible name of the Close button. */
  closeLabel?: string;
}

/** The dialog panel, portalled with its scrim. Compose DialogHeader / DialogBody / DialogFooter inside. */
export const DialogContent = React.forwardRef<React.ElementRef<typeof DialogPrimitive.Content>, DialogContentProps>(
  function DialogContent(
    {
      size = "md",
      dirty,
      showClose = true,
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
          data-overlay="dialog"
          onOpenAutoFocus={(event) => {
            focusReturn.onOpenAutoFocus();
            onOpenAutoFocus?.(event);
          }}
          onCloseAutoFocus={(event) => {
            onCloseAutoFocus?.(event);
            if (!event.defaultPrevented) focusReturn.onCloseAutoFocus(event);
          }}
          onInteractOutside={(event) => {
            onInteractOutside?.(event);
            if (!event.defaultPrevented) hold(event);
          }}
          onEscapeKeyDown={(event) => {
            onEscapeKeyDown?.(event);
            if (!event.defaultPrevented) hold(event);
          }}
          className={cn(
            OVERLAY_SURFACE,
            "fixed inset-0 m-auto h-fit max-h-[calc(100dvh-2rem)] gap-3 overflow-y-auto overscroll-contain rounded-xl p-5",
            "motion-safe:transition-[opacity,translate] motion-safe:duration-(--duration-base) motion-safe:ease-out motion-safe:starting:translate-y-1 motion-safe:starting:opacity-0",
            DIALOG_WIDTH[size],
            className,
          )}
          {...props}
        >
          {children}
          {showClose && (
            // Last in the DOM so the first field (or the first action) takes the initial focus; drawn top right.
            <IconButton
              label={closeLabel}
              icon={<X />}
              tooltip={false}
              onClick={requestClose}
              className="absolute top-3 right-3"
              data-overlay-close=""
            />
          )}
          {guard}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    );
  },
);

/** Title block: the title (Manrope `title-2`) and an optional context line; leaves room for the Close button. */
export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1 pr-10", className)} {...props} />;
}

export const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(function DialogTitle({ className, ...props }, ref) {
  return <DialogPrimitive.Title ref={ref} className={cn("font-display text-title-2 text-fg", className)} {...props} />;
});

export const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(function DialogDescription({ className, ...props }, ref) {
  return <DialogPrimitive.Description ref={ref} className={cn("text-body-sm text-fg-muted", className)} {...props} />;
});

export function DialogBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-3 text-body text-fg", className)} {...props} />;
}

/** Actions, right-aligned, gap 8; they wrap on a narrow phone rather than overflow. */
export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-wrap items-center justify-end gap-2 pt-1", className)} {...props} />;
}
