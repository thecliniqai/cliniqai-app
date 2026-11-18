"use client";

import React from "react";
import Link from "next/link";
import { Tabs as TabsPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";
import { TAB_ITEM, TAB_LIST, TRANSITION } from "@/lib/ui/variants";

/**
 * Tabs (V2-06 06-02b; 06-UI-SPEC Tabs; Radix): a bottom hairline; tabs 36 px (44 on touch), padding 0 10, body-sm 500
 * fg-secondary; the selected tab is fg with a 2 px accent underline inset 8 px. The list scrolls sideways on phones,
 * so the focus ring is the inset variant (CD-12: a ring outside would be clipped by the scroll box).
 *
 * - Local tabs (`Tabs` + `TabsList` + `TabsTrigger` + `TabsContent`): `role="tablist"`, roving focus with arrow keys
 *   (wrapping), Home / End, selection follows focus (automatic activation), panels are `tabpanel`s named by their tab.
 * - Route tabs (`TabLinks`): real links inside a named `nav`; the current one has `aria-current="page"`.
 */
export const Tabs = TabsPrimitive.Root;

export const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(function TabsList({ className, loop = true, ...props }, ref) {
  return <TabsPrimitive.List ref={ref} loop={loop} className={cn(TAB_LIST, className)} {...props} />;
});

export const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(function TabsTrigger({ className, ...props }, ref) {
  return <TabsPrimitive.Trigger ref={ref} className={cn(TAB_ITEM, TRANSITION, className)} {...props} />;
});

export const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(function TabsContent({ className, ...props }, ref) {
  return <TabsPrimitive.Content ref={ref} className={cn("pt-4 focus-visible:focus-ring", className)} {...props} />;
});

export interface TabLink {
  href: string;
  label: React.ReactNode;
  current?: boolean;
}

/** Route tabs: links in a `nav` named by `label`; the current page's link has `aria-current="page"`. */
export function TabLinks({ label, items, className }: { label: string; items: TabLink[]; className?: string }) {
  return (
    <nav aria-label={label} className={cn(TAB_LIST, className)}>
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={item.current ? "page" : undefined}
          className={cn(TAB_ITEM, TRANSITION)}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
