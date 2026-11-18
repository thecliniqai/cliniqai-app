"use client";

import React from "react";
import { DropdownMenu as MenuPrimitive } from "radix-ui";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { MENU_ITEM, MENU_ITEM_DANGER, POP_IN, POPOVER_SURFACE } from "@/lib/ui/variants";

/**
 * DropdownMenu (V2-06 06-02b; 06-UI-SPEC DropdownMenu, DESIGN_SYSTEM §6.3; Radix): action menus (a row's ⋯, the user
 * menu). Min width 196, padding 4, radius-lg, hairline, `shadow-popover`; items 32 px (44 on touch), padding 0 10,
 * radius-sm, body-sm, icon 16, gap 8; highlighted = surface-muted; destructive items last, after a separator, in
 * danger-fg.
 *
 * Keyboard (Radix): Enter, Space or ArrowDown on the trigger opens the menu on its first item (ArrowUp: last); arrows
 * move between items and wrap (`loop`), Home / End jump, typing a letter jumps to the next matching item, disabled
 * items are skipped, Enter / Space select, Escape closes and returns focus to the trigger, whose `aria-expanded` follows.
 */
/**
 * Root. Non-modal by default (`modal={false}`): the WAI-ARIA menu-button pattern, where the page behind stays in the
 * accessibility tree and scrolls. Radix's modal mode hides everything else with `aria-hidden` while focusable controls
 * stay focusable, which axe reports as `aria-hidden-focus` (serious) on every page with an open menu (06-02b
 * overlays-axe), and it locks page scroll. Focus handling is the same in both modes: arrows, typeahead, Escape back to
 * the trigger, Tab stays in the menu; an outside click or focus moving elsewhere closes it.
 */
export function DropdownMenu({ modal = false, ...props }: React.ComponentProps<typeof MenuPrimitive.Root>) {
  return <MenuPrimitive.Root modal={modal} {...props} />;
}
export const DropdownMenuTrigger = MenuPrimitive.Trigger;
export const DropdownMenuGroup = MenuPrimitive.Group;
export const DropdownMenuRadioGroup = MenuPrimitive.RadioGroup;

export const MENU_PANEL = "min-w-49 max-w-[calc(100vw-2rem)] overflow-y-auto overscroll-contain p-1";

export const DropdownMenuContent = React.forwardRef<
  React.ElementRef<typeof MenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof MenuPrimitive.Content>
>(function DropdownMenuContent({ className, align = "end", sideOffset = 6, loop = true, ...props }, ref) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Content
        ref={ref}
        align={align}
        sideOffset={sideOffset}
        loop={loop}
        collisionPadding={16}
        data-overlay="menu"
        className={cn(
          POPOVER_SURFACE,
          MENU_PANEL,
          "max-h-[min(20rem,var(--radix-dropdown-menu-content-available-height))]",
          POP_IN,
          className,
        )}
        {...props}
      />
    </MenuPrimitive.Portal>
  );
});

export interface DropdownMenuItemProps extends React.ComponentPropsWithoutRef<typeof MenuPrimitive.Item> {
  icon?: React.ReactNode;
  /** Destructive action: danger-fg; place it last, after a `DropdownMenuSeparator`. */
  destructive?: boolean;
}

export const DropdownMenuItem = React.forwardRef<React.ElementRef<typeof MenuPrimitive.Item>, DropdownMenuItemProps>(
  function DropdownMenuItem({ className, icon, destructive, children, asChild, ...props }, ref) {
    return (
      <MenuPrimitive.Item
        ref={ref}
        asChild={asChild}
        className={cn(MENU_ITEM, destructive && MENU_ITEM_DANGER, className)}
        {...props}
      >
        {asChild ? (
          children
        ) : (
          <>
            {icon && (
              <span aria-hidden="true" className="flex shrink-0 items-center">
                {icon}
              </span>
            )}
            <span className="min-w-0 flex-1 truncate">{children}</span>
          </>
        )}
      </MenuPrimitive.Item>
    );
  },
);

export const DropdownMenuCheckboxItem = React.forwardRef<
  React.ElementRef<typeof MenuPrimitive.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof MenuPrimitive.CheckboxItem>
>(function DropdownMenuCheckboxItem({ className, children, ...props }, ref) {
  return (
    <MenuPrimitive.CheckboxItem ref={ref} className={cn(MENU_ITEM, "pr-8", className)} {...props}>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      <MenuPrimitive.ItemIndicator className="absolute right-2.5 flex items-center">
        <Check aria-hidden="true" />
      </MenuPrimitive.ItemIndicator>
    </MenuPrimitive.CheckboxItem>
  );
});

/** A group heading inside a menu: 11 px caps eyebrow, fg-muted (not focusable). */
export const DropdownMenuLabel = React.forwardRef<
  React.ElementRef<typeof MenuPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof MenuPrimitive.Label>
>(function DropdownMenuLabel({ className, ...props }, ref) {
  return (
    <MenuPrimitive.Label
      ref={ref}
      className={cn("px-2.5 pt-1.5 pb-1 text-caption font-semibold tracking-caps text-fg-muted uppercase", className)}
      {...props}
    />
  );
});

export const DropdownMenuSeparator = React.forwardRef<
  React.ElementRef<typeof MenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof MenuPrimitive.Separator>
>(function DropdownMenuSeparator({ className, ...props }, ref) {
  return <MenuPrimitive.Separator ref={ref} className={cn("my-1 h-px bg-border", className)} {...props} />;
});
