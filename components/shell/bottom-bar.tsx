"use client";

import Link from "next/link";
import { Menu } from "lucide-react";
import type { NavModel } from "@/lib/nav/nav-for-role";
import { cn } from "@/lib/utils";
import { FOCUS_RING, TRANSITION } from "@/lib/ui/variants";
import { NavIcon } from "./nav-icon";

/**
 * The BottomBar's caption for a destination whose v1 name does not fit one line of a 72 px cell at 360 px (06-09e,
 * design review M3). Only the visible caption is shortened: the link keeps the v1 name as its accessible name (R-8,
 * CD-30), and each caption is a word of that name, so the visible label stays inside the accessible name (WCAG 2.5.3).
 * Every other destination shows its v1 name.
 */
export const BOTTOM_BAR_CAPTION: Readonly<Record<string, string>> = {
  "My Schedule": "Schedule",
  // V2-08 08-03b: Today replaced three destinations, so the owner and the admin now have four and Reports reaches the bar.
  "Billing & Reports": "Reports",
};

export function bottomBarCaption(label: string): string {
  return BOTTOM_BAR_CAPTION[label] ?? label;
}

const CELL = cn(
  "flex h-full min-h-control min-w-0 flex-col items-center justify-center gap-0.5 rounded-md px-1 text-caption font-medium text-(--nav-fg)",
  "aria-[current=page]:text-(--nav-active-fg)",
  TRANSITION,
  FOCUS_RING,
);
/** One line, never wrapped (a wrapped caption pushed its icon out of line with its neighbours; M3). */
const CAPTION = "block max-w-full truncate text-center whitespace-nowrap";

/**
 * BottomBar (< 768 px; 06-UI-SPEC §6, PWA_STRATEGY §3.3): fixed to the bottom, white, top hairline, 60 px plus the
 * safe area. Up to four primary destinations from `navForRole` (the model's `bottom`), then "More" in the last cell,
 * which opens the More sheet with everything else. Icon 18 over an 11/500 caption on one line (a long v1 name shows a
 * shorter caption, {@link BOTTOM_BAR_CAPTION}), always both; the active cell takes the
 * nav-active colour and a heavier stroke. No "+" in V2-06 (CD-21). The shell hides it while a text field has focus on
 * a phone (`lib/pwa/keyboard-aware.ts`) and in focus mode. `z-30`, the top bar's tier: the v1 drawers (`z-40`) and every
 * overlay cover it, as they covered v1's sticky header.
 */
export function BottomBar({
  model,
  activeId,
  moreOpen,
  onMore,
  className,
  navLabel = "Primary",
}: {
  model: NavModel;
  activeId: string | null;
  moreOpen: boolean;
  onMore: () => void;
  className?: string;
  navLabel?: string;
}) {
  const items = model.primary.filter((d) => model.bottom.includes(d.id));
  const moreActive = activeId !== null && !items.some((d) => d.id === activeId);
  return (
    <nav
      aria-label={navLabel}
      data-shell-nav="bottom-bar"
      className={cn(
        "fixed inset-x-0 bottom-0 z-30 grid h-[calc(var(--spacing-bottom-bar)+env(safe-area-inset-bottom,0px))] auto-cols-fr grid-flow-col items-stretch border-t border-border bg-surface px-1 pt-1 pb-[max(0.25rem,env(safe-area-inset-bottom,0px))]",
        className,
      )}
    >
      {items.map((d) => {
        const active = d.id === activeId;
        return (
          <Link
            key={d.id}
            href={d.href}
            aria-current={active ? "page" : undefined}
            aria-label={bottomBarCaption(d.label) === d.label ? undefined : d.label}
            className={CELL}
            data-nav-id={d.id}
          >
            <NavIcon icon={d.icon} className="size-[18px] shrink-0" strokeWidth={active ? 2.25 : 1.75} />
            <span data-bar-caption="" className={CAPTION}>
              {bottomBarCaption(d.label)}
            </span>
          </Link>
        );
      })}
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={moreOpen}
        onClick={onMore}
        className={cn(CELL, "cursor-pointer", moreActive && "text-(--nav-active-fg)")}
        data-nav-id="more"
      >
        <Menu aria-hidden="true" className="size-[18px] shrink-0" strokeWidth={moreActive ? 2.25 : 1.75} />
        <span data-bar-caption="" className={CAPTION}>
          More
        </span>
      </button>
    </nav>
  );
}
