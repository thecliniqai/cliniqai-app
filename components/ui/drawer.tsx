"use client";

import React from "react";
import { SheetContent, type SheetContentProps } from "./sheet";

/**
 * Drawer (V2-06 06-02b; 06-UI-SPEC Drawer, CD-09): the bottom sheet for phones. Full width, at most 92 dvh, radius-xl
 * top corners, a decorative 32×4 handle (`aria-hidden`), the same head / body / foot as a Sheet with the foot buttons
 * sharing the width. No drag-to-dismiss and no snap points in V2-06: it closes by its Close button, Escape or the
 * scrim. Use `ResponsiveSheet` for a flow that is a drawer on phones and a side sheet on larger screens.
 */
export {
  Sheet as Drawer,
  SheetTrigger as DrawerTrigger,
  SheetClose as DrawerClose,
  SheetHeader as DrawerHeader,
  SheetBody as DrawerBody,
  SheetFooter as DrawerFooter,
} from "./sheet";

export const DrawerContent = React.forwardRef<HTMLDivElement, Omit<SheetContentProps, "placement" | "size">>(
  function DrawerContent(props, ref) {
    return <SheetContent ref={ref} placement="bottom" {...props} />;
  },
);
