"use client";

import React, { useEffect, useRef } from "react";
import { Command as CommandPrimitive } from "cmdk";
import { Dialog as DialogPrimitive } from "radix-ui";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { SCRIM } from "@/lib/ui/variants";
import { useFocusReturn } from "@/lib/ui/focus-return";
import { Dialog } from "./dialog";
import { IconButton } from "./icon-button";

/**
 * Command (V2-06 06-02b; 06-UI-SPEC "Command palette" skin, DESIGN_SYSTEM §7.9; `cmdk`): a filterable list of commands
 * with combobox + listbox semantics. The input is a `combobox` whose `aria-activedescendant` names the active `option`;
 * arrows move the active row, Enter runs it, typing filters (cmdk's ranking), groups hide when nothing in them
 * matches. 06-04b builds the global palette (groups, data, ⌘K) on these parts; Combobox fields use the same list.
 *
 * Skin: input 44 px, `text-body-lg` 15 px, no box, bottom hairline, `enterKeyHint="search"`; group headings 11/600
 * caps fg-muted; rows 36 px (44 on touch), body-sm, the active row `selected` with an inset 2 px accent bar, a trailing
 * hint in caption fg-muted. `CommandDialog`: top 12 vh, `min(600px, 100vw − 32px)`, at most 70 dvh, radius-xl,
 * hairline, `shadow-overlay`, scrim; full screen below 768 px with a Close button. Escape closes it and focus returns
 * to the opener.
 */
export interface CommandProps extends React.ComponentPropsWithoutRef<typeof CommandPrimitive> {
  /**
   * Inline comboboxes whose list opens and closes (06-03b RxEntryRow, PatientPicker): the input's `aria-expanded`.
   * cmdk 1.1.1 always writes `aria-expanded="true"`, which tells a screen reader a list is showing when none is. Leave
   * undefined for an always-open list (the palette).
   */
  expanded?: boolean;
}

export const Command = React.forwardRef<React.ElementRef<typeof CommandPrimitive>, CommandProps>(function Command(
  { className, loop = true, expanded, ...props },
  ref,
) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  useActiveDescendantSync(rootRef);
  useExpandedSync(rootRef, expanded);
  return (
    <CommandPrimitive
      ref={(node) => {
        rootRef.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) ref.current = node;
      }}
      loop={loop}
      vimBindings={false}
      className={cn("flex min-h-0 w-full flex-col overflow-hidden bg-surface text-fg", className)}
      {...props}
    />
  );
});

/**
 * Keeps the input's `aria-activedescendant` on the option that is actually active. cmdk 1.1.1 updates it one step late
 * after the query changes (it reads the selected option before the options re-render): typing "book" left it unset
 * while "Book appointment" was the active option, and clearing the query left it on "Book appointment" while "Add
 * walk-in" was active (probe in the 06-02b record). Arrow-key moves were right. A screen reader announces the
 * active option from this attribute, so it must follow the option marked `aria-selected="true"`.
 */
function useActiveDescendantSync(rootRef: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const sync = () => {
      const input = root.querySelector<HTMLInputElement>("[cmdk-input]");
      if (!input) return;
      const id = root.querySelector<HTMLElement>('[cmdk-item][aria-selected="true"]')?.id;
      if (id) {
        if (input.getAttribute("aria-activedescendant") !== id) input.setAttribute("aria-activedescendant", id);
      } else if (input.hasAttribute("aria-activedescendant")) {
        input.removeAttribute("aria-activedescendant");
      }
    };
    const observer = new MutationObserver(sync);
    observer.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["aria-selected", "aria-activedescendant"],
    });
    sync();
    return () => observer.disconnect();
  }, [rootRef]);
}

/** Keeps the combobox input's `aria-expanded` on `expanded` (cmdk sets it to "true" on every mount). */
function useExpandedSync(rootRef: React.RefObject<HTMLDivElement | null>, expanded: boolean | undefined) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root || expanded === undefined) return;
    const value = String(expanded);
    const apply = () => {
      const input = root.querySelector<HTMLInputElement>("[cmdk-input]");
      if (input && input.getAttribute("aria-expanded") !== value) input.setAttribute("aria-expanded", value);
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-expanded"] });
    return () => observer.disconnect();
  }, [rootRef, expanded]);
}

