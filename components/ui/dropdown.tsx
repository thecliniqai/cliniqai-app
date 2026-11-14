"use client";

import React from "react";
import Link from "next/link";
import { DropdownMenu as MenuPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";
import { MENU_ITEM, MENU_ITEM_DANGER } from "@/lib/ui/variants";
import { DropdownMenu, DropdownMenuContent, DropdownMenuSeparator } from "./dropdown-menu";

/**
 * Dropdown: the v1 API (`Dropdown` with a `trigger` and `DropdownItem` children) over the V2 DropdownMenu (V2-06
 * 06-02b; closes the 03-12b carry-over for the user menu). What v1 lacked and the adapter now gives: the trigger has
 * `aria-haspopup="menu"`, `aria-expanded` and `aria-controls`; Enter / Space / ArrowDown open the menu on its first
 * item; arrows move between items (wrapping), typing jumps to a matching item, Escape closes it and focus returns to the
 * trigger; outside clicks close it.
 *
 * - `trigger`: one element (a `<button>`) used as the trigger itself; any other node is wrapped in a button.
 * - `DropdownItem type="submit"` (the sign-out forms): selecting it submits its form and the menu stays open, because
 *   closing would unmount the form before its submit event and cancel the submission. The submit handler takes over
 *   (`hardSignOut()` conceals the page and navigates).
 * - `DropdownLink`: a navigation item that is itself the link (no button inside a link).
 * - `aria-disabled` on an item disables it (skipped by the arrows, not selectable).
 */
export interface DropdownProps {
  trigger: React.ReactNode;
  align?: "left" | "right";
  className?: string;
  menuClassName?: string;
  children: React.ReactNode;
}

export function Dropdown({ trigger, align = "right", className, menuClassName, children }: DropdownProps) {
  const triggerElement = React.isValidElement(trigger) ? (
    trigger
  ) : (
    <button type="button" className="cursor-pointer">
      {trigger}
    </button>
  );
  return (
    <div className={cn("relative inline-block text-left", className)}>
      <DropdownMenu>
        <MenuPrimitive.Trigger asChild>{triggerElement}</MenuPrimitive.Trigger>
        <DropdownMenuContent align={align === "right" ? "end" : "start"} className={menuClassName}>
          {children}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function isTruthyAria(value: React.AriaAttributes["aria-disabled"]): boolean {
  return value === true || value === "true";
}

export const DropdownItem = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: React.ReactNode; danger?: boolean }
>(function DropdownItem(
  { className, children, icon, danger = false, type = "button", disabled, onClick, "aria-disabled": ariaDisabled, ...props },
  ref,
) {
  const submit = type === "submit";
  return (
    <MenuPrimitive.Item
      asChild
      disabled={Boolean(disabled) || isTruthyAria(ariaDisabled)}
      onSelect={(event) => {
        // Keep the menu (and so the form) mounted: the click's default action submits the form after this handler.
        if (submit) event.preventDefault();
      }}
    >
      <button
        ref={ref}
        type={type}
        onClick={onClick}
        className={cn(MENU_ITEM, danger && MENU_ITEM_DANGER, className)}
        {...props}
      >
        {icon && (
          <span aria-hidden="true" className="flex shrink-0 items-center">
            {icon}
          </span>
        )}
        <span className="min-w-0 flex-1">{children}</span>
      </button>
    </MenuPrimitive.Item>
  );
});

/** A navigation item: the link is the menu item. */
export function DropdownLink({
  href,
  icon,
  className,
  children,
}: {
  href: string;
  icon?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <MenuPrimitive.Item asChild>
      <Link href={href} className={cn(MENU_ITEM, className)}>
        {icon && (
          <span aria-hidden="true" className="flex shrink-0 items-center">
            {icon}
          </span>
        )}
        <span className="min-w-0 flex-1">{children}</span>
      </Link>
    </MenuPrimitive.Item>
  );
}

export const DropdownSeparator = DropdownMenuSeparator;
