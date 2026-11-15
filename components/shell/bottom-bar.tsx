"use client";

import Link from "next/link";
import { Menu } from "lucide-react";
import type { NavModel } from "@/lib/nav/nav-for-role";
import { cn } from "@/lib/utils";
import { FOCUS_RING, TRANSITION } from "@/lib/ui/variants";
import { NavIcon } from "./nav-icon";

const CELL = cn(
  "flex h-full min-h-control min-w-0 flex-col items-center justify-center gap-0.5 rounded-md px-1 text-caption font-medium text-(--nav-fg)",
  "aria-[current=page]:text-(--nav-active-fg)",
  TRANSITION,
  FOCUS_RING,
);

/**
 * BottomBar (< 768 px; 06-UI-SPEC §6, PWA_STRATEGY §3.3): fixed to the bottom, white, top hairline, 60 px plus the
 * safe area. Up to four primary destinations from `navForRole` (the model's `bottom`), then "More" in the last cell,
 * which opens the More sheet with everything else. Icon 18 over an 11/500 label, always both; the active cell takes the
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
          <Link key={d.id} href={d.href} aria-current={active ? "page" : undefined} className={CELL} data-nav-id={d.id}>
            <NavIcon icon={d.icon} className="size-[18px] shrink-0" strokeWidth={active ? 2.25 : 1.75} />
            <span className="line-clamp-2 max-w-full text-center leading-tight">{d.label}</span>
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
        <span>More</span>
      </button>
    </nav>
  );
}