/**
 * cmdk 1.1.1 brings the active option into view with `element.scrollIntoView({ block: "nearest" })` (and the first
 * group's heading with it), also when it auto-selects the first option on mount. `scrollIntoView` scrolls every
 * scrollable ancestor, the page included: `/dev/ui` loaded scrolled to its inline Command (scrollY 4758 at 1280 px,
 * evidence/06-02c/scroll-probe.txt), and a consult would jump to its Rx combobox on load. The items and headings here
 * get their own `scrollIntoView` that scrolls only the list (`[cmdk-list]`) they sit in, so arrow keys still keep the
 * active option visible inside the list while the page stays where the user left it.
 */
export function scrollWithinCommandList(el: HTMLElement): void {
  const list = el.closest<HTMLElement>("[cmdk-list]");
  if (!list) return;
  const l = list.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  if (r.top < l.top) list.scrollTop -= l.top - r.top;
  else if (r.bottom > l.bottom) list.scrollTop += r.bottom - l.bottom;
}

function confineScroll(el: HTMLElement | null): void {
  if (!el || Object.prototype.hasOwnProperty.call(el, "scrollIntoView")) return;
  Object.defineProperty(el, "scrollIntoView", { configurable: true, value: () => scrollWithinCommandList(el) });
}

/** Forwards a node to a forwarded ref (outside render: React calls ref callbacks at commit). */
function assignRef<T>(ref: React.ForwardedRef<T>, node: T | null): void {
  if (typeof ref === "function") ref(node);
  else if (ref) ref.current = node;
}

const pickHeading = (node: HTMLElement) => node.querySelector<HTMLElement>("[cmdk-group-heading]");

export const CommandInput = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Input>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Input>
>(function CommandInput({ className, ...props }, ref) {
  return (
    // The input draws no box; while it has keyboard focus its bottom hairline becomes a 2 px line in the ring colour.
    <div
      className="flex shrink-0 items-center gap-2.5 border-b border-border px-4 has-[input:focus-visible]:shadow-[inset_0_-2px_0_var(--color-ring)]"
      data-command-input=""
    >
      <Search aria-hidden="true" className="size-4 shrink-0 text-fg-icon" />
      <CommandPrimitive.Input
        ref={ref}
        enterKeyHint="search"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        className={cn(
          "h-control w-full min-w-0 bg-transparent text-body-lg text-fg placeholder:text-fg-placeholder focus-visible:outline-none touch:text-base",
          className,
        )}
        {...props}
      />
    </div>
  );
});

export const CommandList = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.List>
>(function CommandList({ className, ...props }, ref) {
  return (
    <CommandPrimitive.List
      ref={ref}
      className={cn("max-h-80 min-h-0 flex-1 overflow-y-auto overscroll-contain p-1", className)}
      {...props}
    />
  );
});

/** The no-results row: the message plus an optional hint ("Try a mobile number, token or name"). */
export const CommandEmpty = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Empty>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Empty> & { hint?: React.ReactNode }
>(function CommandEmpty({ className, hint, children, ...props }, ref) {
  return (
    <CommandPrimitive.Empty ref={ref} className={cn("flex flex-col gap-1 px-3 py-6 text-center", className)} {...props}>
      <span className="text-body-sm text-fg">{children}</span>
      {hint && <span className="text-label text-fg-muted">{hint}</span>}
    </CommandPrimitive.Empty>
  );
});

export const CommandGroup = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Group>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Group>
>(function CommandGroup({ className, ...props }, ref) {
  return (
    <CommandPrimitive.Group
      ref={(node) => {
        if (node) confineScroll(pickHeading(node));
        assignRef(ref, node);
      }}
      className={cn(
        "py-1 [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-1.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-caption [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:tracking-caps [&_[cmdk-group-heading]]:text-fg-muted [&_[cmdk-group-heading]]:uppercase",
        className,
      )}
      {...props}
    />
  );
});

export const CommandSeparator = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Separator>
>(function CommandSeparator({ className, ...props }, ref) {
  return <CommandPrimitive.Separator ref={ref} className={cn("my-1 h-px bg-border", className)} {...props} />;
});

