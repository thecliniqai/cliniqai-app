"use client";

import React from "react";
import { AlertDialog as AlertDialogPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";
import { OVERLAY_SURFACE, SCRIM } from "@/lib/ui/variants";
import { useFocusReturn } from "@/lib/ui/focus-return";
import { Button, type ButtonProps } from "./button";

/**
 * AlertDialog (V2-06 06-02b; 06-UI-SPEC AlertDialog, DESIGN_SYSTEM §6.4, CD-34; Radix): a destructive or irreversible
 * confirmation ("Cancel this visit?", "Discard changes?"). Dialog skin; not dismissible by an outside click; Escape
 * cancels; the **safe** action (`AlertDialogCancel`) takes the initial focus; the destructive confirm is a `danger`
 * button (`AlertDialogAction`, the only place the `danger` variant is used). Role `alertdialog`, named by its title and
 * described by its description. Focus is trapped and returns to the element that had it before (the opener, or the
 * field of a form the question interrupted).
 */
export const AlertDialog = AlertDialogPrimitive.Root;
export const AlertDialogTrigger = AlertDialogPrimitive.Trigger;

export const AlertDialogContent = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Content>
>(function AlertDialogContent({ className, onOpenAutoFocus, onCloseAutoFocus, ...props }, ref) {
  const focusReturn = useFocusReturn();
  return (
    <AlertDialogPrimitive.Portal>
      <AlertDialogPrimitive.Overlay data-scrim="" className={SCRIM} />
      <AlertDialogPrimitive.Content
        ref={ref}
        data-overlay="alert-dialog"
        onOpenAutoFocus={(event) => {
          focusReturn.onOpenAutoFocus();
          onOpenAutoFocus?.(event);
        }}
        onCloseAutoFocus={(event) => {
          onCloseAutoFocus?.(event);
          if (!event.defaultPrevented) focusReturn.onCloseAutoFocus(event);
        }}
        className={cn(
          OVERLAY_SURFACE,
          "fixed inset-0 m-auto h-fit max-h-[calc(100dvh-2rem)] w-[min(27.5rem,calc(100vw-2rem))] gap-3 overflow-y-auto overscroll-contain rounded-xl p-5",
          "motion-safe:transition-[opacity,translate] motion-safe:duration-(--duration-base) motion-safe:ease-out motion-safe:starting:translate-y-1 motion-safe:starting:opacity-0",
          className,
        )}
        {...props}
      />
    </AlertDialogPrimitive.Portal>
  );
});

export const AlertDialogTitle = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Title>
>(function AlertDialogTitle({ className, ...props }, ref) {
  return (
    <AlertDialogPrimitive.Title ref={ref} className={cn("font-display text-title-2 text-fg", className)} {...props} />
  );
});

export const AlertDialogDescription = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Description>
>(function AlertDialogDescription({ className, ...props }, ref) {
  return (
    <AlertDialogPrimitive.Description ref={ref} className={cn("text-body-sm text-fg-secondary", className)} {...props} />
  );
});

export function AlertDialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-wrap items-center justify-end gap-2 pt-1", className)} {...props} />;
}

type ActionProps = Omit<ButtonProps, "variant"> & { variant?: ButtonProps["variant"] };

/** The safe action ("Keep", "Keep editing"): secondary, initial focus. */
export const AlertDialogCancel = React.forwardRef<HTMLButtonElement, ActionProps>(function AlertDialogCancel(
  { variant = "secondary", ...props },
  ref,
) {
  return (
    <AlertDialogPrimitive.Cancel asChild>
      <Button ref={ref} variant={variant} requiresNetwork={false} {...props} />
    </AlertDialogPrimitive.Cancel>
  );
});

/** The destructive confirm ("Cancel visit", "Discard"): `danger`. */
export const AlertDialogAction = React.forwardRef<HTMLButtonElement, ActionProps>(function AlertDialogAction(
  { variant = "danger", ...props },
  ref,
) {
  return (
    <AlertDialogPrimitive.Action asChild>
      <Button ref={ref} variant={variant} {...props} />
    </AlertDialogPrimitive.Action>
  );
});

/**
 * "Discard changes?" (06-UI-SPEC Copywriting: destructive, discard form): the dirty-form guard of Dialog and Sheet.
 * `onClosed` is the AlertDialog's close-autofocus event: on Discard the guard cancels the focus return and closes
 * the form under it from there, after this layer has gone, so focus lands back on the form's opener; on Keep editing
 * focus returns to the field the user was in.
 */
export function DiscardChangesDialog({
  open,
  onKeepEditing,
  onDiscard,
  onClosed,
}: {
  open: boolean;
  onKeepEditing: () => void;
  onDiscard: () => void;
  onClosed?: (event: Event) => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={(next) => (next ? undefined : onKeepEditing())}>
      <AlertDialogContent onCloseAutoFocus={onClosed}>
        <AlertDialogTitle>Discard changes?</AlertDialogTitle>
        <AlertDialogDescription>Your changes in this form will be lost.</AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep editing</AlertDialogCancel>
          <AlertDialogAction onClick={onDiscard}>Discard</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
