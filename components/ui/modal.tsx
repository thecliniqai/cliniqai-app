"use client";

import React, { useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, type DialogSize } from "./dialog";

/**
 * Modal: the v1 API (`isOpen`, `onClose`, `title`, `description`, `maxWidth`) over the V2 Dialog (V2-06 06-02b,
 * 06-PLAN "Modal and Dropdown adapters"). The ten v1 call sites compile and read unchanged, and now get what the v1
 * modal lacked: focus moves in and is trapped (Tab / Shift+Tab cycle), Escape and the Close button close, focus returns
 * to the opener, scroll lock is reference-counted, the page behind is hidden from assistive technology, and the dialog
 * is named by its title.
 *
 * - `maxWidth` maps onto the approved widths (CD-08): `sm` / `md` → 440, `lg` / `xl` → 640.
 * - A modal without `title` is named by the first heading inside it (v1 call sites put their own heading in the body),
 *   and shows no header, as before; such call sites close through their own buttons, Escape or the scrim.
 * - `onClose` is called for every dismissal; a call site that must stay open (a request in flight) passes a no-op, as
 *   v1 allowed.
 */
export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  maxWidth?: "sm" | "md" | "lg" | "xl";
  children: React.ReactNode;
}

const SIZE: Record<NonNullable<ModalProps["maxWidth"]>, DialogSize> = { sm: "md", md: "md", lg: "lg", xl: "lg" };

/** Names a title-less dialog by its first heading (gives the heading an id when it has none). */
function useHeadingLabel(enabled: boolean) {
  return useCallback(
    (node: HTMLDivElement | null) => {
      if (!enabled || !node) return;
      const heading = node.querySelector<HTMLElement>("h1, h2, h3, h4, h5, h6");
      if (!heading) return;
      if (!heading.id) heading.id = `${node.id || "modal"}-heading`;
      node.setAttribute("aria-labelledby", heading.id);
    },
    [enabled],
  );
}

export function Modal({ isOpen, onClose, title, description, maxWidth = "md", children }: ModalProps) {
  const headingLabel = useHeadingLabel(!title);
  const hasHeader = Boolean(title || description);
  return (
    <Dialog open={isOpen} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent
        ref={headingLabel}
        size={SIZE[maxWidth]}
        showClose={hasHeader}
        closeLabel="Close dialog"
        data-modal-adapter=""
      >
        {hasHeader && (
          <DialogHeader>
            {title && <DialogTitle>{title}</DialogTitle>}
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
        )}
        <div className="min-w-0">{children}</div>
      </DialogContent>
    </Dialog>
  );
}