export interface CommandItemProps extends React.ComponentPropsWithoutRef<typeof CommandPrimitive.Item> {
  icon?: React.ReactNode;
  /** Trailing hint for the Enter action ("Open", "Add to queue"). */
  hint?: React.ReactNode;
  /** Rows whose text may wrap (patient names are never ellipsized, 06-UI-SPEC CD-13); default one truncated line. */
  multiline?: boolean;
}

export const CommandItem = React.forwardRef<React.ElementRef<typeof CommandPrimitive.Item>, CommandItemProps>(
  function CommandItem({ className, icon, hint, multiline = false, children, ...props }, ref) {
    return (
      <CommandPrimitive.Item
        ref={(node) => {
          confineScroll(node);
          assignRef(ref, node);
        }}
        className={cn(
          "relative flex min-h-control-dense cursor-pointer items-center gap-2 rounded-sm px-2.5 text-body-sm text-fg select-none touch:min-h-control",
          "data-[selected=true]:bg-selected data-[selected=true]:shadow-[inset_2px_0_0_var(--color-accent)]",
          "data-[disabled=true]:cursor-not-allowed data-[disabled=true]:text-fg-disabled",
          "[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-fg-icon",
          className,
        )}
        {...props}
      >
        {icon && (
          <span aria-hidden="true" className="flex items-center">
            {icon}
          </span>
        )}
        <span className={cn("min-w-0 flex-1", multiline ? "py-1.5" : "truncate")}>{children}</span>
        {hint && <span className="shrink-0 text-caption text-fg-muted">{hint}</span>}
      </CommandPrimitive.Item>
    );
  },
);

/**
 * Loading row while results arrive (cmdk `progressbar`, labelled). Render it next to `CommandList`, never inside it:
 * a listbox may only own options and groups (axe `aria-required-children`, critical).
 */
export function CommandLoading({ label = "Searching…" }: { label?: string }) {
  return (
    <CommandPrimitive.Loading label={label} className="flex items-center gap-2 px-3 py-3 text-body-sm text-fg-muted">
      <span aria-hidden="true" className="size-3.5 rounded-pill border-2 border-border-strong border-t-accent motion-safe:animate-spin" />
      {label}
    </CommandPrimitive.Loading>
  );
}

/**
 * The palette shell: a modal dialog holding a `Command`. Full screen below 768 px (with the safe area on top and a
 * Close button), a centred panel 12 vh from the top on larger screens.
 */
export function CommandDialog({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The dialog's accessible name ("Search"), visually hidden. */
  title: string;
  children: React.ReactNode;
}) {
  const focusReturn = useFocusReturn();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay data-scrim="" className={SCRIM} />
        <DialogPrimitive.Content
          data-overlay="command"
          aria-describedby={undefined}
          onOpenAutoFocus={focusReturn.onOpenAutoFocus}
          onCloseAutoFocus={focusReturn.onCloseAutoFocus}
          className={cn(
            "fixed inset-0 z-50 flex flex-col overflow-hidden bg-surface text-fg shadow-overlay pt-safe",
            "md:inset-x-0 md:top-[12vh] md:bottom-auto md:mx-auto md:max-h-[70dvh] md:w-[min(37.5rem,calc(100vw-2rem))] md:rounded-xl md:border md:border-border md:pt-0",
            "motion-safe:transition-[opacity,translate] motion-safe:duration-(--duration-base) motion-safe:ease-out motion-safe:starting:translate-y-1 motion-safe:starting:opacity-0",
          )}
        >
          <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
          {/* The list takes the rest of the panel (full screen on phones, up to 70 dvh above) instead of its 320 px cap. */}
          <div className="flex min-h-0 flex-1 flex-col max-md:[&_[data-command-input]]:pr-12 [&_[cmdk-list]]:max-h-none [&>[cmdk-root]]:flex-1">
            {children}
          </div>
          {/* Phones: a Close button in the header row, after the input in the tab order. */}
          <DialogPrimitive.Close asChild>
            <IconButton
              label="Close"
              icon={<X />}
              tooltip={false}
              data-overlay-close=""
              className="absolute top-[env(safe-area-inset-top,0px)] right-0.5 md:hidden"
            />
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </Dialog>
  );
}
