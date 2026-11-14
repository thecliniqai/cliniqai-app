"use client";

import React from "react";
import { SheetContent, type SheetContentProps } from "./sheet";

/**
 * ResponsiveSheet (V2-06 06-02b; 06-UI-SPEC ResponsiveSheet, DESIGN_SYSTEM §6.4): one content component, shown as the
 * bottom Drawer below 768 px and as the right-side Sheet from 768 px (`sheet` 448 / `sheet-lg` 608). The switch is
 * CSS (`md:`), so a rotation or a resize keeps the open sheet, its focus and its input.
 */
export {
  Sheet as ResponsiveSheet,
  SheetTrigger as ResponsiveSheetTrigger,
  SheetClose as ResponsiveSheetClose,
  SheetHeader as ResponsiveSheetHeader,
  SheetBody as ResponsiveSheetBody,
  SheetFooter as ResponsiveSheetFooter,
} from "./sheet";

export const ResponsiveSheetContent = React.forwardRef<HTMLDivElement, Omit<SheetContentProps, "placement">>(
  function ResponsiveSheetContent(props, ref) {
    return <SheetContent ref={ref} placement="responsive" {...props} />;
  },
);
